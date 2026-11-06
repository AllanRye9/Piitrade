import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { detectProvider, resolvePayer, friendlyFailure } from './rules';
import { loadAirtelConfig, describeAirtelConfigProblems, isAirtelConfigured, airtelCallbackToken, airtelCallbackUrl, isAirtelAvailable, canSettleAirtel, getAirtelStatus, setAirtelAdminSwitch } from './airtelConfig';
import { HttpAirtelClient, mapAirtelStatus, airtelLocalNumber } from './airtelClient';

describe('Airtel numbers', () => {
  it('detects networks by Uganda prefix', () => {
    for (const n of ['256701234567', '256741234567', '256751234567']) expect(detectProvider(n)).toBe('AIRTEL_MONEY');
    for (const n of ['256772123456', '256782123456', '256762123456', '256392123456']) expect(detectProvider(n)).toBe('MTN_MOMO');
    expect(detectProvider('256711234567')).toBeNull();
  });
  it('resolvePayer accepts Airtel only when allowed and keeps MTN unchanged', () => {
    expect(resolvePayer('0701 234 567', { airtel: true })).toEqual({ msisdn: '256701234567', provider: 'AIRTEL_MONEY' });
    expect(resolvePayer('+256751234567', { airtel: true })?.provider).toBe('AIRTEL_MONEY');
    expect(resolvePayer('0701234567', { airtel: false })).toBeNull();
    expect(resolvePayer('0772123456', { airtel: true })).toEqual({ msisdn: '256772123456', provider: 'MTN_MOMO' });
    expect(resolvePayer('0772123456', { airtel: false })?.provider).toBe('MTN_MOMO');
    expect(resolvePayer('junk', { airtel: true })).toBeNull();
  });
  it('strips the country code for Airtel', () => expect(airtelLocalNumber('256701234567')).toBe('701234567'));
  it('wording follows the network', () => {
    expect(friendlyFailure('PAYER_NOT_FOUND', 'AIRTEL_MONEY')).toContain('Airtel Money');
    expect(friendlyFailure('PAYER_NOT_FOUND')).toContain('MTN Mobile Money');
  });
});

describe('Airtel status mapping', () => {
  it('TS paid, TF/TE failed, everything else pending', () => {
    expect(mapAirtelStatus('TS')).toBe('SUCCESSFUL');
    expect(mapAirtelStatus('TF')).toBe('FAILED');
    expect(mapAirtelStatus('TE')).toBe('FAILED');
    for (const s of ['TIP', 'TA', '', undefined, 7]) expect(mapAirtelStatus(s)).toBe('PENDING');
  });
});

describe('Airtel config', () => {
  const ok = { AIRTEL_ENABLED: 'true', AIRTEL_CLIENT_ID: 'abc123', AIRTEL_CLIENT_SECRET: 's3cr3tvalue', JWT_SECRET: 'x'.repeat(40) };
  it('is off by default and when incomplete', () => {
    expect(isAirtelConfigured({})).toBe(false);
    expect(isAirtelConfigured({ ...ok, AIRTEL_CLIENT_SECRET: '' })).toBe(false);
    expect(describeAirtelConfigProblems({ ...ok, AIRTEL_CLIENT_SECRET: '' })).toContain('AIRTEL_CLIENT_SECRET is not set');
  });
  it('is on when flagged and complete; never mixes UAT with production', () => {
    expect(isAirtelConfigured(ok)).toBe(true);
    expect(describeAirtelConfigProblems({ ...ok, AIRTEL_ENVIRONMENT: 'production' })).toEqual([]);
    expect(describeAirtelConfigProblems({ ...ok, AIRTEL_ENVIRONMENT: 'production', AIRTEL_BASE_URL: 'https://openapiuat.airtel.africa' }).length).toBe(1);
    expect(describeAirtelConfigProblems({ ...ok, AIRTEL_CLIENT_ID: 'your-client-id' }).join()).toContain('placeholder');
  });
  it('callback url carries the signed token', () => {
    const url = airtelCallbackUrl({ ...ok, API_BASE_URL: 'https://api.example.com' })!;
    expect(url).toContain('/api/payments/momo/airtel/callback');
    expect(url).toContain(airtelCallbackToken(loadAirtelConfig(ok).callbackSecret!));
  });
});

describe('Airtel admin switch (same model as MTN)', () => {
  const ok = { AIRTEL_ENABLED: 'false', AIRTEL_CLIENT_ID: 'abc123', AIRTEL_CLIENT_SECRET: 's3cr3tvalue', JWT_SECRET: 'x'.repeat(40) };
  afterEach(() => setAirtelAdminSwitch(null));
  it('env is only the default until an admin uses the switch', () => {
    expect(isAirtelAvailable(ok, null)).toBe(false);
    expect(isAirtelAvailable({ ...ok, AIRTEL_ENABLED: 'true' }, null)).toBe(true);
    expect(isAirtelAvailable(ok, true)).toBe(true); // admin ON beats AIRTEL_ENABLED=false
    expect(isAirtelAvailable({ ...ok, AIRTEL_ENABLED: 'true' }, false)).toBe(false); // admin OFF beats env
  });
  it('ON with broken credentials is not live and reports the problems', () => {
    const st = getAirtelStatus({ ...ok, AIRTEL_CLIENT_SECRET: '' }, true);
    expect(st).toMatchObject({ enabled: false, switchedOn: true, switchSource: 'admin' });
    expect(st.problems).toContain('AIRTEL_CLIENT_SECRET is not set');
  });
  it('paused by an admin still settles in-flight payments; never-enabled does not', () => {
    expect(canSettleAirtel(ok, false)).toBe(true);
    expect(canSettleAirtel(ok, null)).toBe(false);
    expect(canSettleAirtel({ ...ok, AIRTEL_CLIENT_SECRET: '' }, false)).toBe(false);
  });
  it('the in-memory switch is what the no-arg helpers read', () => {
    setAirtelAdminSwitch(true);
    expect(loadAirtelConfig(ok).enabled).toBe(true);
  });
});

describe('HttpAirtelClient against a fake Airtel', () => {
  let server: http.Server;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function start(statusFor: (id: string) => string, seen: { collect?: any; headers?: http.IncomingHttpHeaders; tokens: number }) {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/auth/oauth2/token') {
          seen.tokens++;
          res.end(JSON.stringify({ access_token: 'tok', expires_in: 180 }));
        } else if (req.url === '/merchant/v2/payments/' && req.method === 'POST') {
          seen.collect = JSON.parse(body); seen.headers = req.headers;
          res.end(JSON.stringify({ data: { transaction: { status: 'Success' } }, status: { success: true, response_code: 'DP00800001001' } }));
        } else if (req.url?.startsWith('/standard/v1/payments/')) {
          const id = decodeURIComponent(req.url.split('/').pop()!);
          res.end(JSON.stringify({ data: { transaction: { id, status: statusFor(id), airtel_money_id: 'AM123', message: 'x' } }, status: { success: true } }));
        } else { res.statusCode = 404; res.end('{}'); }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return new HttpAirtelClient({ ...loadAirtelConfig({ AIRTEL_BASE_URL: `http://127.0.0.1:${port}`, AIRTEL_CLIENT_ID: 'id', AIRTEL_CLIENT_SECRET: 'sec' }) });
  }

  it('collects with country/currency headers and a local-format number, caches the token', async () => {
    const seen: any = { tokens: 0 };
    const c = await start(() => 'TS', seen);
    await c.requestToPay({ referenceId: 'ref-1', amount: '60000', currency: 'UGX', externalId: 'e', msisdn: '256701234567', payerMessage: 'Piitrade Gold', payeeNote: 'n' });
    expect(seen.collect.subscriber).toEqual({ country: 'UG', currency: 'UGX', msisdn: '701234567' });
    expect(seen.collect.transaction).toEqual({ amount: 60000, country: 'UG', currency: 'UGX', id: 'ref-1' });
    expect(seen.headers!['x-country']).toBe('UG');
    expect(seen.headers!['x-currency']).toBe('UGX');
    const st = await c.getRequestToPayStatus('ref-1');
    expect(st).toMatchObject({ outcome: 'SUCCESSFUL', financialTransactionId: 'AM123', amount: null });
    expect(seen.tokens).toBe(1);
  });

  it('reports pending and failed outcomes', async () => {
    const seen: any = { tokens: 0 };
    const c = await start((id) => (id === 'p' ? 'TIP' : 'TF'), seen);
    expect((await c.getRequestToPayStatus('p')).outcome).toBe('PENDING');
    expect(await c.getRequestToPayStatus('f')).toMatchObject({ outcome: 'FAILED', reason: 'DECLINED' });
  });
});

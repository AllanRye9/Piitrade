/**
 * HTTP-level test of /api/webhooks/whatsapp against the REAL router (real raw-body parsing, real signature check).
 * Only the database is mocked. The app is mounted the same way app.ts does it: the webhook router first,
 * then the global JSON parser, so a regression in that order (parsed body → signature can never match) fails here.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const db = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { notificationDelivery: { findMany: db.findMany, updateMany: db.updateMany } } }));

import { createWhatsAppWebhookRouter } from './whatsappWebhook';
import { errorHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { signBody } from '../utils/whatsappWebhook';

const SECRET = 'app-secret-for-tests';
const TOKEN = 'verify-token-for-tests';
const SAVED = { ...process.env };
let server: Server; let base = '';

beforeAll(async () => {
  const app = express();
  app.use('/api/webhooks/whatsapp', createWhatsAppWebhookRouter({ retryDelayMs: 25 }));
  app.use(express.json());
  app.use(errorHandler as any);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/whatsapp`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_VERIFY_TOKEN = TOKEN;
  process.env.WHATSAPP_APP_SECRET = SECRET;
  db.findMany.mockResolvedValue([]);
  db.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => { process.env = { ...SAVED }; });

const handshake = (params: Record<string, string>) => fetch(`${base}?${new URLSearchParams(params)}`);
const post = (rawBody: string, headers: Record<string, string> = {}, secret = SECRET) =>
  fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signBody(rawBody, secret), ...headers }, body: rawBody });

const receipt = (id: string, status: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'W', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses: [{ id, status, timestamp: '1730000000', recipient_id: '256772123456', ...extra }] } }] }],
});

describe('GET (Verify token handshake)', () => {
  it('answers 200 with the challenge as plain text when the token is right', async () => {
    const r = await handshake({ 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1158201444' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await r.text()).toBe('1158201444');
  });
  it('403 on a wrong token, 400 without a challenge', async () => {
    expect((await handshake({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })).status).toBe(403);
    expect((await handshake({ 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN })).status).toBe(400);
  });
  it('503 (and no challenge echoed) when no verify token is configured', async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const r = await handshake({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '777' });
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('777');
  });
});

describe('POST (signed events)', () => {
  it('rejects a missing or wrong signature (403) and touches nothing', async () => {
    const body = receipt('wamid.1', 'delivered');
    expect((await post(body, { 'x-hub-signature-256': '' })).status).toBe(403);
    expect((await post(body, {}, 'someone-elses-secret')).status).toBe(403);
    const noHeader = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(noHeader.status).toBe(403);
    expect(db.findMany).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it('503 when WHATSAPP_APP_SECRET is not set (fails closed, never accepts unsigned data)', async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect((await post(receipt('wamid.1', 'delivered'))).status).toBe(503);
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it('accepts a correctly signed receipt and records "delivered" on the matching row (status stays SENT)', async () => {
    db.findMany.mockResolvedValue([{ id: 'd1', providerMessageId: 'wamid.1', providerStatus: null }]);
    const r = await post(receipt('wamid.1', 'delivered'));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('EVENT_RECEIVED');
    expect(db.updateMany).toHaveBeenCalledTimes(1);
    const arg = db.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'd1', providerStatus: null });
    expect(arg.data.providerStatus).toBe('delivered');
    expect(arg.data.providerStatusAt).toEqual(new Date(1730000000 * 1000));
    expect(arg.data.status).toBeUndefined();
  });
  it('validates the signature over the exact bytes, so non-ASCII payloads and odd whitespace still verify', async () => {
    const odd = `{ "object" : "whatsapp_business_account",\n "entry":[], "note":"caf\\u00e9 \u00e9 \ud83d\ude00" }`;
    expect((await post(odd)).status).toBe(200);
  });
  it('a failed receipt flips the row to FAILED with the reason', async () => {
    db.findMany.mockResolvedValue([{ id: 'd2', providerMessageId: 'wamid.2', providerStatus: 'sent' }]);
    const r = await post(receipt('wamid.2', 'failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }));
    expect(r.status).toBe(200);
    const data = db.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ providerStatus: 'failed', status: 'FAILED' });
    expect(data.detail).toContain('131026');
    expect(data.detail).toContain('Message undeliverable');
  });
  it('ignores a repeated or older receipt (idempotent for Meta retries)', async () => {
    db.findMany.mockResolvedValue([{ id: 'd3', providerMessageId: 'wamid.3', providerStatus: 'read' }]);
    expect((await post(receipt('wamid.3', 'delivered'))).status).toBe(200);
    expect((await post(receipt('wamid.3', 'read'))).status).toBe(200);
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it('answers 200 for events that carry no receipts (inbound messages, other objects, empty entry)', async () => {
    const inbound = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'm', from: '1', type: 'text', text: { body: 'hi' } }] } }] }] });
    expect((await post(inbound)).status).toBe(200);
    expect((await post(JSON.stringify({ object: 'page', entry: [] }))).status).toBe(200);
    expect(db.findMany).not.toHaveBeenCalled();
  });
  it('400 for a validly signed body that is not JSON', async () => {
    expect((await post('not json at all')).status).toBe(400);
  });
  it('500 on a database failure so that Meta retries (and the retry is safe)', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    db.findMany.mockRejectedValue(new Error('db down'));
    try {
      expect((await post(receipt('wamid.4', 'delivered'))).status).toBe(500);
    } finally {
      errorLog.mockRestore();
    }
  });
  it('looks once more shortly after when the receipt beat the saving of the message id', async () => {
    db.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'd5', providerMessageId: 'wamid.5', providerStatus: null }]);
    expect((await post(receipt('wamid.5', 'sent'))).status).toBe(200);
    expect(db.updateMany).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(db.updateMany).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(db.updateMany.mock.calls[0][0].where.id).toBe('d5');
  });
  it('does not keep retrying forever for ids that are not ours', async () => {
    db.findMany.mockResolvedValue([]);
    await post(receipt('wamid.foreign', 'sent'));
    await new Promise((r) => setTimeout(r, 120));
    expect(db.findMany).toHaveBeenCalledTimes(2);
    expect(db.updateMany).not.toHaveBeenCalled();
  });
});

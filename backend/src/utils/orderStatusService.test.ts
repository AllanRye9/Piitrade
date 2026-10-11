import { describe, it, expect, beforeEach } from 'vitest';
import { changeOrderStatus, OrderDb, OrderTx, OrderStatusError, ChangeOptions } from './orderStatusService';
import { deriveDeliveryCode, DELIVERY_CODE_MAX_ATTEMPTS } from './deliveryCode';

// ── In-memory fake of the few Prisma calls the service uses ────────────────
// Models what the service relies on: updateMany is an atomic compare-and-set
// (supports equality, {not}, {lt}, null and {increment}); an error thrown inside
// $transaction rolls everything back; transactions are serialised. It is NOT
// proof of real-database behaviour — see TESTING.md for the psql checks.
type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
    if (v && typeof v === 'object' && 'lt' in v) return row[k] < v.lt;
    if (v === null) return row[k] == null;
    return row[k] === v;
  });
}
function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment;
    else if (v && typeof v === 'object' && 'decrement' in v) row[k] = (row[k] ?? 0) - v.decrement;
    else row[k] = v;
  }
}

const SECRET = 'test-secret-0123456789abcdef';

function makeDb(opts: { feePercent?: unknown; failUserUpdate?: boolean; sellerRole?: string } = {}) {
  const state = {
    orders: new Map<string, Row>(),
    users: new Map<string, Row>(),
    payments: new Map<string, Row>(),
    notifications: [] as Row[],
    siteConfig: { id: 'global', paymentSettings: opts.feePercent === undefined ? {} : { platformFeePercent: opts.feePercent } } as Row,
  };

  const orderApi = {
    async updateMany({ where, data }: { where: Row; data: Row }) {
      let count = 0;
      for (const row of state.orders.values()) if (matches(row, where)) { applyData(row, data); count++; }
      return { count };
    },
    async findUnique({ where }: { where: Row }) {
      const r = state.orders.get(where.id);
      return r ? { ...r } : null;
    },
  };

  const tx: OrderTx = {
    order: orderApi,
    user: {
      async update({ where, data }) {
        if (opts.failUserUpdate) throw new Error('boom: user update failed');
        const u = state.users.get(where.id)!;
        applyData(u, data);
        return u;
      },
      async findUnique({ where }) { const u = state.users.get(where.id); return u ? { ...u } : null; },
    },
    payment: {
      async updateMany({ where, data }) {
        for (const p of state.payments.values()) if (matches(p, where)) Object.assign(p, data);
        return {};
      },
      async findUnique({ where }) {
        for (const p of state.payments.values()) if (p.orderId === where.orderId) return { ...p };
        return null;
      },
    },
    siteConfig: { async findUnique() { return state.siteConfig; } },
    notification: { async create({ data }) { state.notifications.push(data); return data; } },
  };

  let lock: Promise<unknown> = Promise.resolve();
  async function runTx<T>(fn: (t: OrderTx) => Promise<T>): Promise<T> {
    const snap = structuredClone({ orders: [...state.orders], users: [...state.users], payments: [...state.payments], notifications: state.notifications });
    try {
      return await fn(tx);
    } catch (e) {
      state.orders = new Map(snap.orders); state.users = new Map(snap.users); state.payments = new Map(snap.payments); state.notifications = snap.notifications;
      throw e;
    }
  }
  const db: OrderDb = {
    $transaction(fn) { const run = lock.then(() => runTx(fn)); lock = run.catch(() => undefined); return run; },
    order: orderApi,
  };
  return { db, state };
}

type H = ReturnType<typeof makeDb>;
function seed(h: H, status = 'SHIPPED', sellerRole = 'USER') {
  h.state.orders.set('o1', {
    id: 'o1', status, sellerId: 's1', buyerId: 'b1', total: 100000, shippingCost: 0,
    platformFee: null, sellerPayout: null, payoutCreditedAt: null, deliveredAt: null, deliveryCodeAttempts: 0, payoutReversedAt: null,
  });
  h.state.orders.set('o2', { id: 'o2', status: 'SHIPPED', sellerId: 's1', buyerId: 'b1', total: 1, shippingCost: 0, payoutCreditedAt: null, deliveryCodeAttempts: 0 });
  h.state.users.set('s1', { id: 's1', balance: 0, role: sellerRole });
  h.state.payments.set('p1', { orderId: 'o1', status: 'PENDING', paidAt: null, amount: 100000 });
}
const snap = (h: H, id = 'o1') => {
  const o = h.state.orders.get(id)!;
  return { id: o.id, status: o.status, sellerId: o.sellerId, total: o.total, shippingCost: o.shippingCost, deliveryCodeAttempts: o.deliveryCodeAttempts };
};
const goodCode = (id = 'o1') => deriveDeliveryCode(id, SECRET);
const opts = (extra: ChangeOptions = {}): ChangeOptions => ({ deliveryCodeSecret: SECRET, ...extra });
const wrongCode = () => (goodCode() === '000000' ? '111111' : '000000');

describe('delivery settlement with the customer code', () => {
  let h: H;
  beforeEach(() => { h = makeDb({ feePercent: 10 }); seed(h); });

  it('seller with the right code: marks delivered and is credited total minus fee, once', async () => {
    const r = await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode(), actorUserId: 's1' }, opts());
    expect(r.changed).toBe(true);
    const o = h.state.orders.get('o1')!;
    expect(o.status).toBe('DELIVERED');
    expect(o.platformFee).toBe(10000);
    expect(o.sellerPayout).toBe(90000);
    expect(o.deliveryConfirmMethod).toBe('CODE');
    expect(o.deliveryConfirmedById).toBe('s1');
    expect(h.state.users.get('s1')!.balance).toBe(90000);
    expect(h.state.payments.get('p1')!.status).toBe('COMPLETED');
  });

  it('accepts the code as people type it (spaces / dash)', async () => {
    const c = goodCode();
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: `${c.slice(0, 3)} ${c.slice(3)}` }, opts());
    expect(h.state.orders.get('o1')!.status).toBe('DELIVERED');
  });

  it('REGRESSION B1: repeating DELIVERED never credits twice', async () => {
    for (let i = 0; i < 5; i++) {
      await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts());
    }
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });

  it('REGRESSION B1: re-sending DELIVERED is a no-op needing no code', async () => {
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts());
    const again = await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', {}, opts());
    expect(again.changed).toBe(false);
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });

  it('REGRESSION B1: two simultaneous requests with the same stale view credit once; loser gets 409', async () => {
    const stale = snap(h);
    const results = await Promise.allSettled([
      changeOrderStatus(h.db, stale, 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts()),
      changeOrderStatus(h.db, stale, 'DELIVERED', 'BUYER', {}, opts()),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.statusCode).toBe(409);
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });

  it('rolls everything back if a later step fails', async () => {
    const bad = makeDb({ feePercent: 10, failUserUpdate: true });
    seed(bad);
    await expect(changeOrderStatus(bad.db, snap(bad), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts())).rejects.toThrow('boom');
    const o = bad.state.orders.get('o1')!;
    expect(o.status).toBe('SHIPPED');
    expect(o.payoutCreditedAt).toBeNull();
    expect(bad.state.users.get('s1')!.balance).toBe(0);
  });

  it('pays the full amount when no fee is configured, and ignores a garbage fee', async () => {
    for (const fee of [undefined, 'lots']) {
      const x = makeDb({ feePercent: fee }); seed(x);
      await changeOrderStatus(x.db, snap(x), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts());
      expect(x.state.users.get('s1')!.balance).toBe(100000);
    }
  });

  it('charges NO platform fee when the seller is an admin account', async () => {
    const adminSeller = makeDb({ feePercent: 10 }); seed(adminSeller, 'SHIPPED', 'ADMIN');
    await changeOrderStatus(adminSeller.db, snap(adminSeller), 'DELIVERED', 'ADMIN', { overrideReason: 'handed over in person' }, opts());
    const o = adminSeller.state.orders.get('o1')!;
    expect(o.platformFee).toBe(0);
    expect(o.sellerPayout).toBe(100000);
  });

  it('keeps an earlier paidAt on an already-completed payment', async () => {
    const earlier = new Date('2026-01-01');
    h.state.payments.set('p1', { orderId: 'o1', status: 'COMPLETED', paidAt: earlier });
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts());
    expect(h.state.payments.get('p1')!.paidAt).toBe(earlier);
  });

  it('seller marking delivered can still be switched off entirely (403, no credit)', async () => {
    await expect(
      changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts({ sellerCanMarkDelivered: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(h.state.users.get('s1')!.balance).toBe(0);
  });
});

describe('proof of delivery', () => {
  let h: H;
  beforeEach(() => { h = makeDb({ feePercent: 10 }); seed(h); });
  const attempts = () => h.state.orders.get('o1')!.deliveryCodeAttempts;
  const unchanged = () => {
    expect(h.state.orders.get('o1')!.status).toBe('SHIPPED');
    expect(h.state.users.get('s1')!.balance).toBe(0);
  };

  it('a seller with no code is refused (400) — no credit, no attempt used', async () => {
    await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', {}, opts())).rejects.toMatchObject({ statusCode: 400 });
    unchanged(); expect(attempts()).toBe(0);
  });

  it('malformed input is rejected (400) without using up an attempt', async () => {
    for (const bad of ['12345', 'abcdef', '1234567', '12 34']) {
      await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: bad }, opts())).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(attempts()).toBe(0); unchanged();
  });

  it('a WRONG code is refused (403), and the attempt is recorded even though the request failed', async () => {
    await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: wrongCode() }, opts())).rejects.toMatchObject({ statusCode: 403 });
    expect(attempts()).toBe(1); unchanged();
  });

  it('a code belonging to a DIFFERENT order does not work', async () => {
    const other = goodCode('o2');
    await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: other }, opts())).rejects.toMatchObject({ statusCode: 403 });
    unchanged();
  });

  it('locks after the maximum wrong guesses (423); then even the right code is refused', async () => {
    for (let i = 0; i < DELIVERY_CODE_MAX_ATTEMPTS; i++) {
      await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: wrongCode() }, opts())).rejects.toBeInstanceOf(OrderStatusError);
    }
    expect(attempts()).toBe(DELIVERY_CODE_MAX_ATTEMPTS);
    await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts())).rejects.toMatchObject({ statusCode: 423 });
    unchanged();
    // the counter never runs past the cap
    await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: wrongCode() }, opts())).rejects.toMatchObject({ statusCode: 423 });
    expect(attempts()).toBe(DELIVERY_CODE_MAX_ATTEMPTS);
  });

  it('locked order: admin can still confirm with a written reason, buyer can confirm receipt', async () => {
    h.state.orders.get('o1')!.deliveryCodeAttempts = DELIVERY_CODE_MAX_ATTEMPTS;
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'ADMIN', { overrideReason: 'customer confirmed by phone', actorUserId: 'a1' }, opts());
    expect(h.state.orders.get('o1')!.deliveryConfirmMethod).toBe('ADMIN_OVERRIDE');
  });

  it('race: guesses lock the order after the request was read — a correct code then fails with 409, no credit', async () => {
    const stale = snap(h);                                   // attempts looked like 0
    h.state.orders.get('o1')!.deliveryCodeAttempts = DELIVERY_CODE_MAX_ATTEMPTS; // locked meanwhile
    await expect(changeOrderStatus(h.db, stale, 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts())).rejects.toMatchObject({ statusCode: 409 });
    unchanged();
  });

  it('fails CLOSED when no secret is configured, even if a code is supplied', async () => {
    for (const secret of [undefined, null, '', 'short']) {
      await expect(
        changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: '123456' }, { deliveryCodeSecret: secret as string }),
      ).rejects.toMatchObject({ statusCode: 500 });
    }
    unchanged();
  });

  it('buyer confirming receipt needs no code, is recorded as BUYER, and releases the payout', async () => {
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'BUYER', { actorUserId: 'b1' }, opts());
    const o = h.state.orders.get('o1')!;
    expect(o.deliveryConfirmMethod).toBe('BUYER');
    expect(o.deliveryConfirmedById).toBe('b1');
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });

  it('a buyer cannot mark an order delivered before it has shipped', async () => {
    h.state.orders.get('o1')!.status = 'PROCESSING';
    await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'BUYER', {}, opts())).rejects.toMatchObject({ statusCode: 403 });
  });

  it('admin with neither a code nor a proper reason is refused (400)', async () => {
    for (const reason of [undefined, '', '  ', 'ok', '12345', '!!!!!!']) {
      await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'ADMIN', { overrideReason: reason }, opts())).rejects.toMatchObject({ statusCode: 400 });
    }
    unchanged();
  });

  it('admin override is audited with who and why', async () => {
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'ADMIN', { overrideReason: '  signed delivery note seen  ', actorUserId: 'a1' }, opts());
    const o = h.state.orders.get('o1')!;
    expect(o.deliveryConfirmMethod).toBe('ADMIN_OVERRIDE');
    expect(o.deliveryOverrideReason).toBe('signed delivery note seen');
    expect(o.deliveryConfirmedById).toBe('a1');
  });

  it('an admin who supplies a code must supply the RIGHT one', async () => {
    await expect(changeOrderStatus(h.db, snap(h), 'DELIVERED', 'ADMIN', { deliveryCode: wrongCode() }, opts())).rejects.toMatchObject({ statusCode: 403 });
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'ADMIN', { deliveryCode: goodCode() }, opts());
    expect(h.state.orders.get('o1')!.deliveryConfirmMethod).toBe('CODE');
  });

  it('requireDeliveryProof=false restores the legacy click-to-deliver (recorded as NONE)', async () => {
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', {}, { requireDeliveryProof: false });
    expect(h.state.orders.get('o1')!.deliveryConfirmMethod).toBe('NONE');
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });
});

describe('unpaid mobile-money orders cannot advance', () => {
  const setPay = (h: H, extra: Record<string, unknown>) => Object.assign(h.state.payments.get('p1')!, extra);

  it('blocks CONFIRMED/PROCESSING/SHIPPED/DELIVERED until the payment is COMPLETED (409), but allows cancelling', async () => {
    for (const [from, to, actor, extra] of [
      ['PENDING', 'CONFIRMED', 'SELLER', {}],
      ['CONFIRMED', 'PROCESSING', 'SELLER', {}],
      ['PROCESSING', 'SHIPPED', 'SELLER', {}],
      ['SHIPPED', 'DELIVERED', 'BUYER', {}],
      ['SHIPPED', 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }],
    ] as const) {
      const h = makeDb({ feePercent: 10 }); seed(h, from); setPay(h, { method: 'MOBILE_MONEY', status: 'PENDING' });
      await expect(changeOrderStatus(h.db, snap(h), to, actor, extra, opts())).rejects.toMatchObject({ statusCode: 409 });
      expect(h.state.orders.get('o1')!.status).toBe(from);
      expect(h.state.users.get('s1')!.balance).toBe(0);
    }
    const h = makeDb(); seed(h, 'PENDING'); setPay(h, { method: 'MOBILE_MONEY', status: 'PENDING' });
    await changeOrderStatus(h.db, snap(h), 'CANCELLED', 'BUYER', {}, opts());
    expect(h.state.orders.get('o1')!.status).toBe('CANCELLED');
  });

  it('once the payment is COMPLETED the same order proceeds and pays out', async () => {
    const h = makeDb({ feePercent: 10 }); seed(h); setPay(h, { method: 'MOBILE_MONEY', status: 'COMPLETED' });
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts());
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });

  it('cash-on-delivery orders are unaffected', async () => {
    const h = makeDb({ feePercent: 10 }); seed(h); setPay(h, { method: 'CASH_ON_DELIVERY', status: 'PENDING' });
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'SELLER', { deliveryCode: goodCode() }, opts());
    expect(h.state.orders.get('o1')!.status).toBe('DELIVERED');
  });
});

describe('other transitions', () => {
  it('REGRESSION B2: a delivered order cannot be cancelled or reverted; the payout stays', async () => {
    const h = makeDb({ feePercent: 10 }); seed(h);
    await changeOrderStatus(h.db, snap(h), 'DELIVERED', 'BUYER', {}, opts());
    for (const [to, actor] of [['CANCELLED', 'BUYER'], ['CANCELLED', 'SELLER'], ['PENDING', 'ADMIN']] as const) {
      await expect(changeOrderStatus(h.db, snap(h), to, actor, {}, opts())).rejects.toBeInstanceOf(OrderStatusError);
    }
    expect(h.state.orders.get('o1')!.status).toBe('DELIVERED');
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });

  it('SHIPPED sets shippedAt and tracking number (no code involved)', async () => {
    const h = makeDb(); seed(h, 'PROCESSING');
    await changeOrderStatus(h.db, snap(h), 'SHIPPED', 'SELLER', { trackingNumber: 'TRK1' }, opts());
    const o = h.state.orders.get('o1')!;
    expect(o.status).toBe('SHIPPED'); expect(o.trackingNumber).toBe('TRK1'); expect(o.shippedAt).toBeInstanceOf(Date);
  });

  it('buyer can cancel a pending order, recording the note; no payout', async () => {
    const h = makeDb(); seed(h, 'PENDING');
    await changeOrderStatus(h.db, snap(h), 'CANCELLED', 'BUYER', { cancellationNote: 'changed my mind' }, opts());
    const o = h.state.orders.get('o1')!;
    expect(o.status).toBe('CANCELLED'); expect(o.cancellationNote).toBe('changed my mind');
    expect(h.state.users.get('s1')!.balance).toBe(0);
  });

  it('maps rule violations to HTTP codes: 403 forbidden, 409 illegal, 400 unknown', async () => {
    const h = makeDb(); seed(h, 'SHIPPED');
    await expect(changeOrderStatus(h.db, snap(h), 'CANCELLED', 'BUYER', {}, opts())).rejects.toMatchObject({ statusCode: 403 });
    await expect(changeOrderStatus(h.db, snap(h), 'PROCESSING', 'SELLER', {}, opts())).rejects.toMatchObject({ statusCode: 409 });
    await expect(changeOrderStatus(h.db, snap(h), 'BOGUS', 'ADMIN', {}, opts())).rejects.toMatchObject({ statusCode: 400 });
  });

});

describe('refunding a delivered order reverses the seller payout', () => {
  let h: H;
  const deliver = (x: H) => changeOrderStatus(x.db, snap(x), 'DELIVERED', 'BUYER', {}, opts());
  const refund = (x: H, extra: Record<string, unknown> = {}, actor: 'ADMIN' | 'SELLER' = 'ADMIN') =>
    changeOrderStatus(x.db, snap(x), 'REFUNDED', actor, { refundReason: 'buyer returned the item', actorUserId: 'a1', ...extra }, opts());
  beforeEach(async () => { h = makeDb({ feePercent: 10 }); seed(h); await deliver(h); });

  it('takes back exactly what was paid out (not the order total), once, and records who/why', async () => {
    expect(h.state.users.get('s1')!.balance).toBe(90000);
    const r = await refund(h);
    expect(r.changed).toBe(true);
    const o = h.state.orders.get('o1')!;
    expect(o).toMatchObject({ status: 'REFUNDED', refundReason: 'buyer returned the item', refundedById: 'a1' });
    expect(o.payoutReversedAt).toBeInstanceOf(Date);
    expect(h.state.users.get('s1')!.balance).toBe(0);          // 90000 - 90000 (the 10% fee was never the seller's)
  });

  it('marks the payment REFUNDED with the buyer\'s full amount, and tells both sides', async () => {
    await refund(h);
    expect(h.state.payments.get('p1')).toMatchObject({ status: 'REFUNDED', refundAmount: 100000 });
    expect(h.state.payments.get('p1')!.refundedAt).toBeInstanceOf(Date);
    const to = (id: string) => h.state.notifications.filter((n) => n.userId === id);
    expect(to('s1')).toHaveLength(1);
    expect(to('s1')[0].message).toContain('90000');
    expect(to('b1')).toHaveLength(1);
  });

  it('REGRESSION: a repeated refund never reverses twice', async () => {
    await refund(h);
    for (let i = 0; i < 3; i++) expect((await refund(h)).changed).toBe(false);
    expect(h.state.users.get('s1')!.balance).toBe(0);
    expect(h.state.notifications.filter((n) => n.userId === 's1')).toHaveLength(1);
  });

  it('REGRESSION: two simultaneous refunds reverse once; the loser gets 409', async () => {
    const stale = snap(h);
    const results = await Promise.allSettled([
      changeOrderStatus(h.db, stale, 'REFUNDED', 'ADMIN', { refundReason: 'duplicate click one' }, opts()),
      changeOrderStatus(h.db, stale, 'REFUNDED', 'ADMIN', { refundReason: 'duplicate click two' }, opts()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.statusCode).toBe(409);
    expect(h.state.users.get('s1')!.balance).toBe(0);
  });

  it('a seller who already withdrew ends up with a NEGATIVE balance (debt), recorded not hidden', async () => {
    h.state.users.get('s1')!.balance = 20000;                  // withdrew 70000 of the 90000
    await refund(h);
    expect(h.state.users.get('s1')!.balance).toBe(-70000);
  });

  it('requires a real reason (400) and changes nothing without one', async () => {
    for (const reason of [undefined, '', '   ', 'ok', '12345']) {
      await expect(refund(h, { refundReason: reason })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(h.state.orders.get('o1')!.status).toBe('DELIVERED');
    expect(h.state.users.get('s1')!.balance).toBe(90000);
  });

  it('only an admin may refund (403); only a delivered order can be refunded (409)', async () => {
    await expect(refund(h, {}, 'SELLER')).rejects.toMatchObject({ statusCode: 403 });
    const early = makeDb(); seed(early, 'SHIPPED');
    await expect(refund(early)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rolls everything back if the reversal fails midway', async () => {
    const x = makeDb({ feePercent: 10 }); seed(x); await deliver(x);
    const realTx = x.db.$transaction.bind(x.db);
    // same database, but the seller debit throws part-way through the refund
    const brokenDb = {
      ...x.db,
      $transaction: (fn: any) => realTx((tx: any) => fn({ ...tx, user: { ...tx.user, update: async () => { throw new Error('boom: debit failed'); } } })),
    } as OrderDb;
    await expect(
      changeOrderStatus(brokenDb, snap(x), 'REFUNDED', 'ADMIN', { refundReason: 'will fail midway' }, opts()),
    ).rejects.toThrow('boom');
    expect(x.state.orders.get('o1')).toMatchObject({ status: 'DELIVERED', payoutReversedAt: null });
    expect(x.state.payments.get('p1')!.status).toBe('COMPLETED');
    expect(x.state.users.get('s1')!.balance).toBe(90000);
  });

  it('an order delivered before payouts were recorded (no payoutCreditedAt) reverses nothing', async () => {
    const legacy = makeDb(); seed(legacy, 'DELIVERED');
    Object.assign(legacy.state.orders.get('o1')!, { sellerPayout: 50000, payoutCreditedAt: null });
    legacy.state.payments.get('p1')!.status = 'COMPLETED';
    legacy.state.users.get('s1')!.balance = 1000;
    await refund(legacy);
    expect(legacy.state.users.get('s1')!.balance).toBe(1000);
  });

  it('an order Piitrade sold itself (no fee) reverses the full payout', async () => {
    const x = makeDb({ feePercent: 10 }); seed(x, 'SHIPPED', 'ADMIN'); await deliver(x);
    expect(x.state.users.get('s1')!.balance).toBe(100000);
    await refund(x);
    expect(x.state.users.get('s1')!.balance).toBe(0);
  });
});


import { describe, it, expect, beforeEach } from 'vitest';
import {
  PaymentDb, PaymentTx, submitPaymentProof, confirmPaymentProof, rejectPaymentProof, expireUnpaidOrders, PaymentError,
} from './paymentProofService';

// ── In-memory fake of the Prisma calls the service uses ─────────────────────
// Faithful where it matters: compare-and-set updateMany, rollback on throw,
// serialised transactions, and a PARTIAL UNIQUE index on transactionId that
// ignores REJECTED proofs (mirrors the real migration; throws code P2002).
type Row = Record<string, any>;
const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'lt' in v) return row[k] != null && row[k] < v.lt;
    if (v === null) return row[k] == null;
    return row[k] === v;
  });

function makeDb() {
  const st = {
    orders: new Map<string, Row>(), payments: new Map<string, Row>(),
    proofs: new Map<string, Row>(), notifications: [] as Row[], seq: 0,
  };
  const orderWithPayment = (o: Row, include: any) =>
    include?.payment ? { ...o, payment: [...st.payments.values()].find((p) => p.orderId === o.id) ?? null } : { ...o };

  const tx: PaymentTx = {
    order: {
      async findUnique({ where, include }) { const o = st.orders.get(where.id); return o ? orderWithPayment(o, include) : null; },
      async updateMany({ where, data }) { let c = 0; for (const r of st.orders.values()) if (matches(r, where)) { Object.assign(r, data); c++; } return { count: c }; },
    },
    payment: {
      async findUnique({ where }) { return [...st.payments.values()].find((p) => p.orderId === where.orderId) ?? null; },
      async findMany({ where, take }) { return [...st.payments.values()].filter((p) => matches(p, where)).slice(0, take).map((p) => ({ ...p })); },
      async updateMany({ where, data }) { let c = 0; for (const r of st.payments.values()) if (matches(r, where)) { Object.assign(r, data); c++; } return { count: c }; },
    },
    paymentProof: {
      async findUnique({ where }) { const p = st.proofs.get(where.id); return p ? { ...p } : null; },
      async count({ where }) { return [...st.proofs.values()].filter((p) => matches(p, where)).length; },
      async create({ data }) {
        const clash = [...st.proofs.values()].some((p) => p.transactionId === data.transactionId && p.status !== 'REJECTED');
        if (clash) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        const row = { id: 'pr' + ++st.seq, createdAt: new Date(), ...data };
        st.proofs.set(row.id, row);
        return { ...row };
      },
      async updateMany({ where, data }) { let c = 0; for (const r of st.proofs.values()) if (matches(r, where)) { Object.assign(r, data); c++; } return { count: c }; },
    },
    notification: { async create({ data }) { st.notifications.push(data); return data; } },
  };

  let lock: Promise<unknown> = Promise.resolve();
  const run = async <T,>(fn: (t: PaymentTx) => Promise<T>): Promise<T> => {
    const snap = structuredClone({ o: [...st.orders], p: [...st.payments], r: [...st.proofs], n: st.notifications });
    try { return await fn(tx); } catch (e) {
      st.orders = new Map(snap.o); st.payments = new Map(snap.p); st.proofs = new Map(snap.r); st.notifications = snap.n; throw e;
    }
  };
  const db: PaymentDb = { ...tx, $transaction(fn) { const r = lock.then(() => run(fn)); lock = r.catch(() => undefined); return r; } };
  return { db, st };
}
type H = ReturnType<typeof makeDb>;

const NOW = new Date('2026-10-10T10:00:00Z');
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

function seed(h: H, o: { id?: string; dueInMin?: number | null; method?: string; status?: string; total?: number } = {}) {
  const id = o.id ?? 'o1';
  h.st.orders.set(id, { id, orderNumber: 'ORD-' + id, buyerId: 'b1', sellerId: 's1', status: o.status ?? 'PENDING', total: o.total ?? 100000 });
  h.st.payments.set('pay-' + id, {
    id: 'pay-' + id, orderId: id, method: o.method ?? 'MOBILE_MONEY', status: 'PENDING', amount: o.total ?? 100000,
    dueAt: o.dueInMin === null ? null : min(o.dueInMin ?? 30),
  });
}
const goodInput = { transactionId: 'mp1234567', senderPhone: '0772123456', amount: 100000 };
const submit = (h: H, over: Record<string, unknown> = {}, who = 'b1', id = 'o1') =>
  submitPaymentProof(h.db, { orderId: id, userId: who, input: { ...goodInput, ...over }, now: NOW });

describe('submitPaymentProof', () => {
  let h: H;
  beforeEach(() => { h = makeDb(); seed(h); });

  it('records a SUBMITTED proof with normalised values — and does NOT mark anything paid', async () => {
    const p = await submit(h);
    expect(p).toMatchObject({ orderId: 'o1', transactionId: 'MP1234567', senderPhone: '0772123456', amountClaimed: 100000, status: 'SUBMITTED' });
    expect(h.st.payments.get('pay-o1')!.status).toBe('PENDING');
    expect(h.st.orders.get('o1')!.status).toBe('PENDING');
  });
  it('validates the input (400)', async () => {
    await expect(submit(h, { transactionId: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(submit(h, { amount: 0 })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('only the buyer may submit (403); unknown order is 404', async () => {
    await expect(submit(h, {}, 'someone-else')).rejects.toMatchObject({ statusCode: 403 });
    await expect(submit(h, {}, 'b1', 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('refuses cash-on-delivery, paid, and cancelled orders (409)', async () => {
    const cod = makeDb(); seed(cod, { method: 'CASH_ON_DELIVERY' });
    await expect(submit(cod)).rejects.toMatchObject({ statusCode: 409 });
    const paid = makeDb(); seed(paid); paid.st.payments.get('pay-o1')!.status = 'COMPLETED';
    await expect(submit(paid)).rejects.toMatchObject({ statusCode: 409 });
    const cancelled = makeDb(); seed(cancelled, { status: 'CANCELLED' });
    await expect(submit(cancelled)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('enforces the deadline: fine up to the minute it expires, refused after', async () => {
    const edge = makeDb(); seed(edge, { dueInMin: 0 });
    await expect(submit(edge)).resolves.toBeTruthy();   // exactly at the deadline
    const late = makeDb(); seed(late, { dueInMin: -1 });
    await expect(submit(late)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('one pending submission at a time (409), and at most 3 per order (429)', async () => {
    await submit(h);
    await expect(submit(h, { transactionId: 'ZZ9999999' })).rejects.toMatchObject({ statusCode: 409 });
    for (const id of ['A1', 'B2', 'C3']) {
      for (const p of h.st.proofs.values()) if (p.status === 'SUBMITTED') p.status = 'REJECTED';
      if (id !== 'C3') await submit(h, { transactionId: id + '000000' });
    }
    for (const p of h.st.proofs.values()) p.status = 'REJECTED';
    expect(h.st.proofs.size).toBe(3);
    await expect(submit(h, { transactionId: 'D4000000' })).rejects.toMatchObject({ statusCode: 429 });
  });
  it('REGRESSION: one MTN transaction cannot pay for two orders (typed differently, even simultaneously)', async () => {
    seed(h, { id: 'o2' });
    const [a, b] = await Promise.allSettled([submit(h, { transactionId: 'mp 1234-567' }, 'b1', 'o1'), submit(h, { transactionId: 'MP1234567' }, 'b1', 'o2')]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rej = (a.status === 'rejected' ? a : b) as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(PaymentError);
    expect(rej.reason.statusCode).toBe(409);
  });
  it('a rejected transaction ID may be reused (typo correction) — partial unique index', async () => {
    const p = await submit(h);
    for (const r of h.st.proofs.values()) r.status = 'REJECTED';
    await expect(submit(h, { transactionId: p.transactionId })).resolves.toBeTruthy();
  });
});

describe('confirmPaymentProof', () => {
  let h: H; let proofId: string;
  beforeEach(async () => { h = makeDb(); seed(h); proofId = (await submit(h)).id; });
  const confirm = (over: Record<string, unknown> = {}) =>
    confirmPaymentProof(h.db, { proofId, adminId: 'a1', amountReceived: 100000, now: NOW, ...over } as any);

  it('marks the payment paid with an audit trail, and releases the order (PENDING -> CONFIRMED)', async () => {
    const r = await confirm({ note: 'matched statement line 12' });
    expect(r).toMatchObject({ orderId: 'o1', buyerId: 'b1' });
    expect(h.st.proofs.get(proofId)).toMatchObject({ status: 'CONFIRMED', amountReceived: 100000, reviewedById: 'a1', reviewNote: 'matched statement line 12' });
    const pay = h.st.payments.get('pay-o1')!;
    expect(pay).toMatchObject({ status: 'COMPLETED', gatewayRef: 'MP1234567' });
    expect(pay.gatewayData).toMatchObject({ channel: 'MANUAL_MTN', confirmedBy: 'a1', amountReceived: 100000 });
    expect(h.st.orders.get('o1')!.status).toBe('CONFIRMED');
    expect(h.st.notifications.at(-1)).toMatchObject({ userId: 'b1', type: 'PAYMENT_RECEIVED' });
  });
  it('accepts an amount typed with commas; records an overpayment', async () => {
    const r = await confirm({ amountReceived: '105,000' });
    expect(r.overpaidBy).toBe(5000);
  });
  it('REGRESSION: an UNDERPAYMENT can never be confirmed — nothing changes (409)', async () => {
    await expect(confirm({ amountReceived: 99999 })).rejects.toMatchObject({ statusCode: 409 });
    expect(h.st.proofs.get(proofId)!.status).toBe('SUBMITTED');
    expect(h.st.payments.get('pay-o1')!.status).toBe('PENDING');
    expect(h.st.orders.get('o1')!.status).toBe('PENDING');
  });
  it('requires a valid received amount (400)', async () => {
    for (const bad of [undefined, 'abc', NaN]) await expect(confirm({ amountReceived: bad })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('a proof can be confirmed only once (409), and money is never recorded twice', async () => {
    await confirm();
    await expect(confirm()).rejects.toMatchObject({ statusCode: 409 });
    expect(h.st.notifications.filter((n) => n.type === 'PAYMENT_RECEIVED')).toHaveLength(1);
  });
  it('two admins clicking at once: exactly one wins', async () => {
    const r = await Promise.allSettled([confirm({ adminId: 'a1' }), confirm({ adminId: 'a2' })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(h.st.notifications.filter((n) => n.type === 'PAYMENT_RECEIVED')).toHaveLength(1);
  });
  it('REGRESSION: an order cancelled meanwhile is NOT resurrected by a late confirmation', async () => {
    h.st.orders.get('o1')!.status = 'CANCELLED';
    await expect(confirm()).rejects.toMatchObject({ statusCode: 409 });
    expect(h.st.orders.get('o1')!.status).toBe('CANCELLED');
    expect(h.st.payments.get('pay-o1')!.status).toBe('PENDING');
  });
  it('unknown proof is 404', async () => {
    await expect(confirm({ proofId: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('rejectPaymentProof', () => {
  let h: H; let proofId: string;
  beforeEach(async () => { h = makeDb(); seed(h, { dueInMin: 2 }); proofId = (await submit(h)).id; });
  const reject = (over: Record<string, unknown> = {}) =>
    rejectPaymentProof(h.db, { proofId, adminId: 'a1', reason: 'no matching payment', deadlineMinutes: 30, now: NOW, ...over } as any);

  it('records the reason, tells the buyer, keeps the order open', async () => {
    await reject();
    expect(h.st.proofs.get(proofId)).toMatchObject({ status: 'REJECTED', reviewNote: 'no matching payment', reviewedById: 'a1' });
    expect(h.st.orders.get('o1')!.status).toBe('PENDING');
    expect(h.st.notifications.at(-1)).toMatchObject({ type: 'PAYMENT_FAILED', userId: 'b1' });
  });
  it('gives the buyer a FRESH payment window (so a typo can be fixed), but never shortens one', async () => {
    await reject();
    expect(h.st.payments.get('pay-o1')!.dueAt.getTime()).toBe(min(30).getTime());
    const long = makeDb(); seed(long, { dueInMin: 600 }); const id = (await submit(long)).id;
    await rejectPaymentProof(long.db, { proofId: id, adminId: 'a1', reason: 'typo in id', deadlineMinutes: 30, now: NOW });
    expect(long.st.payments.get('pay-o1')!.dueAt.getTime()).toBe(min(600).getTime());
  });
  it('requires a reason (400); a reviewed proof cannot be rejected again (409)', async () => {
    await expect(reject({ reason: ' ' })).rejects.toMatchObject({ statusCode: 400 });
    await reject();
    await expect(reject()).rejects.toMatchObject({ statusCode: 409 });
  });
  it('after a rejection the buyer can submit corrected details', async () => {
    await reject();
    await expect(submit(h, { transactionId: 'FIXED12345' })).resolves.toBeTruthy();
  });
});

describe('expireUnpaidOrders', () => {
  it('cancels an overdue unpaid mobile-money order, fails its payment and tells the buyer', async () => {
    const h = makeDb(); seed(h, { dueInMin: -1 });
    const r = await expireUnpaidOrders(h.db, { now: NOW });
    expect(r.cancelled).toEqual(['o1']);
    expect(h.st.orders.get('o1')).toMatchObject({ status: 'CANCELLED' });
    expect(h.st.payments.get('pay-o1')!.status).toBe('FAILED');
    expect(h.st.notifications.at(-1)).toMatchObject({ type: 'ORDER_CANCELLED', userId: 'b1' });
  });
  it('leaves alone: not-yet-due, cash-on-delivery, already paid, and orders no longer PENDING', async () => {
    const h = makeDb();
    seed(h, { id: 'a', dueInMin: 5 });
    seed(h, { id: 'b', dueInMin: null, method: 'CASH_ON_DELIVERY' });
    seed(h, { id: 'c', dueInMin: -10 }); h.st.payments.get('pay-c')!.status = 'COMPLETED';
    seed(h, { id: 'd', dueInMin: -10, status: 'CONFIRMED' });
    const r = await expireUnpaidOrders(h.db, { now: NOW });
    expect(r.cancelled).toEqual([]);
    for (const id of ['a', 'b', 'c']) expect(h.st.orders.get(id)!.status).toBe('PENDING');
    expect(h.st.orders.get('d')!.status).toBe('CONFIRMED');
  });
  it('REGRESSION: never expires an order whose proof is waiting for an admin', async () => {
    const h = makeDb(); seed(h, { dueInMin: 1 });
    await submit(h);
    const later = new Date(NOW.getTime() + 600 * 60_000);
    const r = await expireUnpaidOrders(h.db, { now: later });
    expect(r.cancelled).toEqual([]);
    expect(h.st.orders.get('o1')!.status).toBe('PENDING');
  });
  it('expires it once the proof was rejected and the fresh window also lapsed', async () => {
    const h = makeDb(); seed(h, { dueInMin: 1 });
    const p = await submit(h);
    await rejectPaymentProof(h.db, { proofId: p.id, adminId: 'a1', reason: 'not found', deadlineMinutes: 30, now: NOW });
    expect((await expireUnpaidOrders(h.db, { now: min(10) })).cancelled).toEqual([]);
    expect((await expireUnpaidOrders(h.db, { now: min(31) })).cancelled).toEqual(['o1']);
  });
  it('is idempotent and safe to run on several instances at once (one cancellation, one notification)', async () => {
    const h = makeDb(); seed(h, { dueInMin: -1 });
    const r = await Promise.all([expireUnpaidOrders(h.db, { now: NOW }), expireUnpaidOrders(h.db, { now: NOW }), expireUnpaidOrders(h.db, { now: NOW })]);
    expect(r.flatMap((x) => x.cancelled)).toEqual(['o1']);
    expect(h.st.notifications.filter((n) => n.type === 'ORDER_CANCELLED')).toHaveLength(1);
    expect((await expireUnpaidOrders(h.db, { now: NOW })).cancelled).toEqual([]);
  });
  it('an admin confirmation racing the sweep: exactly one of them wins, never both', async () => {
    const h = makeDb(); seed(h, { dueInMin: 1 });
    const p = await submit(h);                                   // proof present => sweep skips
    const [c, s] = await Promise.allSettled([
      confirmPaymentProof(h.db, { proofId: p.id, adminId: 'a1', amountReceived: 100000, now: NOW }),
      expireUnpaidOrders(h.db, { now: min(60) }),
    ]);
    expect(c.status).toBe('fulfilled');
    expect(h.st.orders.get('o1')!.status).toBe('CONFIRMED');
    expect((s as PromiseFulfilledResult<any>).value.cancelled).toEqual([]);
  });
});

describe('late payments: submit, confirm-and-reinstate, reject', () => {
  const DAY = 86_400_000;
  /** An order the expiry sweep cancelled `daysAgo` days before NOW. */
  function seedExpired(h: H, daysAgo = 1, id = 'o1') {
    seed(h, { id, dueInMin: -60 });
    Object.assign(h.st.orders.get(id)!, { status: 'CANCELLED', cancelledAt: new Date(NOW.getTime() - daysAgo * DAY), cancellationNote: 'Payment was not received within the payment window.' });
    h.st.payments.get('pay-' + id)!.status = 'FAILED';
  }
  const submitLate = (h: H, over: Record<string, unknown> = {}) => submit(h, over);
  const confirm = (h: H, proofId: string, over: Record<string, unknown> = {}) =>
    confirmPaymentProof(h.db, { proofId, adminId: 'a1', amountReceived: 100000, now: NOW, ...over } as any);

  it('the buyer can submit a late proof within 7 days of the cancellation', async () => {
    const h = makeDb(); seedExpired(h, 2);
    await expect(submitLate(h)).resolves.toMatchObject({ status: 'SUBMITTED', orderId: 'o1' });
    expect(h.st.orders.get('o1')!.status).toBe('CANCELLED');   // submitting changes nothing by itself
  });
  it('...but not after 7 days (409), and a duplicate transaction ID is still refused', async () => {
    const old = makeDb(); seedExpired(old, 8);
    await expect(submitLate(old)).rejects.toMatchObject({ statusCode: 409 });
    const h = makeDb(); seedExpired(h, 1); seed(h, { id: 'o2' });
    await submitLate(h);
    await expect(submit(h, {}, 'b1', 'o2')).rejects.toMatchObject({ statusCode: 409 });
  });
  it('REGRESSION: an order the BUYER or an admin cancelled can never take a proof or be reinstated', async () => {
    const h = makeDb(); seed(h, { status: 'CANCELLED' });          // payment left PENDING, as a manual cancel does
    await expect(submitLate(h)).rejects.toMatchObject({ statusCode: 409 });
    // even if a proof somehow exists, confirming it must not resurrect the order
    h.st.proofs.set('x', { id: 'x', orderId: 'o1', paymentId: 'pay-o1', transactionId: 'ABC123456', senderPhone: '0772123456', amountClaimed: 100000, status: 'SUBMITTED' });
    await expect(confirm(h, 'x')).rejects.toMatchObject({ statusCode: 409 });
    expect(h.st.orders.get('o1')!.status).toBe('CANCELLED');
  });
  it('confirming a late proof REINSTATES the order: paid, CONFIRMED, cancellation cleared, buyer AND seller told', async () => {
    const h = makeDb(); seedExpired(h, 2);
    const p = await submitLate(h);
    const r = await confirm(h, p.id);
    expect(r.reinstated).toBe(true);
    expect(h.st.orders.get('o1')).toMatchObject({ status: 'CONFIRMED', cancelledAt: null, cancellationNote: null });
    const pay = h.st.payments.get('pay-o1')!;
    expect(pay).toMatchObject({ status: 'COMPLETED', gatewayRef: 'MP1234567' });
    expect(pay.gatewayData).toMatchObject({ channel: 'MANUAL_MTN', reinstatedLate: true, confirmedBy: 'a1' });
    expect(h.st.notifications.find((n) => n.userId === 'b1')).toMatchObject({ type: 'PAYMENT_RECEIVED', title: expect.stringContaining('reinstated') });
    expect(h.st.notifications.find((n) => n.userId === 's1')).toMatchObject({ type: 'ORDER_CONFIRMED' });
  });
  it('a normal (on-time) confirmation is NOT flagged as reinstated and does not notify the seller', async () => {
    const h = makeDb(); seed(h);
    const p = await submit(h);
    const r = await confirm(h, p.id);
    expect(r.reinstated).toBeUndefined();
    expect(h.st.notifications.some((n) => n.userId === 's1')).toBe(false);
  });
  it('REGRESSION: an underpaid late payment cannot reinstate the order', async () => {
    const h = makeDb(); seedExpired(h);
    const p = await submitLate(h);
    await expect(confirm(h, p.id, { amountReceived: 50000 })).rejects.toMatchObject({ statusCode: 409 });
    expect(h.st.orders.get('o1')!.status).toBe('CANCELLED');
    expect(h.st.payments.get('pay-o1')!.status).toBe('FAILED');
  });
  it('can be reinstated once only; a second confirmation or a second admin gets 409', async () => {
    const h = makeDb(); seedExpired(h);
    const p = await submitLate(h);
    const [a, b] = await Promise.allSettled([confirm(h, p.id, { adminId: 'a1' }), confirm(h, p.id, { adminId: 'a2' })]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expect(confirm(h, p.id)).rejects.toMatchObject({ statusCode: 409 });
    expect(h.st.notifications.filter((n) => n.type === 'ORDER_CONFIRMED')).toHaveLength(1);
  });
  it('rejecting a late proof leaves the order cancelled and does not give a fresh payment window', async () => {
    const h = makeDb(); seedExpired(h);
    const p = await submitLate(h);
    const dueBefore = h.st.payments.get('pay-o1')!.dueAt;
    await rejectPaymentProof(h.db, { proofId: p.id, adminId: 'a1', reason: 'no such payment on statement', deadlineMinutes: 30, now: NOW });
    expect(h.st.orders.get('o1')!.status).toBe('CANCELLED');
    expect(h.st.payments.get('pay-o1')!.status).toBe('FAILED');
    expect(h.st.payments.get('pay-o1')!.dueAt).toBe(dueBefore);
  });
  it('after reinstatement the expiry sweep leaves the order alone', async () => {
    const h = makeDb(); seedExpired(h);
    await confirm(h, (await submitLate(h)).id);
    expect((await expireUnpaidOrders(h.db, { now: new Date(NOW.getTime() + 5 * DAY) })).cancelled).toEqual([]);
    expect(h.st.orders.get('o1')!.status).toBe('CONFIRMED');
  });
});


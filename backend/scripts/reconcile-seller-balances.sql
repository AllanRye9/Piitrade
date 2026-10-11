-- Seller balance reconciliation. Run AFTER the 20261011090000 and
-- 20261011130000 migrations. A seller's balance should equal
--     payouts credited at delivery
--   - payouts reversed by refunds
--   - withdrawals that were not rejected.
-- (Assumes a single currency per seller; adjust if sellers mix currencies.)
-- Review each row by hand; nothing here corrects anything.

-- 1) EXCESS: balance higher than the orders and withdrawals can explain. This is
--    the footprint of the old repeat-DELIVERED bug, and of orders refunded before
--    payout reversal existed (their payoutReversedAt is NULL).
SELECT u.id,
       u.email,
       u.balance,
       COALESCE(p.credited, 0)                                                                 AS credited_by_orders,
       COALESCE(p.reversed, 0)                                                                 AS reversed_by_refunds,
       COALESCE(w.taken, 0)                                                                    AS withdrawn_or_pending,
       u.balance - (COALESCE(p.credited, 0) - COALESCE(p.reversed, 0) - COALESCE(w.taken, 0))  AS excess
FROM "User" u
LEFT JOIN (
  SELECT "sellerId",
         SUM("sellerPayout") FILTER (WHERE "payoutCreditedAt" IS NOT NULL) AS credited,
         SUM("sellerPayout") FILTER (WHERE "payoutReversedAt" IS NOT NULL) AS reversed
  FROM "Order"
  GROUP BY "sellerId"
) p ON p."sellerId" = u.id
LEFT JOIN (
  SELECT "userId", SUM(amount) AS taken
  FROM "Withdrawal"
  WHERE status <> 'REJECTED'
  GROUP BY "userId"
) w ON w."userId" = u.id
WHERE u.balance - (COALESCE(p.credited, 0) - COALESCE(p.reversed, 0) - COALESCE(w.taken, 0)) > 0.01
ORDER BY excess DESC;

-- 2) DEBTORS: negative balance = the seller withdrew money for an order that was
--    later refunded. They cannot withdraw again until later sales cover it.
SELECT u.id, u.email, u.balance
FROM "User" u
WHERE u.balance < 0
ORDER BY u.balance ASC;

-- 3) REFUNDED BEFORE REVERSAL EXISTED: orders refunded earlier were never taken
--    back from the seller, yet their balance still "adds up" (credited, never
--    reversed), so query 1 cannot see them. Decide case by case whether to claw
--    the payout back (e.g. by handling it as a refund now).
SELECT o.id, o."orderNumber", o."sellerId", o."sellerPayout", o."updatedAt"
FROM "Order" o
WHERE o.status = 'REFUNDED'
  AND o."payoutCreditedAt" IS NOT NULL
  AND o."payoutReversedAt" IS NULL
ORDER BY o."updatedAt" DESC;


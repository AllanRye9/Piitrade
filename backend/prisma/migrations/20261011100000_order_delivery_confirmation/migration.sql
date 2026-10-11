-- Proof of delivery. A seller can only mark an order DELIVERED by entering the
-- customer's 6-digit delivery code (or the buyer confirms receipt themselves,
-- or an admin overrides with a written reason). The code is DERIVED from a
-- server secret and is never stored; these columns hold only the audit trail.
--
--   deliveryCodeAttempts   wrong guesses so far; the order locks after 5
--   deliveryConfirmMethod  BUYER | CODE | ADMIN_OVERRIDE | NONE
--   deliveryConfirmedById  user who confirmed (no FK on purpose: audit data
--                          must survive the user being deleted)
--   deliveryOverrideReason admin's reason when no code was used
--
-- Additive. Existing rows get attempts = 0 and NULL for the rest.
ALTER TABLE "Order" ADD COLUMN "deliveryCodeAttempts"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "deliveryConfirmMethod"  TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryConfirmedById"  TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryOverrideReason" TEXT;

-- Manual rollback for 20261011100000_order_delivery_confirmation. Remove the
-- row from "_prisma_migrations" and the four fields from schema.prisma too.
-- Dropping discards the delivery-confirmation audit trail.
ALTER TABLE "Order" DROP COLUMN "deliveryOverrideReason";
ALTER TABLE "Order" DROP COLUMN "deliveryConfirmedById";
ALTER TABLE "Order" DROP COLUMN "deliveryConfirmMethod";
ALTER TABLE "Order" DROP COLUMN "deliveryCodeAttempts";

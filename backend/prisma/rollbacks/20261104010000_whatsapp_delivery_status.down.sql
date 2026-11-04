DROP INDEX IF EXISTS "NotificationDelivery_providerMessageId_idx";
ALTER TABLE "NotificationDelivery" DROP COLUMN IF EXISTS "providerStatusAt";
ALTER TABLE "NotificationDelivery" DROP COLUMN IF EXISTS "providerStatus";
ALTER TABLE "NotificationDelivery" DROP COLUMN IF EXISTS "providerMessageId";

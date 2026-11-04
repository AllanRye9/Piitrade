-- WhatsApp delivery receipts: remember Meta's message id for each send and the latest receipt
-- (sent / delivered / read / failed) reported on the webhook. Additive and idempotent.
CREATE TABLE IF NOT EXISTS "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDelivery_notificationId_channel_key"
    ON "NotificationDelivery"("notificationId", "channel");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_userId_channel_createdAt_idx"
    ON "NotificationDelivery"("userId", "channel", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_createdAt_idx"
    ON "NotificationDelivery"("createdAt");

ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "providerStatus" TEXT;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "providerStatusAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "NotificationDelivery_providerMessageId_idx" ON "NotificationDelivery"("providerMessageId");

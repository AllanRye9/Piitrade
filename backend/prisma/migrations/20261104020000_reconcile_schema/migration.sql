-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'COUNTERED', 'WITHDRAWN', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'OFFER_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_COUNTERED';
ALTER TYPE "NotificationType" ADD VALUE 'LISTING_ALERT';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "menuGroup" TEXT,
ADD COLUMN     "shortName" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CvDownloadToken" ADD COLUMN     "downloadCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "acceptsOffers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hiddenByModerator" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentReminderSentAt" TIMESTAMP(3),
ALTER COLUMN "condition" SET DEFAULT 'NEW';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "offerId" TEXT;

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "receiptEmailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "receiptEmailedAt" TIMESTAMP(3),
ADD COLUMN     "receiptIssuedAt" TIMESTAMP(3),
ADD COLUMN     "receiptNumber" TEXT;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "safetyNote" TEXT,
ADD COLUMN     "safetyStatus" TEXT NOT NULL DEFAULT 'UNSCREENED',
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SavedSearch" ADD COLUMN     "categorySlug" TEXT,
ADD COLUMN     "lastAlertAt" TIMESTAMP(3),
ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifySound" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SellerPackage" ADD COLUMN     "activatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SiteConfig" ADD COLUMN     "homeLayout" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "UserDocument" ALTER COLUMN "isPublic" SET DEFAULT false;

-- CreateTable
CREATE TABLE "PriceOffer" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "madeById" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "parentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "notifyMessages" BOOLEAN NOT NULL DEFAULT true,
    "whatsappNumber" TEXT,
    "whatsappVerifiedAt" TIMESTAMP(3),
    "whatsappCodeHash" TEXT,
    "whatsappCodeExpiresAt" TIMESTAMP(3),
    "whatsappCodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ListingAlertDelivery" (
    "id" TEXT NOT NULL,
    "savedSearchId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingAlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminWipeChallenge" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminWipeChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetEmail" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingAlertEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceOffer_listingId_buyerId_createdAt_idx" ON "PriceOffer"("listingId", "buyerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PriceOffer_buyerId_status_idx" ON "PriceOffer"("buyerId", "status");

-- CreateIndex
CREATE INDEX "PriceOffer_sellerId_status_idx" ON "PriceOffer"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "ListingAlertDelivery_savedSearchId_idx" ON "ListingAlertDelivery"("savedSearchId");

-- CreateIndex
CREATE INDEX "ListingAlertDelivery_userId_createdAt_idx" ON "ListingAlertDelivery"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ListingAlertDelivery_listingId_userId_key" ON "ListingAlertDelivery"("listingId", "userId");

-- CreateIndex
CREATE INDEX "AdminWipeChallenge_adminId_createdAt_idx" ON "AdminWipeChallenge"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetId_idx" ON "AdminAuditLog"("targetId");

-- CreateIndex
CREATE INDEX "ListingAlertEvent_processedAt_createdAt_idx" ON "ListingAlertEvent"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Translation_locale_idx" ON "Translation"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "Translation_locale_key_key" ON "Translation"("locale", "key");

-- CreateIndex
CREATE INDEX "Category_parentId_sortOrder_idx" ON "Category"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Message_offerId_idx" ON "Message"("offerId");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_receiptNumber_key" ON "PaymentTransaction"("receiptNumber");

-- CreateIndex
CREATE INDEX "ProductImage_status_submittedAt_idx" ON "ProductImage"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "SavedSearch_emailAlert_categorySlug_idx" ON "SavedSearch"("emailAlert", "categorySlug");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PriceOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceOffer" ADD CONSTRAINT "PriceOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceOffer" ADD CONSTRAINT "PriceOffer_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceOffer" ADD CONSTRAINT "PriceOffer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAlertDelivery" ADD CONSTRAINT "ListingAlertDelivery_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAlertDelivery" ADD CONSTRAINT "ListingAlertDelivery_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAlertDelivery" ADD CONSTRAINT "ListingAlertDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


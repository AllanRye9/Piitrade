-- Tracks the one-off unpaid-visibility reminder for a listing.
ALTER TABLE "Listing" ADD COLUMN "paymentReminderSentAt" TIMESTAMP(3);

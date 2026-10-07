-- Tracks whether the renewal-reminder email for a rental's *current*
-- endDate has already gone out, so the scheduled job (see
-- sendStoreRenewalReminders in backend/src/routes/storeRentals.ts) never
-- sends the same reminder twice. Cleared to null whenever a rental is
-- renewed with a new endDate, so the next expiry gets its own reminder.
ALTER TABLE "StoreRental" ADD COLUMN "renewalReminderSentAt" TIMESTAMP(3);

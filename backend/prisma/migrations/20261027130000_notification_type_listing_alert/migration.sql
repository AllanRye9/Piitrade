-- New notification type for "a listing matched your alert". Kept in its own migration because a
-- new enum value cannot be used in the same transaction that adds it (20261024120000 does not use it
-- in SQL; the application does).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LISTING_ALERT';

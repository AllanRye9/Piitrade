-- New ads default to condition NEW (sellers can still pick Used).
ALTER TABLE "Listing" ALTER COLUMN "condition" SET DEFAULT 'NEW';

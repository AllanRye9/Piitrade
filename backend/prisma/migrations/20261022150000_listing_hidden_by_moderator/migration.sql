-- Distinguish "owner hid it" from "moderator removed it", so owners cannot undo a moderation action.
ALTER TABLE "Listing" ADD COLUMN "hiddenByModerator" BOOLEAN NOT NULL DEFAULT false;
-- Existing HIDDEN listings are treated as moderator-hidden (the safe side): an admin can release them.
UPDATE "Listing" SET "hiddenByModerator" = true WHERE "status" = 'HIDDEN';

-- AI ad moderation (Module 1): four nullable columns on Listing recording
-- the result of an LLM moderation check, if one was ever run. Null on every
-- column means "never checked" — distinct from a checked-and-approved
-- listing, which has moderationFlaggedCategory = 'none'. See
-- backend/src/lib/llm.ts and the moderation hook in POST /listings,
-- PUT /listings/:id, and POST /listings/bulk-produce.
ALTER TABLE "Listing" ADD COLUMN "moderationFlaggedCategory" TEXT;
ALTER TABLE "Listing" ADD COLUMN "moderationConfidence" DOUBLE PRECISION;
ALTER TABLE "Listing" ADD COLUMN "moderationReason" TEXT;
ALTER TABLE "Listing" ADD COLUMN "moderationCheckedAt" TIMESTAMP(3);

-- AI Customer Support chat (Module 2): the FAQ/policy text an admin pastes
-- in, which the support-chat LLM is restricted to answering from. See
-- backend/src/routes/support.ts.
ALTER TABLE "SiteConfig" ADD COLUMN "supportFaqContext" TEXT;

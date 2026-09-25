-- Presence for the chat UI's online/offline indicator (green = active
-- within the last 2 minutes, grey/null = offline or never seen). Touched
-- by a throttled update in the `authenticate` middleware on any
-- authenticated request, not a dedicated ping endpoint.
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

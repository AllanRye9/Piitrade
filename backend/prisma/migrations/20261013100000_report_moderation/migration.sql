-- Report moderation workflow (Admin → Reports). Idempotent.
DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "status" "ReportStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "resolution" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "adminNote" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;
CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report" ("status", "createdAt" DESC);

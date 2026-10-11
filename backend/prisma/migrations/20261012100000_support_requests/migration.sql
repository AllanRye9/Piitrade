-- AI Customer Support → human handoff queue.
CREATE TYPE "SupportRequestStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "SupportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "question" TEXT NOT NULL,
    "transcript" JSONB,
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'OPEN',
    "adminResponse" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportRequest_status_createdAt_idx" ON "SupportRequest"("status", "createdAt" DESC);
CREATE INDEX "SupportRequest_userId_idx" ON "SupportRequest"("userId");

-- One-time email confirmation codes for wiping analytics logs (Admin → log pages).
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

CREATE INDEX "AdminWipeChallenge_adminId_createdAt_idx" ON "AdminWipeChallenge"("adminId", "createdAt");

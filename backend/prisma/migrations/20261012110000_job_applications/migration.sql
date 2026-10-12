-- Job applications: the only channel through which a CV reaches a recruiter.
CREATE TYPE "JobApplicationStatus" AS ENUM ('SUBMITTED', 'SHORTLISTED', 'REJECTED');

CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "cvTitle" TEXT NOT NULL,
    "coverNote" TEXT,
    "phone" TEXT,
    "status" "JobApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobApplication_jobId_applicantId_key" ON "JobApplication"("jobId", "applicantId");
CREATE INDEX "JobApplication_jobId_createdAt_idx" ON "JobApplication"("jobId", "createdAt" DESC);
CREATE INDEX "JobApplication_applicantId_createdAt_idx" ON "JobApplication"("applicantId", "createdAt" DESC);

ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

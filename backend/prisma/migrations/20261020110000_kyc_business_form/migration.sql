-- Brief KYC form for Webstore / Partner verification (additive).
ALTER TABLE "User"
  ADD COLUMN "kycPurpose"           TEXT,
  ADD COLUMN "kycBusinessName"      TEXT,
  ADD COLUMN "kycBusinessRegNumber" TEXT,
  ADD COLUMN "kycPhone"             TEXT,
  ADD COLUMN "kycAddress"           TEXT;

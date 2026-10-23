-- New documents are private unless the owner explicitly shares them. Existing rows are left as they are.
ALTER TABLE "UserDocument" ALTER COLUMN "isPublic" SET DEFAULT false;

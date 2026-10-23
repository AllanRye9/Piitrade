-- A paid CV token can be released for a bounded number of downloads, not unlimited ones for 24h.
ALTER TABLE "CvDownloadToken" ADD COLUMN "downloadCount" INTEGER NOT NULL DEFAULT 0;

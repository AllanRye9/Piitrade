-- Admin-managed site translations (Admin → Translations).
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Translation_locale_idx" ON "Translation"("locale");

CREATE UNIQUE INDEX "Translation_locale_key_key" ON "Translation"("locale", "key");

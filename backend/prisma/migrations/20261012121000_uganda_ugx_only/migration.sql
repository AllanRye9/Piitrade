-- Uganda-only / UGX-only marketplace.
-- 1) Re-denominate any listing still priced in another currency into UGX using
--    the platform's default rates (UGX per 1 unit: AED 1021, KES 28.8, CNY 518,
--    USD 3780), rounded to the nearest 100 shillings. Idempotent: after this
--    runs every row has currency = 'UGX', so a re-run changes nothing.
UPDATE "Listing"
SET "price" = ROUND(("price" * CASE "currency"::text
        WHEN 'AED' THEN 1021 WHEN 'KES' THEN 28.8 WHEN 'CNY' THEN 518 WHEN 'USD' THEN 3780 ELSE 1 END) / 100) * 100,
    "originalPrice" = CASE WHEN "originalPrice" IS NULL THEN NULL ELSE
        ROUND(("originalPrice" * CASE "currency"::text
        WHEN 'AED' THEN 1021 WHEN 'KES' THEN 28.8 WHEN 'CNY' THEN 518 WHEN 'USD' THEN 3780 ELSE 1 END) / 100) * 100 END,
    "currency" = 'UGX'
WHERE "currency"::text <> 'UGX';

-- 2) Everything is in Uganda.
UPDATE "Listing" SET "country" = 'UGANDA' WHERE "country"::text <> 'UGANDA';
UPDATE "User"    SET "country" = 'UGANDA' WHERE "country"::text <> 'UGANDA';
UPDATE "JobPost" SET "country" = 'UGANDA' WHERE "country" <> 'UGANDA';

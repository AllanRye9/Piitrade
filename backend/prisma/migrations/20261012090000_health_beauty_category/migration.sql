-- Adds the "Health & Beauty" top-level category (and its subcategories).
-- The storefront already links to /listings?category=health-beauty, which was
-- a dead link because no such category existed. Idempotent: safe to re-run.
INSERT INTO "Category" ("id", "name", "slug", "icon")
VALUES (gen_random_uuid()::text, 'Health & Beauty', 'health-beauty', '💄')
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Category" ("id", "name", "slug", "icon", "parentId")
SELECT gen_random_uuid()::text, v.name, v.slug, v.icon, p."id"
FROM (VALUES
  ('Skincare',          'skincare',        '🧴'),
  ('Makeup',            'makeup',          '💄'),
  ('Hair Care',         'hair-care',       '💇'),
  ('Fragrances',        'fragrances',      '🌸'),
  ('Personal Care',     'personal-care',   '🧼'),
  ('Health & Wellness', 'health-wellness', '💊')
) AS v(name, slug, icon)
JOIN "Category" p ON p."slug" = 'health-beauty'
ON CONFLICT ("slug") DO NOTHING;

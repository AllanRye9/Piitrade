"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const router = (0, express_1.Router)();
// Default categories matching the frontend CategoryBar structure.
const DEFAULT_CATEGORIES = [
    { name: 'Motors', slug: 'motors', icon: '🚗' },
    { name: 'Property', slug: 'property', icon: '🏠' },
    { name: 'Jobs', slug: 'jobs', icon: '💼' },
    { name: 'CV Services', slug: 'cv-services', icon: '📄' },
    { name: 'Classifieds', slug: 'classifieds', icon: '📋' },
    { name: 'Electronics', slug: 'electronics', icon: '💻' },
    { name: 'Fashion', slug: 'fashion', icon: '👗' },
    { name: 'Furniture & Garden', slug: 'furniture', icon: '🛋️' },
    { name: 'Services', slug: 'services', icon: '🔧' },
    { name: 'Agriculture', slug: 'agriculture', icon: '🌾' },
];
const SUBCATEGORY_MAP = {
    motors: [
        { name: 'Used Cars', slug: 'used-cars', icon: '🚙' },
        { name: 'New Cars', slug: 'new-cars', icon: '🏎️' },
        { name: 'Classic Cars', slug: 'classic-cars', icon: '🚕' },
        { name: 'Motorcycles', slug: 'motorcycles', icon: '🏍️' },
        { name: 'Trucks & Buses', slug: 'trucks-buses', icon: '🚛' },
        { name: 'Boats', slug: 'boats', icon: '⛵' },
        { name: 'Car Parts', slug: 'car-parts', icon: '⚙️' },
        { name: 'Tyres & Wheels', slug: 'tyres-wheels', icon: '🛞' },
        { name: 'Car Accessories', slug: 'car-accessories', icon: '🪄' },
    ],
    property: [
        { name: 'Apartments for Rent', slug: 'apartments-rent', icon: '🏢' },
        { name: 'Houses for Rent', slug: 'houses-rent', icon: '🏠' },
        { name: 'Rooms for Rent', slug: 'rooms-rent', icon: '🛏️' },
        { name: 'Apartments for Sale', slug: 'apartments-sale', icon: '🏗️' },
        { name: 'Houses for Sale', slug: 'houses-sale', icon: '🏡' },
        { name: 'Land & Plots', slug: 'land-plots', icon: '🗺️' },
        { name: 'Office Space', slug: 'office-space', icon: '🏢' },
        { name: 'Shops & Retail', slug: 'shops-retail', icon: '🏪' },
        { name: 'Warehouses', slug: 'warehouses', icon: '🏭' },
    ],
    jobs: [
        { name: 'Full Time', slug: 'full-time', icon: '💼' },
        { name: 'Part Time', slug: 'part-time', icon: '🕐' },
        { name: 'Freelance', slug: 'freelance', icon: '💻' },
        { name: 'Technology', slug: 'technology', icon: '🖥️' },
        { name: 'Healthcare', slug: 'healthcare', icon: '🏥' },
        { name: 'Finance', slug: 'finance', icon: '💰' },
    ],
    'cv-services': [
        { name: 'CV Writing', slug: 'cv-writing', icon: '✍️' },
        { name: 'Resume Templates', slug: 'resume-templates', icon: '📐' },
        { name: 'LinkedIn Optimization', slug: 'linkedin-optimization', icon: '🔗' },
        { name: 'Career Coaching', slug: 'career-coaching', icon: '🧑‍🏫' },
        { name: 'Interview Preparation', slug: 'interview-preparation', icon: '🎤' },
        { name: 'Cover Letters', slug: 'cover-letters', icon: '📝' },
    ],
    classifieds: [
        { name: 'Furniture', slug: 'furniture-classifieds', icon: '🛋️' },
        { name: 'Appliances', slug: 'appliances', icon: '🏠' },
        { name: 'Tools & Garden', slug: 'tools-garden', icon: '🔧' },
        { name: 'Kids & Baby', slug: 'kids-baby', icon: '🧒' },
        { name: 'Sports & Outdoors', slug: 'sports-outdoors', icon: '⚽' },
        { name: 'Books & Hobbies', slug: 'books-hobbies', icon: '📚' },
    ],
    electronics: [
        { name: 'Laptops', slug: 'laptops', icon: '💻' },
        { name: 'Desktops & Monitors', slug: 'desktops', icon: '🖥️' },
        { name: 'Tablets', slug: 'tablets', icon: '📱' },
        { name: 'Smartphones', slug: 'smartphones', icon: '📱' },
        { name: 'Headphones', slug: 'headphones', icon: '🎧' },
        { name: 'Cameras', slug: 'cameras', icon: '📷' },
        { name: 'Consoles', slug: 'consoles', icon: '🎮' },
        { name: 'Games & Accessories', slug: 'games-accessories', icon: '🕹️' },
    ],
    fashion: [
        { name: "Women's Clothing", slug: 'women-clothing', icon: '👗' },
        { name: "Women's Shoes", slug: 'women-shoes', icon: '👠' },
        { name: 'Bags & Accessories', slug: 'women-bags', icon: '👜' },
        { name: "Men's Clothing", slug: 'men-clothing', icon: '👔' },
        { name: "Men's Shoes", slug: 'men-shoes', icon: '👞' },
        { name: 'Watches', slug: 'watches', icon: '⌚' },
        { name: "Girls' Clothing", slug: 'girls-clothing', icon: '👧' },
        { name: "Boys' Clothing", slug: 'boys-clothing', icon: '👦' },
    ],
    furniture: [
        { name: 'Living Room', slug: 'living-room', icon: '🛋️' },
        { name: 'Bedroom', slug: 'bedroom', icon: '🛏️' },
        { name: 'Kitchen & Dining', slug: 'kitchen-dining', icon: '🍳' },
        { name: 'Garden Furniture', slug: 'garden-furniture', icon: '🪴' },
        { name: 'BBQ & Grills', slug: 'bbq-grills', icon: '🔥' },
        { name: 'Plants & Seeds', slug: 'plants-seeds', icon: '🌱' },
    ],
    services: [
        { name: 'Cleaning', slug: 'cleaning', icon: '🧹' },
        { name: 'Plumbing & Electrical', slug: 'plumbing-electrical', icon: '🔌' },
        { name: 'Movers & Storage', slug: 'movers-storage', icon: '📦' },
        { name: 'Tutoring', slug: 'tutoring', icon: '📖' },
        { name: 'Design & Creative', slug: 'design-creative', icon: '🎨' },
        { name: 'IT & Tech Support', slug: 'it-tech-support', icon: '💻' },
    ],
    agriculture: [
        { name: 'Crops & Grains', slug: 'crops-grains', icon: '🌽' },
        { name: 'Fruits & Vegetables', slug: 'fruits-vegetables', icon: '🍅' },
        { name: 'Livestock', slug: 'livestock', icon: '🐄' },
        { name: 'Poultry & Eggs', slug: 'poultry-eggs', icon: '🐔' },
        { name: 'Dairy Products', slug: 'dairy-products', icon: '🥛' },
        { name: 'Seeds & Inputs', slug: 'seeds-inputs', icon: '🌱' },
        { name: 'Farm Equipment', slug: 'farm-equipment', icon: '🚜' },
    ],
};
// Track whether we've already seeded so we skip on subsequent requests.
let seeded = false;
router.get('/', async (_req, res, next) => {
    try {
        let categories = await prisma_1.prisma.category.findMany({
            where: { parentId: null },
            include: { children: true },
            orderBy: { name: 'asc' },
        });
        if (!seeded) {
            // Auto-seed default categories if the table is empty so the "create listing"
            // page always has categories to show even before an admin seeds the database.
            if (categories.length === 0) {
                for (const cat of DEFAULT_CATEGORIES) {
                    const parent = await prisma_1.prisma.category.upsert({
                        where: { slug: cat.slug },
                        update: {},
                        create: cat,
                    });
                    const subs = SUBCATEGORY_MAP[cat.slug] || [];
                    for (const sub of subs) {
                        await prisma_1.prisma.category.upsert({
                            where: { slug: sub.slug },
                            update: {},
                            create: { ...sub, parentId: parent.id },
                        });
                    }
                }
                categories = await prisma_1.prisma.category.findMany({
                    where: { parentId: null },
                    include: { children: true },
                    orderBy: { name: 'asc' },
                });
            }
            else {
                // Ensure all expected parent categories exist (add any missing ones).
                for (const cat of DEFAULT_CATEGORIES) {
                    const existing = categories.find((c) => c.slug === cat.slug);
                    let parentId = existing?.id;
                    if (!existing) {
                        const created = await prisma_1.prisma.category.upsert({
                            where: { slug: cat.slug },
                            update: {},
                            create: cat,
                        });
                        parentId = created.id;
                    }
                    // Ensure subcategories exist for this parent.
                    if (parentId && (existing?.children?.length ?? 0) === 0) {
                        const subs = SUBCATEGORY_MAP[cat.slug] || [];
                        for (const sub of subs) {
                            await prisma_1.prisma.category.upsert({
                                where: { slug: sub.slug },
                                update: {},
                                create: { ...sub, parentId },
                            });
                        }
                    }
                }
                categories = await prisma_1.prisma.category.findMany({
                    where: { parentId: null },
                    include: { children: true },
                    orderBy: { name: 'asc' },
                });
            }
            seeded = true;
        }
        // Category tree changes rarely (admin action only) but is fetched on
        // essentially every page load (nav mega-menu), so it's the single
        // highest-value endpoint on the site to cache — same convention used
        // for /site-config and the pricing feeds.
        res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
        res.json(categories);
    }
    catch (err) {
        next(err);
    }
});
// GET /api/categories/active-counts?country=UAE
// Returns { counts: { [categorySlug]: number } } — the number of ACTIVE
// listings currently posted directly into each category/subcategory,
// scoped to the given country (or global if no/invalid country is passed).
// Used by the public category pages to hide subcategories that have no
// listings yet, so visitors never land on an empty tab. A subcategory with
// zero ACTIVE listings simply won't appear as a key in `counts` — treat a
// missing key as 0, not as an error. This never affects the "create
// listing" category picker or the admin category screens, which must
// always show every subcategory regardless of content.
const PUBLIC_COUNT_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'];
router.get('/active-counts', async (req, res, next) => {
    try {
        const { country } = req.query;
        const scopedCountry = country && PUBLIC_COUNT_COUNTRIES.includes(country)
            ? country
            : null;
        const grouped = await prisma_1.prisma.listing.groupBy({
            by: ['categoryId'],
            where: {
                status: 'ACTIVE',
                ...(scopedCountry && { country: scopedCountry }),
            },
            _count: { _all: true },
        });
        if (grouped.length === 0) {
            res.json({ counts: {}, country: scopedCountry });
            return;
        }
        const categories = await prisma_1.prisma.category.findMany({
            where: { id: { in: grouped.map((g) => g.categoryId) } },
            select: { id: true, slug: true },
        });
        const idToSlug = new Map(categories.map((c) => [c.id, c.slug]));
        const counts = {};
        for (const g of grouped) {
            const slug = idToSlug.get(g.categoryId);
            if (slug)
                counts[slug] = g._count._all;
        }
        res.json({ counts, country: scopedCountry });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:slug/subcategories', async (req, res, next) => {
    try {
        const parent = await prisma_1.prisma.category.findUnique({ where: { slug: req.params.slug } });
        if (!parent) {
            res.status(404).json({ message: 'Category not found' });
            return;
        }
        const subcategories = await prisma_1.prisma.category.findMany({
            where: { parentId: parent.id },
            orderBy: { name: 'asc' },
        });
        res.json(subcategories);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=categories.js.map
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Normalise "postgres://" → "postgresql://" to avoid the P1012 validation
// error from Prisma's wasm-based config loader when DATABASE_URL uses the
// shorter scheme (common with some hosting providers).
const rawUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
if (!rawUrl) {
  console.error(
    'ERROR: DATABASE_URL is not set. ' +
    'Provide a valid PostgreSQL connection string before running the seed script.'
  );
  process.exit(1);
}
const databaseUrl = rawUrl.startsWith('postgres://')
  ? rawUrl.replace('postgres://', 'postgresql://')
  : rawUrl;

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main() {
  console.log('Seeding database...');

  // Create categories matching the frontend CategoryBar structure
  const categories = [
    { name: 'Motors', slug: 'motors', icon: '🚗' },
    { name: 'Property', slug: 'property', icon: '🏠' },
    { name: 'Jobs', slug: 'jobs', icon: '💼' },
    { name: 'CV Services', slug: 'cv-services', icon: '📄' },
    { name: 'Classifieds', slug: 'classifieds', icon: '📋' },
    { name: 'Electronics', slug: 'electronics', icon: '💻' },
    { name: 'Fashion', slug: 'fashion', icon: '👗' },
    { name: 'Furniture & Garden', slug: 'furniture', icon: '🛋️' },
    { name: 'Services', slug: 'services', icon: '🔧' },
  ];

  const subcategoryMap: Record<string, { name: string; slug: string; icon: string }[]> = {
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
  };

  for (const cat of categories) {
    const parent = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });

    const subs = subcategoryMap[cat.slug] || [];
    for (const sub of subs) {
      await prisma.category.upsert({
        where: { slug: sub.slug },
        update: {},
        create: { ...sub, parentId: parent.id },
      });
    }
  }

  // Create admin user
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123!', 12);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('WARNING: ADMIN_PASSWORD env var not set. Using default password — change this in production!');
  }
  await prisma.user.upsert({
    where: { email: 'admin@3relite.com' },
    update: {},
    create: {
      email: 'admin@3relite.com',
      password: adminPassword,
      name: 'Admin User',
      role: 'ADMIN',
      country: 'UAE',
      isVerified: true,
    },
  });

  // Seed default subscription packages
  const defaultPackages = [
    {
      name: 'Free Trial',
      description: '7-day free access to post up to 5 listings and connect with buyers. No payment required — start selling immediately.',
      scope: 'LISTING' as const,
      isFree: true,
      price: 0,
      currency: 'USD' as const,
      durationDays: 7,
      maxListings: 5,
      isActive: true,
    },
    {
      name: '1 Month Pass',
      description: 'Full access for 1 month. Post unlimited listings and reach thousands of buyers.',
      scope: 'LISTING' as const,
      isFree: false,
      price: 3,
      currency: 'USD' as const,
      durationDays: 30,
      maxListings: null,
      isActive: true,
    },
    {
      name: 'Yearly Plan',
      description: 'Best value — full access for an entire year. Unlimited listings, priority support, and maximum visibility.',
      scope: 'LISTING' as const,
      isFree: false,
      price: 18,
      currency: 'USD' as const,
      durationDays: 365,
      maxListings: null,
      isActive: true,
    },
    {
      name: 'CV Monthly Pro',
      description: 'Unlock all autonomous CV tools for 30 days: CV generator, templates, interview simulator, and cover letters.',
      scope: 'CV' as const,
      isFree: false,
      price: 5,
      currency: 'USD' as const,
      durationDays: 30,
      maxListings: null,
      isActive: true,
    },
    {
      name: 'CV Annual Pro',
      description: 'Best value for professionals: 12 months of full digital CV services without third-party processing.',
      scope: 'CV' as const,
      isFree: false,
      price: 30,
      currency: 'USD' as const,
      durationDays: 365,
      maxListings: null,
      isActive: true,
    },
  ];

  for (const pkg of defaultPackages) {
    const existing = await prisma.sellerPackage.findFirst({ where: { name: pkg.name, scope: pkg.scope } });
    if (!existing) {
      await prisma.sellerPackage.create({ data: pkg });
    }
  }

  console.log('Database seeded successfully!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

/**
 * Helpers for *.integration.test.ts — they need a real PostgreSQL with every migration applied:
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/piitrade_test npm run test:integration
 *
 * WARNING: resetDb() TRUNCATES every table. Point TEST_DATABASE_URL at a throwaway database only.
 */
export const TEST_DB = process.env.TEST_DATABASE_URL;

export function configureTestEnv(): void {
  if (!TEST_DB) return;
  process.env.DATABASE_URL = TEST_DB;
  delete process.env.DATABASE_PRIVATE_URL;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'integration-test-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-fedcba9876543210';
  process.env.CORS_ORIGIN = 'http://localhost:3000';
}

export async function loadDeps() {
  const { prisma } = await import('../utils/prisma');
  const { generateAccessToken } = await import('../utils/jwt');
  return { prisma, generateAccessToken };
}

type Prisma = Awaited<ReturnType<typeof loadDeps>>['prisma'];

export async function resetDb(prisma: Prisma): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let seq = 0;
export const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function mkUser(prisma: Prisma, over: Record<string, unknown> = {}) {
  const n = uid();
  return prisma.user.create({
    // personalId is UNIQUE with an empty-string default; the signup route always sets a real one.
    data: { email: `u${n}@test.local`, password: 'x', name: `User ${n}`, isVerified: true, personalId: `PI-${n}`, ...over },
  });
}

export async function mkCategory(prisma: Prisma, slug: string, parentId: string | null = null) {
  return prisma.category.create({ data: { name: slug, slug, parentId } });
}

export async function mkListing(prisma: Prisma, userId: string, categoryId: string, over: Record<string, unknown> = {}) {
  return prisma.listing.create({
    data: { title: `Item ${uid()}`, description: 'desc', price: 1000, location: 'Kampala', userId, categoryId, status: 'ACTIVE', ...over },
  });
}

export const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

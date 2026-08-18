import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Resolve the database URL.  On Railway, DATABASE_PRIVATE_URL is the internal
// private-network URL for PostgreSQL (faster, no egress costs, no public proxy).
// Fall back to DATABASE_URL for local development and other environments.
const rawUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
export const hasDatabaseConfig = Boolean(rawUrl);

const makeMissingDatabasePrisma = (): PrismaClient => {
  return new Proxy({} as PrismaClient, {
    get() {
      throw new Error(
        'No database URL found. Set DATABASE_URL (or DATABASE_PRIVATE_URL on Railway) ' +
        'to a valid PostgreSQL connection string before using Prisma.'
      );
    },
  });
};

const databaseUrl = rawUrl?.startsWith('postgres://')
  ? rawUrl.replace('postgres://', 'postgresql://')
  : rawUrl;

export const prisma =
  rawUrl
    ? (globalForPrisma.prisma ??
        new PrismaClient({
          datasources: { db: { url: databaseUrl } },
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        }))
    : makeMissingDatabasePrisma();

if (process.env.NODE_ENV !== 'production' && rawUrl) globalForPrisma.prisma = prisma;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const globalForPrisma = globalThis;
// Resolve the database URL. On Railway, DATABASE_PRIVATE_URL is the internal
// private-network URL for PostgreSQL (faster, no egress costs, no public proxy).
// Fall back to DATABASE_URL for local development and other environments.
const rawUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
if (!rawUrl) {
    throw new Error('No database URL found. Set DATABASE_URL (or DATABASE_PRIVATE_URL on Railway) ' +
        'to a valid PostgreSQL connection string, e.g. ' +
        'postgresql://user:pass@host:5432/dbname');
}
// Prisma 7 requires a driver adapter (or accelerateUrl) instead of the legacy
// datasources config object. Normalise the legacy postgres:// scheme first.
const databaseUrl = rawUrl.startsWith('postgres://')
    ? rawUrl.replace('postgres://', 'postgresql://')
    : rawUrl;
const adapter = new adapter_pg_1.PrismaPg({ connectionString: databaseUrl });
exports.prisma = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
if (process.env.NODE_ENV !== 'production')
    globalForPrisma.prisma = exports.prisma;
//# sourceMappingURL=prisma.js.map
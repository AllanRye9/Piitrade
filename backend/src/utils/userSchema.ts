import { Prisma } from '@prisma/client';
import { logger } from './logger';
import { prisma } from './prisma';

let cachedHasUserPersonalIdColumn: boolean | null = null;

export const hasUserPersonalIdColumn = async (): Promise<boolean> => {
  if (cachedHasUserPersonalIdColumn !== null) {
    return cachedHasUserPersonalIdColumn;
  }

  try {
    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'User'
          AND column_name = 'personalId'
      ) AS "exists"
    `);

    cachedHasUserPersonalIdColumn = Boolean(result[0]?.exists);

    if (!cachedHasUserPersonalIdColumn) {
      logger.warn('User.personalId column is missing; continuing without personalId until migrations are repaired.');
    }
  } catch (err) {
    logger.warn(`Could not verify User.personalId column availability: ${String(err)}`);
    cachedHasUserPersonalIdColumn = false;
  }

  return cachedHasUserPersonalIdColumn;
};

export const buildAuthResponseUserSelect = (includePersonalId: boolean): Prisma.UserSelect => ({
  id: true,
  email: true,
  name: true,
  role: true,
  country: true,
  companyName: true,
  agentLicense: true,
  agentType: true,
  website: true,
  createdAt: true,
  ...(includePersonalId ? { personalId: true } : {}),
});

export const buildAuthenticatedUserSelect = (includePersonalId: boolean): Prisma.UserSelect => ({
  id: true,
  email: true,
  name: true,
  password: true,
  role: true,
  country: true,
  isVerified: true,
  isBanned: true,
  refreshToken: true,
  createdAt: true,
  ...(includePersonalId ? { personalId: true } : {}),
});

export const buildCurrentUserSelect = (includePersonalId: boolean): Prisma.UserSelect => ({
  id: true,
  email: true,
  name: true,
  phone: true,
  avatar: true,
  role: true,
  country: true,
  isVerified: true,
  isKycVerified: true,
  kycStatus: true,
  cvThemeColor: true,
  companyName: true,
  registrationNumber: true,
  agentLicense: true,
  agentType: true,
  website: true,
  businessDescription: true,
  socialLinks: true,
  listingColumns: true,
  createdAt: true,
  ...(includePersonalId ? { personalId: true } : {}),
});

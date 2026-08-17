import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';

const router = Router();

/** Fallback country count when no visitor data is available yet. */
const DEFAULT_COUNTRY_COUNT = 4;

// IANA timezones for the countries this site serves (ISO 3166-1 alpha-2 codes).
// Used so "Today's Visitors" resets at local midnight for the visitor's
// selected/detected country rather than the server's local time.
const COUNTRY_TIMEZONES: Record<string, string> = {
  AE: 'Asia/Dubai', // UAE
  UG: 'Africa/Kampala', // Uganda
  KE: 'Africa/Nairobi', // Kenya
  CN: 'Asia/Shanghai', // China
};
const DEFAULT_TIMEZONE = 'Asia/Dubai'; // UAE is the site's primary/default market

function timezoneForCountry(countryCode: string | undefined): string {
  if (!countryCode) return DEFAULT_TIMEZONE;
  return COUNTRY_TIMEZONES[countryCode.toUpperCase()] ?? DEFAULT_TIMEZONE;
}

/** Returns a YYYY-MM-DD key for `date` as observed in `timeZone`'s local time. */
function dayKeyInTimezone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date); // en-CA formats as YYYY-MM-DD
  } catch {
    // Unknown/invalid timezone — fall back to UTC so we still get a stable key.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

/** Parses the stored JSON array of unique visitor country codes and returns the count. */
function getVisitorCountryCount(visitorCountries: string): number {
  try {
    const countries = JSON.parse(visitorCountries) as string[];
    return countries.length || DEFAULT_COUNTRY_COUNT;
  } catch {
    return DEFAULT_COUNTRY_COUNT;
  }
}

// GET /api/stats — returns real-time site statistics.
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [activeListings, totalUsers, totalListings, siteStat] = await Promise.all([
      prisma.listing.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count(),
      prisma.listing.count(),
      prisma.siteStat.findUnique({ where: { id: 'global' } }),
    ]);

    res.json({
      activeListings,
      totalUsers,
      totalListings,
      countries: siteStat ? getVisitorCountryCount(siteStat.visitorCountries) : DEFAULT_COUNTRY_COUNT,
      pageViews: siteStat ? Number(siteStat.pageViews) : 0,
      dailyVisitors: siteStat ? Number(siteStat.dailyVisitors) : 0,
    });
  } catch (err) {
    next(err);
  }
});


// GET /api/stats/public — compact public stats for homepage analytics section
// totalVisitors = cumulative count of unique device IDs ever seen (never resets)
// dailyVisitors = count of unique device IDs seen today, reset at local midnight
//   for the visitor's selected/detected country (?country=<ISO alpha-2>, else
//   the Cloudflare cf-ipcountry header, else the site's default timezone)
// totalCountries = count of unique countries
router.get('/public', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [siteStat, totalUsers] = await Promise.all([
      prisma.siteStat.findUnique({ where: { id: 'global' } }),
      prisma.user.count(),
    ]);

    let totalVisitors = 0;
    let dailyVisitors = 0;
    let totalCountries = DEFAULT_COUNTRY_COUNT;

    if (siteStat) {
      // Parse unique visitor IDs to get actual unique visitor count
      try {
        const uniqueIds = JSON.parse(siteStat.uniqueVisitorIds) as string[];
        totalVisitors = uniqueIds.length;
      } catch {
        totalVisitors = Number(siteStat.pageViews);
      }

      // If local midnight (for the relevant country) has passed since the
      // last recorded reset, today's count is stale zero it out for display
      // even though no /track call has landed yet to persist the reset.
      const countryCode =
        (req.query?.country as string | undefined) || (req.headers['cf-ipcountry'] as string | undefined);
      const timeZone = timezoneForCountry(countryCode);
      const currentDayKey = dayKeyInTimezone(new Date(), timeZone);
      const isStale = siteStat.lastResetDayKey !== '' && siteStat.lastResetDayKey !== currentDayKey;

      if (isStale) {
        dailyVisitors = 0;
      } else {
        try {
          const dailyIds = JSON.parse(siteStat.dailyVisitorIds) as string[];
          dailyVisitors = dailyIds.length;
        } catch {
          dailyVisitors = Number(siteStat.dailyVisitors);
        }
      }

      totalCountries = getVisitorCountryCount(siteStat.visitorCountries);
    }

    res.json({
      totalVisitors,
      dailyVisitors,
      totalCountries,
      totalUsers,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/stats/track — tracks a visitor by unique device ID
// Accepts:
//   - deviceId: unique identifier for this device/browser (required)
//   - country: ISO 3166-1 alpha-2 country code (optional)
// Updates:
//   - uniqueVisitorIds: all unique devices ever seen
//   - dailyVisitorIds: unique devices seen today (reset each day)
//   - visitorCountries: unique countries from all visitors
router.post('/track', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();

    // Device ID is required for accurate deduplication
    const deviceId: string | undefined = req.body?.deviceId as string | undefined;
    if (!deviceId || deviceId.trim() === '') {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    // Accept country from request body or Cloudflare header
    const countryCode: string | undefined =
      (req.body?.country as string | undefined) ||
      (req.headers['cf-ipcountry'] as string | undefined);

    // Day boundary is based on the local time of this visitor's selected/
    // detected country, not the server's local time.
    const timeZone = timezoneForCountry(countryCode);
    const todayKey = dayKeyInTimezone(now, timeZone);

    const current = await prisma.siteStat.findUnique({ where: { id: 'global' } });

    if (!current) {
      const initialCountries = countryCode ? JSON.stringify([countryCode.toUpperCase()]) : '[]';
      // Initialize countryVisitCounts map with first visit
      const initialVisitCounts = countryCode ? JSON.stringify({ [countryCode.toUpperCase()]: 1 }) : '{}';
      await prisma.siteStat.create({
        data: {
          id: 'global',
          pageViews: BigInt(1),
          dailyVisitors: BigInt(1),
          lastDailyReset: now,
          lastResetDayKey: todayKey,
          visitorCountries: initialCountries,
          countryVisitCounts: initialVisitCounts, // Track per-country visit counts
          uniqueVisitorIds: JSON.stringify([deviceId]),
          dailyVisitorIds: JSON.stringify([deviceId]),
        },
      });
    } else {
      // Treat a blank lastResetDayKey (pre-migration rows) as "different from
      // today" so existing deployments pick up the timezone-aware key on the
      // very next track call, without losing any previously stored data.
      const isNewDay = current.lastResetDayKey !== todayKey;

      // Parse and update unique visitor IDs
      let uniqueIds: string[] = [];
      try {
        uniqueIds = JSON.parse(current.uniqueVisitorIds) as string[];
      } catch {
        uniqueIds = [];
      }

      // Parse and update daily visitor IDs
      let dailyIds: string[] = [];
      try {
        dailyIds = JSON.parse(current.dailyVisitorIds) as string[];
      } catch {
        dailyIds = [];
      }

      // Add device ID to unique visitors if new
      if (!uniqueIds.includes(deviceId)) {
        uniqueIds.push(deviceId);
      }

      // Handle daily reset
      if (isNewDay) {
        dailyIds = [deviceId]; // Reset to just this device
      } else if (!dailyIds.includes(deviceId)) {
        dailyIds.push(deviceId); // Add device if not already in today's list
      }

      // Update unique visitor countries if a new country is detected
      let updatedCountries: string | undefined;
      let updatedVisitCounts: string | undefined;
      if (countryCode) {
        try {
          const code = countryCode.toUpperCase();
          // Update unique countries list
          const countries = JSON.parse(current.visitorCountries) as string[];
          if (!countries.includes(code)) {
            countries.push(code);
            updatedCountries = JSON.stringify(countries);
          }
          // Always increment per-country visit count regardless of uniqueness
          let visitCounts: Record<string, number> = {};
          try { visitCounts = JSON.parse(current.countryVisitCounts || '{}') as Record<string, number>; } catch { visitCounts = {}; }
          visitCounts[code] = (visitCounts[code] ?? 0) + 1;
          updatedVisitCounts = JSON.stringify(visitCounts);
        } catch {
          updatedCountries = JSON.stringify([countryCode.toUpperCase()]);
          updatedVisitCounts = JSON.stringify({ [countryCode.toUpperCase()]: 1 });
        }
      }

      await prisma.siteStat.update({
        where: { id: 'global' },
        data: {
          pageViews: { increment: BigInt(1) },
          dailyVisitors: BigInt(dailyIds.length),
          uniqueVisitorIds: JSON.stringify(uniqueIds),
          dailyVisitorIds: JSON.stringify(dailyIds),
          ...(isNewDay ? { lastDailyReset: now, lastResetDayKey: todayKey } : {}),
          ...(updatedCountries !== undefined ? { visitorCountries: updatedCountries } : {}),
          ...(updatedVisitCounts !== undefined ? { countryVisitCounts: updatedVisitCounts } : {}), // Persist per-country counts
        },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;


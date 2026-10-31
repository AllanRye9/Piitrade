import jwt from 'jsonwebtoken';

// Session length. The access token is re-issued silently, and the refresh token is rotated (and its expiry
// pushed out) on every refresh, so an ACTIVE user is never signed out; only someone away for the whole
// refresh window is. Defaults: 70 days access, 3650 days (10 years) of inactivity before a sign-in is needed again.
// Override with JWT_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN (e.g. "30m", "12h", "90d").
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '70d';
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '3650d';

/** "12h" / "90d" / "30m" / "45s" / plain seconds -> milliseconds (null when unparseable). */
export function durationToMs(value: string): number | null {
  const m = /^\s*(\d+)\s*(s|m|h|d)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  return n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
}

function getJwtSecrets(): { accessSecret: string; refreshSecret: string } {
  const accessSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  if (!accessSecret || !refreshSecret) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set');
  }

  return { accessSecret, refreshSecret };
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export const generateAccessToken = (payload: JwtPayload): string => {
  const { accessSecret } = getJwtSecrets();
  return jwt.sign(payload, accessSecret, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' } as jwt.SignOptions);
};

export const generateRefreshToken = (payload: JwtPayload): string => {
  const { refreshSecret } = getJwtSecrets();
  return jwt.sign(payload, refreshSecret, { expiresIn: JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' } as jwt.SignOptions);
};

export const verifyAccessToken = (token: string): JwtPayload => {
  const { accessSecret } = getJwtSecrets();
  return jwt.verify(token, accessSecret, { algorithms: ['HS256'] }) as JwtPayload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  const { refreshSecret } = getJwtSecrets();
  return jwt.verify(token, refreshSecret, { algorithms: ['HS256'] }) as JwtPayload;
};

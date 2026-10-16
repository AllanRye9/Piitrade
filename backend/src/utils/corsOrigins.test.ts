import { describe, it, expect } from 'vitest';
import { getAllowedOrigins, isAllowedOrigin } from './corsOrigins';

describe('getAllowedOrigins', () => {
  it('never honours a wildcard when credentials are in use', () => {
    expect(getAllowedOrigins({ CORS_ORIGIN: '*' })).not.toContain('*');
    expect(getAllowedOrigins({ CORS_ORIGIN: 'https://a.com, * ,https://b.com' })).toEqual(
      expect.arrayContaining(['https://a.com', 'https://b.com']),
    );
  });
  it('trims, strips trailing slashes and always includes the production site', () => {
    const o = getAllowedOrigins({ CORS_ORIGIN: ' https://a.com/ ' });
    expect(o).toContain('https://a.com');
    expect(o).toContain('https://piitrade.com');
  });
});

describe('isAllowedOrigin', () => {
  const allowed = ['https://piitrade.com'];
  it('matches exactly, not by substring', () => {
    expect(isAllowedOrigin('https://piitrade.com', allowed)).toBe(true);
    expect(isAllowedOrigin('https://piitrade.com.evil.io', allowed)).toBe(false);
    expect(isAllowedOrigin('https://evilpiitrade.com', allowed)).toBe(false);
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });
});

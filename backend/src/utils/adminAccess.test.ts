import { describe, it, expect } from 'vitest';
import { requiredAdminAccess, adminMayAccess, sanitizePermissions, ADMIN_PERMISSIONS, adminOverrideAccess, keepsAdminPowers } from './adminAccess';

const primary = { role: 'ADMIN', isPrimaryAdmin: true, adminPermissions: [] as string[] };
const sec = (p: string[]) => ({ role: 'ADMIN', isPrimaryAdmin: false, adminPermissions: p });

describe('requiredAdminAccess', () => {
  it('maps areas', () => {
    expect(requiredAdminAccess('/api/admin/listings/123/approve')).toBe('listings');
    expect(requiredAdminAccess('/api/admin/click-logs/most-clicked')).toBe('analytics');
    expect(requiredAdminAccess('/api/admin/logs')).toBe('analytics');
    expect(requiredAdminAccess('/api/admin/users')).toBe('users');
    expect(requiredAdminAccess('/api/admin/kyc/5')).toBe('users');
    expect(requiredAdminAccess('/api/admin/transactions/export')).toBe('payments');
    expect(requiredAdminAccess('/api/payments/admin/list')).toBe('payments');
    expect(requiredAdminAccess('/api/admin/stores/partners')).toBe('stores');
    expect(requiredAdminAccess('/api/store-rentals/admin/all')).toBe('stores');
    expect(requiredAdminAccess('/api/support/admin/requests')).toBe('support');
    expect(requiredAdminAccess('/api/blog/admin/all')).toBe('content');
    expect(requiredAdminAccess('/api/admin/translations/x')).toBe('content');
    expect(requiredAdminAccess('/api/admin/site-config/tier-pricing')).toBe('settings');
    expect(requiredAdminAccess('/api/admin/site-config/deals')).toBe('content');
    expect(requiredAdminAccess('/api/admin/me')).toBe('any');
  });
  it('is primary-only for sensitive and unmapped paths', () => {
    for (const p of ['/api/admin/backup/restore', '/api/admin/admins', '/api/admin/admins/1/permissions', '/api/admin/users/9/approve-admin',
      '/api/admin/users/admin-approval-audit', '/api/payments/admin/switch', '/api/payments/admin/airtel/switch', '/api/payments/admin/status', '/api/admin/brand-new-thing']) {
      expect(requiredAdminAccess(p)).toBe('primary');
    }
  });
  it('ignores query strings and trailing slashes', () => {
    expect(requiredAdminAccess('/api/admin/listings/?page=2')).toBe('listings');
  });
});

describe('adminMayAccess', () => {
  it('primary can do everything', () => {
    expect(adminMayAccess(primary, 'primary')).toBe(true);
    expect(adminMayAccess(primary, 'payments')).toBe(true);
  });
  it('secondary only gets granted areas, never primary-only', () => {
    expect(adminMayAccess(sec(['listings']), 'listings')).toBe(true);
    expect(adminMayAccess(sec(['listings']), 'payments')).toBe(false);
    expect(adminMayAccess(sec([]), 'any')).toBe(true);
    expect(adminMayAccess(sec([...ADMIN_PERMISSIONS]), 'primary')).toBe(false);
  });
  it('non-admins never pass', () => {
    expect(adminMayAccess({ role: 'SELLER', isPrimaryAdmin: true }, 'any')).toBe(false);
  });
});

describe('sanitizePermissions', () => {
  it('keeps only known keys, de-duplicated', () => {
    expect(sanitizePermissions(['users', 'users', 'nope', 7, 'stores'])).toEqual(['users', 'stores']);
    expect(sanitizePermissions('users')).toEqual([]);
  });
});

describe('admin overrides on user-facing routes', () => {
  it('maps the routes that carry inline admin checks', () => {
    expect(adminOverrideAccess('/api/listings/abc/status')).toBe('listings');
    expect(adminOverrideAccess('/api/upload/doc/1')).toBe('listings');
    expect(adminOverrideAccess('/api/jobs/9')).toBe('listings');
    expect(adminOverrideAccess('/api/farmer-marketplace/posts/1')).toBe('content');
    expect(adminOverrideAccess('/api/payments/abc/receipt.pdf')).toBe('payments');
    expect(adminOverrideAccess('/api/users/me')).toBeNull();
  });
  it('primary always keeps admin powers; secondary only with the permission', () => {
    expect(keepsAdminPowers(primary, '/api/listings/1')).toBe(true);
    expect(keepsAdminPowers(sec([]), '/api/listings/1')).toBe(false);
    expect(keepsAdminPowers(sec(['listings']), '/api/listings/1')).toBe(true);
    expect(keepsAdminPowers(sec([]), '/api/users/me')).toBe(true);
    expect(keepsAdminPowers(sec(['listings']), '/api/payments/x/receipt.pdf')).toBe(false);
  });
});

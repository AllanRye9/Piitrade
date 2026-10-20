-- Webstore plans become admin-managed packages. The enum value is added on its own so the next
-- migration (a separate transaction) can use it.
ALTER TYPE "PackageScope" ADD VALUE IF NOT EXISTS 'STORE';

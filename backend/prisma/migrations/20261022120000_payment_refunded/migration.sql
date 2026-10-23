-- A refunded payment is not a granted one: admins resolving a NEEDS_REVIEW payment choose GRANTED
-- (stays SUCCESSFUL + provisioned) or REFUNDED (this status; provisionedAt stays NULL).
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

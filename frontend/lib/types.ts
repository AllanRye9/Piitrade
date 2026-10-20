export type Role = 'BUYER' | 'SELLER' | 'ADMIN' | 'AGENT' | 'ORGANIZATION' | 'COMPANY';
/** Uganda-only marketplace. */
export type Country = 'UGANDA';
/** UGX is the only currency used anywhere on the platform. */
export type Currency = 'UGX';
export type Condition = 'NEW' | 'USED';
export type ListingStatus = 'ACTIVE' | 'PENDING' | 'SOLD' | 'EXPIRED' | 'HIDDEN' | 'REJECTED';
export type Placement = 'NONE' | 'LATEST_COLLECTIONS' | 'FEATURED_DEAL' | 'FLASH_SALE' | 'BACK_TO_SCHOOL';
export type ImageStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type NotificationType =
  | 'ORDER_PLACED' | 'ORDER_CONFIRMED' | 'ORDER_SHIPPED' | 'ORDER_DELIVERED' | 'ORDER_CANCELLED'
  | 'PAYMENT_RECEIVED' | 'PAYMENT_FAILED'
  | 'RETURN_REQUESTED' | 'RETURN_APPROVED' | 'RETURN_REJECTED'
  | 'LISTING_APPROVED' | 'LISTING_REJECTED'
  | 'IMAGE_APPROVED' | 'IMAGE_REJECTED'
  | 'REVIEW_POSTED' | 'MESSAGE_RECEIVED'
  | 'WITHDRAWAL_APPROVED' | 'WITHDRAWAL_REJECTED'
  | 'SUBSCRIPTION_ACTIVATED' | 'SUBSCRIPTION_EXPIRED'
  | 'SYSTEM';

export interface User {
  id: string;
  email: string;
  personalId?: string;
  name: string;
  phone?: string;
  avatar?: string;
  role: Role;
  country: Country;
  isVerified: boolean;
  /** KYC (identity) verification status. See kycStatus for the full
   *  submission lifecycle — this mirrors kycStatus === 'APPROVED'. */
  isKycVerified?: boolean;
  kycStatus?: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  isBanned: boolean;
  balance?: number;
  cvThemeColor?: string | null;
  companyName?: string | null;
  registrationNumber?: string | null;
  agentLicense?: string | null;
  agentType?: string | null;
  website?: string | null;
  businessDescription?: string | null;
  socialLinks?: {
    twitter?: string;
    instagram?: string;
    linkedin?: string;
    facebook?: string;
    /** WhatsApp deep link — direct number chat (wa.me/...), group invite,
     *  or community invite link. Stored as-is and opened in a new tab. */
    whatsapp?: string;
    tiktok?: string;
    youtube?: string;
  } | null;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  parentId?: string;
  parent?: { id: string; name: string; slug: string } | null;
  children?: Category[];
  fieldSchema?: CategoryFieldDef[] | null;
}

export interface CategoryFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  options?: string[];
  required?: boolean;
}

export interface ProductImage {
  id: string;
  listingId?: string | null;
  sellerId: string;
  seller?: { id: string; name: string; email: string };
  listing?: { id: string; title: string } | null;
  tempPath: string;
  status: ImageStatus;
  cdnUrl?: string | null;
  previewUrl?: string;
  uploadedAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  price: number;
  originalPrice?: number | null;
  /** What `price` is quoted per. Defaults to 'ITEM' (price for the whole
   *  listing). Agriculture produce may instead be priced by weight — see
   *  the "Price unit" selector on the Agriculture quick-post form. */
  priceUnit?: 'ITEM' | 'KG' | 'TONNE';
  /** Visibility tier — Free/Gold/Platinum. See moderationFlaggedCategory
   *  below for the sibling AI-moderation fields; this one drives render
   *  priority and the Gold/Platinum badge on ListingCard. */
  tier?: 'FREE' | 'GOLD' | 'PLATINUM';
  /** Admin pin rank (lower = first; null/undefined = unpinned). Admin → Homepage Layout. */
  pinOrder?: number | null;
  /** What an ordinary user requested on the pre-post tier selector, not yet
   *  confirmed by an admin (payment not yet verified) — see the "Confirm
   *  Gold/Platinum" action in /admin/submissions. Null once resolved. */
  requestedTier?: 'GOLD' | 'PLATINUM' | null;
  /** AI ad moderation result (Module 1) — undefined/null on every field
   *  means the listing was never checked, not that it passed; a checked
   *  and approved listing has moderationFlaggedCategory 'none'. Shown to
   *  admins reviewing a PENDING listing, never to the seller. */
  moderationFlaggedCategory?: 'spam' | 'scam' | 'prohibited_goods' | 'none' | null;
  moderationConfidence?: number | null;
  moderationReason?: string | null;
  currency: Currency;
  condition: Condition;
  status: ListingStatus;
  images: string[];
  location: string;
  country: Country;
  views: number;
  /** Optional units available (bulk / produce). */
  quantity?: number | null;
  tags?: string[];
  createdAt: string;
  expiresAt?: string;
  placement?: Placement;
  placementExpiresAt?: string;
  userId: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
    phone?: string;
    isVerified?: boolean;
    /** KYC (identity) verification status — distinct from `isVerified` above.
     *  True once the seller's submitted ID documents have been approved by
     *  an admin. Drives the "KYC Verified" badge and listing priority. */
    isKycVerified?: boolean;
    role?: Role;
    /** True when the seller is a web store with an active (unexpired) store
     *  rental. Set by the backend on the listing detail and cart endpoints;
     *  absent elsewhere. Together with `role` it decides checkout vs contact. */
    hasActiveStore?: boolean;
    country?: string;
    createdAt?: string;
    /** Seller's WhatsApp contact, distinct from `phone` — may be a
     *  different number than the one used for direct calls. Falls back to
     *  `phone` for the Chat Seller button when unset. */
    socialLinks?: { whatsapp?: string } | null;
    store?: { id: string; name: string; slug: string; logo?: string | null; isActive?: boolean } | null;
  };
  category: Category;
  categoryId: string;
  motorDetails?: {
    make?: string;
    model?: string;
    year?: string;
    mileage?: string;
    fuelType?: string;
    transmission?: string;
    bodyType?: string;
    engineCC?: string;
    color?: string;
    doors?: string;
  };
  propertyDetails?: {
    propertyType?: string;
    listingType?: string;
    bedrooms?: string;
    bathrooms?: string;
    furnishedStatus?: string;
    sizeSqft?: string;
    floor?: string;
  } | null;
  jobDetails?: {
    employmentType?: string;
    salaryMin?: string;
    salaryMax?: string;
    experienceLevel?: string;
    workLocation?: string;
    industry?: string;
    applicationDeadline?: string;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
  productImages?: { id: string; cdnUrl: string | null; uploadedAt: string }[];
  /** Answers to the selected category's admin-defined fieldSchema, keyed by field name. */
  customFieldValues?: Record<string, string> | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

export interface Store {
  id: string;
  name: string;
  description?: string | null;
  logo?: string | null;
  banner?: string | null;
  slug: string;
  rating: number;
  ratingCount: number;
  isActive: boolean;
  userId: string;
  createdAt: string;
}

export interface Message {
  id: string;
  content: string;
  read: boolean;
  createdAt: string;
  senderId: string;
  receiverId: string;
  listingId: string | null;
  sender: { id: string; name: string; avatar?: string };
  receiver: { id: string; name: string; avatar?: string };
  listing?: { id: string; title: string; images: string[] };
}

export interface Review {
  id: string;
  rating: number;
  comment?: string;
  createdAt: string;
  reviewerId: string;
  revieweeId: string;
  reviewer: { id: string; name: string; avatar?: string };
}

export interface ProductReview {
  id: string;
  listingId: string;
  userId: string;
  user: { id: string; name: string; avatar?: string; email?: string };
  rating: number;
  title?: string | null;
  content: string;
  status: ReviewStatus;
  helpfulCount: number;
  verifiedPurchase: boolean;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  listing?: { id: string; title: string };
}

export interface ReviewAggregate {
  averageRating: number;
  total: number;
  breakdown: Record<number, { count: number; pct: number }>;
}

export interface PaginatedResponse<T> {
  listings?: T[];
  users?: T[];
  pagination: { total: number; page: number; limit: number; pages?: number };
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING_PAYMENT';
export type PackageScope = 'LISTING' | 'CV' | 'STORE';
export type StoreTier = 'FREE' | 'GOLD' | 'PLATINUM';

export interface SellerPackage {
  id: string;
  name: string;
  description?: string | null;
  scope: PackageScope;
  isFree: boolean;
  price: number;
  currency: Currency;
  durationDays: number;
  maxListings?: number | null;
  isActive: boolean;
  /** STORE scope only: the visibility tier a webstore on this package gets. */
  storeTier?: StoreTier | null;
  createdAt: string;
  updatedAt: string;
  _count?: { subscriptions: number };
}

export interface SellerSubscription {
  id: string;
  userId: string;
  packageId: string;
  package: SellerPackage;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string;
  paymentRef?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Real-time fields added by the API: status is derived from the dates at request time. */
  isCurrent?: boolean;
  /** Approved, but its term has not begun yet (an upgrade queued behind the current plan). */
  isScheduled?: boolean;
  daysRemaining?: number;
  storedStatus?: string;
  /** NEW | RENEWAL | UPGRADE */
  changeKind?: SubscriptionChangeKind;
  /** UPGRADE only: AFTER_EXPIRY starts when the current plan ends; IMMEDIATE replaces it on approval. */
  upgradeMode?: UpgradeMode | null;
  replacesId?: string | null;
  approvedAt?: string | null;
  adminNote?: string | null;
  /** The package terms this subscription was requested under (snapshot) — not the live package. */
  terms?: SubscriptionTerms;
  /** Admin list only: the plan an upgrade/renewal replaces. */
  replaces?: { id: string; packageName: string; endDate: string; status: SubscriptionStatus } | null;
  user?: { id: string; name: string; email: string; personalId?: string };
}

export type SubscriptionChangeKind = 'NEW' | 'RENEWAL' | 'UPGRADE';
export type UpgradeMode = 'AFTER_EXPIRY' | 'IMMEDIATE';

export interface SubscriptionTerms {
  packageName: string;
  price: number;
  currency: Currency | string;
  durationDays: number;
  /** null = unlimited */
  maxListings: number | null;
}


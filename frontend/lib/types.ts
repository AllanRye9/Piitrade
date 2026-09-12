export type Role = 'BUYER' | 'SELLER' | 'ADMIN' | 'AGENT' | 'ORGANIZATION' | 'COMPANY';
export type Country = 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA';
export type Currency = 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD';
export type Condition = 'NEW' | 'USED';
export type ListingStatus = 'ACTIVE' | 'PENDING' | 'SOLD' | 'EXPIRED' | 'HIDDEN' | 'REJECTED';
export type Placement = 'NONE' | 'LATEST_COLLECTIONS' | 'FEATURED_DEAL' | 'FLASH_SALE';
export type ImageStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type PaymentMethod = 'CARD' | 'BANK_TRANSFER' | 'CASH_ON_DELIVERY' | 'MOBILE_MONEY' | 'WALLET';
export type CouponType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
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
export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'REFUNDED';
export type WithdrawalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
export type AddressType = 'SHIPPING' | 'BILLING' | 'BOTH';

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
  currency: Currency;
  condition: Condition;
  status: ListingStatus;
  images: string[];
  location: string;
  country: Country;
  views: number;
  stock?: number;
  sku?: string;
  weightKg?: number;
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

export interface Address {
  id: string;
  userId: string;
  type: AddressType;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country: Country;
  isDefault: boolean;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  listingId: string;
  title: string;
  price: number;
  quantity: number;
  currency: Currency;
  imageUrl?: string | null;
  listing?: { id: string; title: string; images: string[] };
}

export interface Payment {
  id: string;
  orderId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: Currency;
  gatewayRef?: string | null;
  paidAt?: string | null;
  refundedAt?: string | null;
  refundAmount?: number | null;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: Currency;
  subtotal: number;
  shippingCost: number;
  discount: number;
  tax: number;
  total: number;
  notes?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  cancellationNote?: string | null;
  createdAt: string;
  updatedAt: string;
  buyerId: string;
  sellerId: string;
  buyer?: { id: string; name: string; avatar?: string; email?: string; phone?: string };
  seller?: { id: string; name: string; avatar?: string; email?: string };
  shippingAddress?: Address | null;
  coupon?: { code: string; type: CouponType; value: number } | null;
  items: OrderItem[];
  payment?: Payment | null;
  returns?: Return[];
}

export interface Return {
  id: string;
  orderId: string;
  buyerId: string;
  reason: string;
  description?: string | null;
  status: ReturnStatus;
  images: string[];
  resolution?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  buyer?: { id: string; name: string; email: string };
  order?: { id: string; orderNumber: string; total: number };
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

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minOrderAmount?: number | null;
  maxUses?: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt?: string | null;
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

export interface Withdrawal {
  id: string;
  userId: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  accountInfo: Record<string, unknown>;
  status: WithdrawalStatus;
  note?: string | null;
  processedAt?: string | null;
  createdAt: string;
}

export interface ShippingRate {
  id: string;
  name: string;
  description?: string | null;
  country: Country;
  minDays: number;
  maxDays: number;
  priceAed: number;
  priceUgx: number;
  priceKes: number;
  priceCny: number;
  isActive: boolean;
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
export type PackageScope = 'LISTING' | 'CV';

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
  user?: { id: string; name: string; email: string; personalId?: string };
}

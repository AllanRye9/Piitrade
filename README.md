# 3R Elite — Modern Marketplace Platform

**3R Elite** is a full-stack, multi-country e-commerce marketplace connecting buyers and sellers across the UAE, Uganda, Kenya, and China. It supports the full shopping lifecycle — listings, cart, checkout, orders, returns, seller stores, subscription packages, earnings withdrawals, and a powerful admin dashboard with content moderation, analytics, and site-wide configuration.**

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14 (App Router), React, Tailwind CSS |
| **Backend** | Node.js, Express.js, TypeScript |
| **Database** | PostgreSQL (via Prisma ORM) |
| **Auth** | JWT (access + refresh tokens, role-based: BUYER / SELLER / ADMIN) |
| **Storage / CDN** | S3-compatible (Railway bucket) → local `/uploads` fallback |
| **Email** | Resend → SMTP → log-only fallback |
| **Containerization** | Docker / Docker Compose |

---

## 🚀 Features

### For Buyers
- **Browse & Search** listings by keyword, category, and country (UAE / Uganda / Kenya / China)
- **Shopping Cart** — add, update, and remove items; persistent per user
- **Checkout** — place orders with shipping address selection and coupon codes
- **Multi-currency pricing** — AED, UGX, KES, CNY with per-country shipping rates
- **Order Management** — track orders through PENDING → CONFIRMED → SHIPPED → DELIVERED
- **Returns** — request returns on delivered orders; admin-reviewed resolution
- **Favorites / Saved Items** — bookmark listings for later
- **Product Reviews** — leave star ratings and written reviews on listings (one per listing)
- **Helpful Votes** — mark reviews as helpful
- **Messaging** — chat directly with sellers in listing-scoped conversation threads
- **Notifications** — real-time inbox for order updates, messages, listing approvals, and more
- **Address Book** — save multiple shipping/billing addresses with a default
- **Listing Reports** — submit moderation flags at `/reports/create`
- **Saved Searches** — bookmark search queries with optional email alerts
- **Profile Management** — avatar, bio, personal ID (`3RE-XXXXXXXX`), and order history

### For Sellers
- **Seller Store** — create a branded storefront (name, slug, logo, banner) at `/stores/:slug`
- **Subscription Packages** — choose a free or paid package that controls the listing quota
- **Listing Creation** — post items with multiple images, price, condition, tags, weight/dimensions, SKU
- **Image Upload Flow** — images are queued for admin review before going live (Railway bucket on approval)
- **Listing Placements** — get featured in **Featured Deal** or **Latest Collections** (admin-assigned)
- **Earnings & Balance** — seller balance tracked per order; view payout history
- **Withdrawals** — request earnings withdrawals; admin approves/rejects

### Shared Navigation
- **Global Category Bar** — category pill bar rendered across the whole app including the home page
- **Active State** — selected category highlighted for clear navigation feedback
- **Quick View Modal** — hover a listing card to preview price, description, and add to cart without navigating away

### For Admins
- **Admin Dashboard** — real-time KPI cards: users, listings, orders, revenue, approval rate
- **Content Moderation** — approve, reject, or feature listings (Featured Deal / Latest Collections with expiry duration)
- **Image Moderation** — review uploaded images individually or in bulk before they go live
- **User Management** — search, view, ban, or change user roles
- **Order Management** — view all orders, update statuses, manage returns
- **Reviews Moderation** — approve or reject product reviews before they are visible
- **Reports** — handle flagged listings; dismiss when resolved
- **Categories** — create and manage hierarchical product categories with icons
- **Coupons** — create PERCENTAGE, FIXED_AMOUNT, or FREE_SHIPPING discount codes with expiry and usage limits
- **Seller Packages** — define free/paid subscription tiers with listing quotas and durations
- **Subscriptions** — view and manage all active seller subscriptions
- **Shipping Rates** — configure per-country shipping pricing in all four currencies
- **Withdrawals** — approve or reject seller withdrawal requests
- **Analytics** — platform-wide usage metrics and charts
- **Site Settings** — maintenance mode, registration toggle, and platform defaults

### Email Notifications (via Resend or SMTP)
- **Welcome email** — sent on new user registration
- **Password reset email** — sent when a reset is requested
- **Image approved / rejected** — sent to the seller after moderation, with rejection reason if applicable
- **Order & return events** — sent to buyer and seller on key status changes

---

## 🖼 Image Upload & Moderation Flow

```
User uploads image
      │
      ▼
POST /api/upload
  → Saved to uploads/temp/<uuid>.ext
  → ProductImage record created (status: PENDING)
  → Returns { imageIds, urls }
      │
      ▼
User submits listing with imageIds
  → Listing created (status: PENDING)
  → Temp preview URLs stored in listing.images
      │
      ▼
Admin reviews image at /admin/images
      │
   ┌──┴──┐
Approve  Reject
   │        │
   │        └─ Temp file deleted
   │          Image marked REJECTED
   │          Temp URL removed from listing.images
   │          Seller notified by email
   │
   └─ Image uploaded to Railway bucket (S3-compatible)
     Temp file deleted
     Image marked APPROVED with cdnUrl
     listing.images updated: temp URL → bucket URL
     Seller notified by email
```

---

## 🔐 Admin Access

There are two ways to access the admin panel:

### Option 1 — Admin Login Portal (`/admin/auth/login`)
Go directly to `/admin/auth/login` and sign in with an administrator account. Only users with the `ADMIN` role can log in through this portal.

### Option 2 — Normal Login (`/auth/login`)
Log in through the standard login page. If your account has the `ADMIN` role, you will be automatically redirected to the admin dashboard (`/admin`), and your profile in the site header will display an **ADMIN** badge.

### Creating an Admin Account
Admin accounts are created at `/admin/auth/register` using a secret key (`ADMIN_SECRET`) set in the backend environment variables. Contact the system administrator for this key.

---

## 🗂 Project Structure

```
3R-Elite/
├── frontend/               # Next.js 14 frontend
│   ├── app/
│   │   ├── admin/          # Admin panel (dashboard, users, listings, images, orders, coupons, …)
│   │   ├── auth/           # User login, registration, password reset
│   │   ├── listings/       # Browse, detail, create listing pages
│   │   ├── cart/           # Shopping cart
│   │   ├── checkout/       # Checkout & order placement
│   │   ├── messages/       # In-app messaging & conversation threads
│   │   ├── notifications/  # Notification center
│   │   ├── stores/         # Seller storefront pages
│   │   ├── dashboard/      # Seller/buyer dashboard
│   │   ├── profile/        # User profile, listings, orders, favorites, subscription
│   │   └── reports/        # Listing report submission
│   ├── components/
│   │   ├── layout/         # Header, CategoryBar, Footer
│   │   ├── listings/       # Listing grid, filter sidebar, QuickViewModal
│   │   ├── admin/          # Admin-specific components
│   │   └── ui/             # Shared UI components (Breadcrumb, etc.)
│   └── context/            # Auth, Country, Cart context providers
│
├── backend/                # Express.js API
│   ├── src/
│   │   ├── routes/         # Auth, listings, orders, cart, stores, packages, coupons,
│   │   │                   # addresses, notifications, withdrawals, reviews, messages,
│   │   │                   # reports, categories, stats, upload, images, admin
│   │   ├── middleware/      # JWT auth, role guards, error handler (Prisma-aware)
│   │   └── utils/          # Prisma, JWT, CDN (S3/local), Email (Resend/SMTP), logger
│   └── prisma/             # Database schema & migrations
│
└── docker-compose.yml      # Full-stack Docker setup
```

---

## ⚙️ Setup & Installation

### Prerequisites
- Node.js 18+
- PostgreSQL database (or use Docker Compose)
- (Optional) S3-compatible storage (Railway bucket recommended) for image hosting
- (Optional) Resend account for transactional emails

### 1. Clone the repository
```bash
git clone https://github.com/AllanRye9/3R-Elite.git
cd 3R-Elite
```

### 2. Configure environment variables

**Backend** (`backend/.env`) — copy from `backend/.env.example` and fill in real values:
```env
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/3relite

# Railway internal URL (optional, faster on Railway)
DATABASE_PRIVATE_URL=

# ── Authentication / JWT ──────────────────────────────────────────────────────
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

ADMIN_SECRET=your_admin_registration_secret
ADMIN_PASSWORD=your_admin_password

# ── Server ────────────────────────────────────────────────────────────────────
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
REDIS_URL=redis://localhost:6379

# Public backend URL — used to build image proxy URLs (/api/images/<file>)
API_BASE_URL=http://localhost:5000

# ── S3-compatible storage (Railway bucket recommended) ────────────────────────
# Supports Railway buckets, AWS S3, MinIO, or any S3-compatible provider.
# The bucket can be kept private — images are served via /api/images proxy.
ACCESS_KEY_ID=your-access-key
SECRET_ACCESS_KEY=your-secret-key
BUCKET=your-bucket-name
# Custom S3-compatible endpoint (leave empty for standard AWS S3)
# Railway: https://<region>.railway-bucket.com  |  MinIO: http://localhost:9000
ENDPOINT=

# ── Email (Resend is preferred; SMTP is the fallback) ─────────────────────────
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=no-reply@yourdomain.com

# SMTP fallback (optional)
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=support@yourdomain.com

# Frontend URL (used in email links)
FRONTEND_URL=https://yourdomain.com

# ── Rate Limiting ─────────────────────────────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# ── Migrations ────────────────────────────────────────────────────────────────
AUTO_MIGRATE_ON_START=false
```

**Provider priority (backend):**
| Service | Priority |
|---|---|
| Image upload | S3 (Railway bucket) → local `/uploads` |
| Email delivery | Resend → SMTP → log-only (non-blocking) |

**Database startup safety:**
- In `production`, the backend runs `prisma migrate deploy` automatically before opening the API port.
- Set `AUTO_MIGRATE_ON_START=false` only if migrations are managed externally (CI/CD step or job).

**Frontend** (`frontend/.env.local`) — copy from `frontend/.env.example`:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

**Docker Compose** (`.env` at the project root) — copy from `.env.example`:
```env
# ── PostgreSQL ────────────────────────────────────────────────────────────────
POSTGRES_USER=marketplace
POSTGRES_PASSWORD=marketplace_secret
POSTGRES_DB=marketplace_db

# ── JWT ───────────────────────────────────────────────────────────────────────
JWT_SECRET=change-this-jwt-secret-in-production
JWT_REFRESH_SECRET=change-this-refresh-secret-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ORIGIN=http://localhost:3000

# ── Frontend / Backend URLs ───────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:5000
API_BASE_URL=http://localhost:5000

# ── S3-compatible storage (optional) ─────────────────────────────────────────
ACCESS_KEY_ID=
SECRET_ACCESS_KEY=
BUCKET=
ENDPOINT=

# ── Email provider (optional) ────────────────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM_EMAIL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# ── Rate limiting ────────────────────────────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

### Environment Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| **Database** ||||
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `DATABASE_PRIVATE_URL` | — | — | Railway internal URL (faster, avoids egress) |
| **Authentication** ||||
| `JWT_SECRET` | ✅ | — | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | ✅ | — | Secret for signing refresh tokens |
| `JWT_EXPIRES_IN` | — | — | Access token lifetime (e.g. `1h`, `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | — | — | Refresh token lifetime (e.g. `7d`) |
| `ADMIN_SECRET` | ✅ | — | Secret key for admin registration |
| `ADMIN_PASSWORD` | — | — | Default admin password (seed) |
| **Server** ||||
| `PORT` | — | `5000` | Backend server port |
| `NODE_ENV` | — | `development` | `development` or `production` |
| `CORS_ORIGIN` | — | — | Comma-separated allowed origins |
| `REDIS_URL` | — | — | Redis connection string (caching) |
| `API_BASE_URL` | — | — | Public backend URL for image proxy URLs |
| `FRONTEND_URL` | — | — | Frontend URL used in email links |
| **S3-compatible storage** ||||
| `ACCESS_KEY_ID` | — | — | S3 access key |
| `SECRET_ACCESS_KEY` | — | — | S3 secret key |
| `BUCKET` | — | — | S3 bucket name |
| `ENDPOINT` | — | — | Custom endpoint (Railway, MinIO) |
| **Email (Resend)** ||||
| `RESEND_API_KEY` | — | — | Resend API key |
| `RESEND_FROM_EMAIL` | — | — | Sender address for Resend |
| **Email (SMTP fallback)** ||||
| `SMTP_HOST` | — | — | SMTP server hostname |
| `SMTP_PORT` | — | `587` | SMTP port |
| `SMTP_USER` | — | — | SMTP username |
| `SMTP_PASS` | — | — | SMTP password |
| `SMTP_FROM` | — | — | Sender address for SMTP |
| **Rate Limiting** ||||
| `RATE_LIMIT_WINDOW_MS` | — | `900000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | — | `100` | Max requests per window |
| **Migrations** ||||
| `AUTO_MIGRATE_ON_START` | — | `false` | Auto-run `prisma migrate deploy` on boot (set `true` in production) |
| **Frontend** ||||
| `NEXT_PUBLIC_API_URL` | ✅ | `http://localhost:5000` | Backend API URL (embedded at build time) |
| **Docker Compose only** ||||
| `POSTGRES_USER` | — | `marketplace` | PostgreSQL user |
| `POSTGRES_PASSWORD` | — | `marketplace_secret` | PostgreSQL password |
| `POSTGRES_DB` | — | `marketplace_db` | PostgreSQL database name |

### 3. Start with Docker Compose (recommended)
```bash
docker-compose up --build
```
This starts PostgreSQL, the backend API, and the Next.js frontend together.

### 4. Manual setup

**Backend:**
```bash
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

For local development, keep `AUTO_MIGRATE_ON_START=false` to avoid running deploy migrations on every restart.

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## 🧪 Development

```bash
# Quick full checks (backend + frontend)
npm run check

# Type-check the backend
cd backend && npx tsc --noEmit

# Build the frontend
cd frontend && npx next build
```

---

## 🔗 API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login (returns JWT access + refresh tokens) |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/logout` | Logout (invalidates refresh token) |
| POST | `/api/auth/forgot-password` | Request password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |
| POST | `/api/auth/admin-register` | Register admin account (requires `ADMIN_SECRET`) |

### Health
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/ready` | Readiness check |

### Listings
| Method | Path | Description |
|---|---|---|
| GET | `/api/listings` | Search/list listings (keyword, category, country, price, condition, sort) |
| POST | `/api/listings` | Create a listing (seller + active subscription required) |
| GET | `/api/listings/:id` | Get listing details (increments view count) |
| PUT | `/api/listings/:id` | Update listing (owner or admin) |
| DELETE | `/api/listings/:id` | Delete listing (owner or admin) |
| GET | `/api/listings/featured-deal` | Get current Featured Deal placement |
| GET | `/api/listings/latest-collections` | Get Latest Collections placements |
| POST | `/api/listings/:id/favorite` | Toggle listing favorite |
| GET | `/api/listings/:id/favorites` | Check if listing is favorited |

### Cart
| Method | Path | Description |
|---|---|---|
| GET | `/api/cart` | Get current user's cart |
| POST | `/api/cart` | Add item to cart (or increment quantity) |
| PUT | `/api/cart/:id` | Update cart item quantity |
| DELETE | `/api/cart/:id` | Remove item from cart |
| DELETE | `/api/cart` | Clear entire cart |

### Orders
| Method | Path | Description |
|---|---|---|
| POST | `/api/orders` | Place an order (validates coupon, stock, seller) |
| GET | `/api/orders` | List user's orders (as buyer or seller) |
| GET | `/api/orders/:id` | Get order details |
| PUT | `/api/orders/:id/status` | Update order status (seller/admin) with tracking number |
| POST | `/api/orders/:id/return` | Request a return on a delivered order |

### Addresses
| Method | Path | Description |
|---|---|---|
| GET | `/api/addresses` | List saved addresses |
| POST | `/api/addresses` | Create address |
| PUT | `/api/addresses/:id` | Update address |
| DELETE | `/api/addresses/:id` | Delete address |

### Stores
| Method | Path | Description |
|---|---|---|
| POST | `/api/stores` | Create seller store (promotes user to SELLER role) |
| GET | `/api/stores/me` | Get current seller's store |
| PUT | `/api/stores/me` | Update store (name, description, logo, banner) |
| GET | `/api/stores/:slug` | Public store profile with latest listings |

### Seller Packages & Subscriptions
| Method | Path | Description |
|---|---|---|
| GET | `/api/packages` | List active packages |
| GET | `/api/packages/my-subscription` | Get current subscription |
| POST | `/api/packages/:id/subscribe` | Subscribe to a package |

### Coupons
| Method | Path | Description |
|---|---|---|
| GET | `/api/coupons/validate` | Validate coupon code (checks expiry, usage limits, min order) |

### Reviews
| Method | Path | Description |
|---|---|---|
| GET | `/api/reviews/listing/:listingId` | Get product reviews with aggregate stats |
| POST | `/api/reviews/listing/:listingId` | Submit product review (one per user per listing) |
| POST | `/api/reviews/:id/helpful` | Mark review as helpful |

### Messages
| Method | Path | Description |
|---|---|---|
| POST | `/api/messages` | Send message to a seller about a listing |
| GET | `/api/messages` | List conversations (grouped by listing + user) |
| GET | `/api/messages/:listingId/:userId` | Get full conversation thread |

### Notifications
| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications` | List notifications (paginated, filter unread) |
| GET | `/api/notifications/unread-count` | Get unread count |
| PUT | `/api/notifications/:id/read` | Mark notification as read |
| PUT | `/api/notifications/read-all` | Mark all notifications as read |
| DELETE | `/api/notifications/:id` | Delete notification |

### Withdrawals
| Method | Path | Description |
|---|---|---|
| GET | `/api/withdrawals` | List seller's withdrawal requests |
| POST | `/api/withdrawals` | Request a withdrawal |

### Categories & Stats
| Method | Path | Description |
|---|---|---|
| GET | `/api/categories` | List all categories with subcategories |
| GET | `/api/categories/:slug/subcategories` | Get subcategories for a parent |
| GET | `/api/stats` | Public platform stats |

### Upload
| Method | Path | Description |
|---|---|---|
| POST | `/api/upload` | Upload product images (returns imageIds + temp URLs) |
| POST | `/api/upload/avatar` | Upload profile avatar (returns CDN URL immediately) |
| POST | `/api/upload/doc` | Parse a TXT/CSV/MD document into listing fields |
| GET | `/api/images/:filename` | Serve image (S3 proxy with local fallback) |

### Reports
| Method | Path | Description |
|---|---|---|
| POST | `/api/reports` | Submit a listing moderation report |

### Admin (all routes require ADMIN role)
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/stats` | Dashboard KPIs |
| GET | `/api/admin/analytics` | Advanced analytics |
| GET/PUT/DELETE | `/api/admin/users/:id` | Manage users (ban, role) |
| GET/PUT/DELETE | `/api/admin/listings/:id` | Manage listings |
| PUT | `/api/admin/listings/:id/approve` | Approve listing with optional placement |
| PUT | `/api/admin/listings/:id/reject` | Reject listing |
| GET/PUT | `/api/admin/images` | Image moderation (individual & bulk) |
| GET/PUT | `/api/admin/reviews` | Review moderation |
| GET/PUT | `/api/admin/orders/:id/status` | Order management |
| GET/PUT | `/api/admin/returns/:id` | Return management |
| GET/POST/PUT/DELETE | `/api/admin/categories` | Category management |
| GET/POST/PUT/DELETE | `/api/admin/coupons` | Coupon management |
| GET/POST/PUT/DELETE | `/api/admin/packages` | Seller package management |
| GET/PUT | `/api/admin/subscriptions/:id` | Subscription management |
| GET/POST/PUT/DELETE | `/api/admin/shipping-rates` | Shipping rate configuration |
| GET/PUT | `/api/admin/withdrawals/:id` | Withdrawal approval |
| GET/DELETE | `/api/admin/reports/:id` | Report management |
| GET/PUT | `/api/admin/settings` | Site settings |

---

## 📄 License

MIT © 3R Elite

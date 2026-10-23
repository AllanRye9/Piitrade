# QA report — functionality and mobile glitches

Method: the delivered code was run as a whole (PostgreSQL + backend + production frontend build) and driven with a
headless Chromium (Chrome 153, emulated phone) — 320 / 390 / 768 px public pages, 28 admin pages and the seller / store-owner
pages at 390 px — plus the backend unit (123) and real-database integration (39) suites.

## Mobile header and layout glitches — fixed
| # | Glitch (as seen in the browser) | Root cause | Fix |
|---|---|---|---|
| 1 | **Header scrolled away** on every page (top = -901px after scrolling 900px) | `html, body { overflow-x: hidden }` turns `<body>` into a non-scrolling scroll container; `position: sticky` binds to it and silently does nothing | `overflow-x: clip` (same clipping, no scroll container), `hidden` kept as fallback |
| 2 | Hamburger icon **invisible** once the header turned white (white bars on white) | bars hard-coded `bg-white` | bars follow `currentColor`, button colour switches with `scrolled` |
| 3 | **Login button** a tall box with its text pinned to the top; same for 7+ footer links and "Forgot password?" | global mobile rule `min-height: 36/44px` on all links/buttons | labels centred (`inline-flex items-center` on those links + `align-content: center` safety net) |
| 4 | At **320px** the header overflowed (Login clipped by 3px) | 246px logo+tagline group | tagline hidden below 360px |
| 5 | Open menu: **bottom bar covered the Login / Create Account buttons** | drawer sits in the header's `z-50` stacking context; bottom bar is a later `z-50` sibling | bottom bar and chat bubble hidden while the menu is open |
| 6 | **Chat bubble sat on the bottom bar's Home tab** | fixed `bottom-4` ignores the 64px bar | `bottom-20` on phones, `bottom-4` from `md` up |
| 7 | Grey **band down the left edge** of every page | closed drawer kept `shadow-2xl` while off-screen | shadow only when open |
| 8 | Closed drawer's links were **keyboard-focusable** while invisible | translate-only hiding | `invisible` when closed (animation kept) |
| 9 | **Seven admin pages clipped** on phones (content column wider than the screen, cut off by the global overflow rule) | flex child without `min-w-0` | `min-w-0` on the admin content column |
| 10 | Two React `exhaustive-deps` warnings (messages, create-produce) | missing dependency | added; `next lint` now reports none |

## Functionality verified end to end (real database, real HTTP)
Login (admin / seller / owner) · admin activates a store → store created, role granted, GOLD tier on its listings, entitlement
`STORE` (cap 40) · store owner posts a listing → `GOLD` · admin approval → category count 0→1 **immediately** · admin alerts ·
subscription status/entitlement/renew · paginated inbox with unread counts · column preference round-trip · all 28 admin pages,
the seller/owner profile, subscription, verification, favourites, messages, notifications and store pages load with no JS errors
or failed API calls.

## Needs your decision / not fixed
* **Copy contradicts behaviour:** `/profile/subscription` says "A valid package is required to post listings", but ordinary accounts
  can post up to 10 (`ORDINARY_USER_MAX_LISTINGS`) without one.
* The browser calls `https://api.country.is/` on load (third-party geo-IP: privacy + reliability). It fails silently, but a
  server-side lookup would be safer.
* `/messages` shows a large empty area above the footer when the inbox is short (the "redesigned, scroll-free inbox" is a
  frontend task; the API for it is ready).
* The chat bubble can overlap the footer's social icons at the bottom of a page (cosmetic).

## Not verified
Real iOS Safari / Android devices and Firefox (only emulated Chromium); widths above 768 px; e-mail, S3, the AI worker and payments;
the registration e-mail flow; submitting the long create-listing form through the UI (the same endpoint was exercised via the API).

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { useState, useRef, useMemo } from 'react';
import { Suspense } from 'react';
import { useCountry } from '@/context/CountryContext';
import { useActiveSubcategoryCounts } from '@/hooks/useActiveSubcategoryCounts';

const MENU_CLOSE_DELAY_MS = 150;

interface MegaMenuColumn {
  heading: string;
  links: { label: string; href: string }[];
}

interface TopCategory {
  label: string;
  icon: string;
  href: string;
  megaMenu?: MegaMenuColumn[];
}

const topCategories: TopCategory[] = [
  {
    label: 'Motors',
    icon: '🚗',
    href: '/motors',
    megaMenu: [
      {
        heading: 'Cars',
        links: [
          { label: 'Used Cars', href: '/motors/used-cars' },
          { label: 'New Cars', href: '/motors/new-cars' },
          { label: 'Classic Cars', href: '/motors/classic-cars' },
        ],
      },
      {
        heading: 'Other Vehicles',
        links: [
          { label: 'Motorcycles', href: '/motors/motorcycles' },
          { label: 'Trucks & Buses', href: '/motors/trucks-buses' },
          { label: 'Boats', href: '/motors/boats' },
        ],
      },
      {
        heading: 'Parts & Accessories',
        links: [
          { label: 'Car Parts', href: '/motors/car-parts' },
          { label: 'Tyres & Wheels', href: '/motors/tyres-wheels' },
          { label: 'Car Accessories', href: '/motors/car-accessories' },
        ],
      },
    ],
  },
  {
    label: 'Property',
    icon: '🏠',
    href: '/property',
    megaMenu: [
      {
        heading: 'For Rent',
        links: [
          { label: 'Apartments for Rent', href: '/property/apartments-rent' },
          { label: 'Houses for Rent', href: '/property/houses-rent' },
          { label: 'Rooms for Rent', href: '/property/rooms-rent' },
        ],
      },
      {
        heading: 'For Sale',
        links: [
          { label: 'Apartments for Sale', href: '/property/apartments-sale' },
          { label: 'Houses for Sale', href: '/property/houses-sale' },
          { label: 'Land & Plots', href: '/property/land-plots' },
        ],
      },
      {
        heading: 'Commercial',
        links: [
          { label: 'Office Space', href: '/property/office-space' },
          { label: 'Shops & Retail', href: '/property/shops-retail' },
          { label: 'Warehouses', href: '/property/warehouses' },
        ],
      },
    ],
  },
  {
    label: 'Jobs',
    icon: '💼',
    href: '/jobs',
    megaMenu: [
      {
        heading: 'Job Types',
        links: [
          { label: 'Full Time', href: '/jobs?employmentType=full+time' },
          { label: 'Part Time', href: '/jobs?employmentType=part+time' },
          { label: 'Freelance', href: '/jobs?employmentType=freelance' },
        ],
      },
      {
        heading: 'Industries',
        links: [
          { label: 'Technology', href: '/jobs?industry=Technology' },
          { label: 'Healthcare', href: '/jobs?industry=Healthcare' },
          { label: 'Finance', href: '/jobs?industry=Finance' },
        ],
      },
    ],
  },
  {
    label: 'CV',
    icon: '📄',
    href: '/cv-services',
    megaMenu: [
      {
        heading: 'CV Services',
        links: [
          { label: 'CV Writing', href: '/cv-services/writing' },
          { label: 'Interview Preparation', href: '/cv-services/interview' },
          { label: 'Cover Letter', href: '/cv-generator/cover-letter' },
        ],
      },
      {
        heading: 'Hire Talent',
        links: [
          { label: 'Browse CVs', href: '/jobs' },
          { label: 'Post a CV', href: '/profile' },
          { label: 'Find Talent', href: '/jobs' },
        ],
      },
    ],
  },
  { label: 'Classifieds', icon: '📋', href: '/classifieds', megaMenu: [
    { heading: 'Household', links: [
      { label: 'Furniture', href: '/classifieds/furniture-classifieds' },
      { label: 'Appliances', href: '/classifieds/appliances' },
      { label: 'Tools & Garden', href: '/classifieds/tools-garden' },
    ]},
    { heading: 'Personal', links: [
      { label: 'Kids & Baby', href: '/classifieds/kids-baby' },
      { label: 'Sports & Outdoors', href: '/classifieds/sports-outdoors' },
      { label: 'Books & Hobbies', href: '/classifieds/books-hobbies' },
    ]},
  ]},
  { label: 'Electronics', icon: '💻', href: '/electronics', megaMenu: [
    { heading: 'Computing', links: [
      { label: 'Laptops', href: '/electronics/laptops' },
      { label: 'Desktops & Monitors', href: '/electronics/desktops' },
      { label: 'Tablets', href: '/electronics/tablets' },
    ]},
    { heading: 'Mobile & Audio', links: [
      { label: 'Smartphones', href: '/electronics/smartphones' },
      { label: 'Headphones', href: '/electronics/headphones' },
      { label: 'Cameras', href: '/electronics/cameras' },
    ]},
    { heading: 'Gaming', links: [
      { label: 'Consoles', href: '/electronics/consoles' },
      { label: 'Games & Accessories', href: '/electronics/games-accessories' },
    ]},
  ]},
  { label: 'Fashion', icon: '👗', href: '/fashion', megaMenu: [
    { heading: 'Women', links: [
      { label: "Women's Clothing", href: '/fashion/women-clothing' },
      { label: "Women's Shoes", href: '/fashion/women-shoes' },
      { label: 'Bags & Accessories', href: '/fashion/women-bags' },
    ]},
    { heading: 'Men', links: [
      { label: "Men's Clothing", href: '/fashion/men-clothing' },
      { label: "Men's Shoes", href: '/fashion/men-shoes' },
      { label: 'Watches', href: '/fashion/watches' },
    ]},
    { heading: 'Kids', links: [
      { label: "Girls' Clothing", href: '/fashion/girls-clothing' },
      { label: "Boys' Clothing", href: '/fashion/boys-clothing' },
    ]},
  ]},
  { label: 'Furniture & Garden', icon: '🛋️', href: '/furniture', megaMenu: [
    { heading: 'Indoor', links: [
      { label: 'Living Room', href: '/furniture/living-room' },
      { label: 'Bedroom', href: '/furniture/bedroom' },
      { label: 'Kitchen & Dining', href: '/furniture/kitchen-dining' },
    ]},
    { heading: 'Outdoor', links: [
      { label: 'Garden Furniture', href: '/furniture/garden-furniture' },
      { label: 'BBQ & Grills', href: '/furniture/bbq-grills' },
      { label: 'Plants & Seeds', href: '/furniture/plants-seeds' },
    ]},
  ]},
  { label: 'Services', icon: '🔧', href: '/services', megaMenu: [
    { heading: 'Home Services', links: [
      { label: 'Cleaning', href: '/services/cleaning' },
      { label: 'Plumbing & Electrical', href: '/services/plumbing-electrical' },
      { label: 'Movers & Storage', href: '/services/movers-storage' },
    ]},
    { heading: 'Professional', links: [
      { label: 'Tutoring', href: '/services/tutoring' },
      { label: 'Design & Creative', href: '/services/design-creative' },
      { label: 'IT & Tech Support', href: '/services/it-tech-support' },
    ]},
  ]},
];

// Only these top-level tabs are actually backed by the Listing/Category
// model (their pages and mega-menu sub-links map onto real category slugs
// and are populated by `/listings?category=...`), so only these are safe to
// gate on active-listing counts:
//  - Jobs' page (/jobs) is a separate candidate/CV browsing feature backed
//    by its own Job model, not by Listings filed under the "jobs" category,
//    so a listing count there says nothing about whether that page has
//    content — hiding it based on that count would be wrong.
//  - CV's pages (/cv-services/*, /cv-generator/*) are static tools (CV
//    builder, interview prep, cover-letter generator), not listing pages,
//    so they're never "empty" in the listings sense and should always show.
const LISTING_DRIVEN_CATEGORIES = new Set([
  'motors', 'property', 'classifieds', 'electronics', 'fashion', 'furniture', 'services',
]);

// Returns the subcategory slug for a mega-menu link IF it's a plain
// "<categoryBasePath>/<slug>" route with no query string — the only shape we
// can reliably match against the active-listing-counts map. Query-string
// routes (e.g. "/jobs?employmentType=...") and links that point outside the
// category's own path (e.g. CV's "Browse CVs" -> "/jobs") aren't real
// category-detail pages, so they're left alone (always shown) rather than
// risking hiding a legitimate, non-category link.
function getMegaMenuLinkSlug(href: string, categoryPathname: string): string | null {
  const url = new URL(href, 'http://x');
  if (url.search) return null;
  const prefix = `${categoryPathname}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const rest = url.pathname.slice(prefix.length);
  if (!rest || rest.includes('/')) return null;
  return rest;
}

// Hides subcategory links (and whole columns, if every link in a column is
// hidden) that have zero ACTIVE listings, and hides a top-level tab entirely
// if neither the category itself nor any of its subcategories has a single
// active listing yet. Falls back to showing everything if counts haven't
// loaded / failed to load, matching the behavior of the other public
// "hide empty sections" surfaces (CategoryPageTemplate, CategorySubcategoryTemplate).
function getVisibleTopCategories(
  categories: TopCategory[],
  counts: Record<string, number> | null,
): TopCategory[] {
  if (!counts) return categories;

  return categories
    .map((cat) => {
      const catUrl = new URL(cat.href, 'http://x');
      const catPathname = catUrl.pathname;
      const topSlug = catPathname.replace(/^\//, '');

      // Categories not backed by the Listing/Category model (Jobs, CV) are
      // always shown, fully unfiltered — a listing count is meaningless for
      // their destination pages. See LISTING_DRIVEN_CATEGORIES above.
      if (!LISTING_DRIVEN_CATEGORIES.has(topSlug)) return cat;

      let anySubHasListing = false;
      const filteredMegaMenu = cat.megaMenu
        ?.map((col) => {
          const links = col.links.filter((link) => {
            const slug = getMegaMenuLinkSlug(link.href, catPathname);
            if (!slug) return true; // can't map to a category — leave visible
            const visible = (counts[slug] ?? 0) > 0;
            if (visible) anySubHasListing = true;
            return visible;
          });
          return { ...col, links };
        })
        .filter((col) => col.links.length > 0);

      const directCount = counts[topSlug] ?? 0;
      const hasAnyListing = directCount > 0 || anySubHasListing;

      return hasAnyListing
        ? { ...cat, megaMenu: filteredMegaMenu && filteredMegaMenu.length > 0 ? filteredMegaMenu : undefined }
        : null;
    })
    .filter((cat): cat is TopCategory => cat !== null);
}

function CategoryBarInner() {
  const pathname = usePathname();
  const params = useSearchParams();
  const currentQ = params ? params.get('q') || '' : '';
  const { country } = useCountry();
  const { counts } = useActiveSubcategoryCounts(country);
  const visibleTopCategories = useMemo(
    () => getVisibleTopCategories(topCategories, counts),
    [counts],
  );
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const outerRef = useRef<HTMLDivElement>(null);
  const [menuLeftPx, setMenuLeftPx] = useState(0);

  const handleMouseEnter = (label: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpenMenu(label);
    // Compute horizontal offset of this item relative to outer container
    const itemEl = categoryRefs.current[label];
    const outerEl = outerRef.current;
    if (itemEl && outerEl) {
      const itemRect = itemEl.getBoundingClientRect();
      const outerRect = outerEl.getBoundingClientRect();
      setMenuLeftPx(itemRect.left - outerRect.left);
    }
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setOpenMenu(null), MENU_CLOSE_DELAY_MS);
  };

  const activeCategory = openMenu ? visibleTopCategories.find((c) => c.label === openMenu) : null;
  const currentPath = pathname || '';
  const isListingsView = currentPath === '/' || currentPath.startsWith('/listings');

  const getLinkClasses = (isActive: boolean) => {
    if (isActive) {
      return 'bg-red-600 text-white shadow-sm';
    }
    return 'text-gray-200 hover:text-white hover:bg-red-600';
  };

  return (
    /* Outer wrapper is the positioning context for mega menus so they escape the overflow container */
    <div className="relative" ref={outerRef}>
      {/* Scrollable category links row — centered with equal side padding */}
      <div className="flex justify-center items-center gap-0 overflow-x-auto no-scrollbar">
        <span className="flex items-center gap-1 px-2.5 py-1 text-[11px] xs:text-xs font-semibold whitespace-nowrap text-gray-200 select-none">
          Shop wise, Shop Elite
        </span>
        <Link
          href="/listings"
          className={`relative flex items-center gap-1 px-2.5 py-1 text-[11px] xs:text-xs font-semibold whitespace-nowrap transition-all interactive ${getLinkClasses(isListingsView && !currentQ)}`}
        >
          All
          {isListingsView && !currentQ && <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-white/90" aria-hidden="true" />}
        </Link>
        {visibleTopCategories.map((cat) => {
          // Determine if this category is active based on the current pathname/query.
          // Some categories have dedicated routes (e.g. /motors, /property), others
          // still use /listings?q=... query strings.
          const catUrl = new URL(cat.href, 'http://x');
          const catPathname = catUrl.pathname;
          const catQ = catUrl.searchParams.get('q') || '';
          const isActive = catPathname !== '/listings'
            ? currentPath.startsWith(catPathname)
            : isListingsView && catQ !== '' && catQ.toLowerCase() === currentQ.toLowerCase();
          const hasMega = Boolean(cat.megaMenu);

          return (
            <div
              key={cat.label}
              ref={(el) => { categoryRefs.current[cat.label] = el; }}
              onMouseEnter={() => hasMega && handleMouseEnter(cat.label)}
              onMouseLeave={handleMouseLeave}
            >
              <Link
                href={cat.href}
                className={`relative flex items-center gap-1 px-2.5 py-1 text-[11px] xs:text-xs font-semibold whitespace-nowrap transition-all interactive ${getLinkClasses(isActive)}`}
              >
                <span aria-hidden="true" className="text-[11px]">{cat.icon}</span>
                {cat.label}
                {isActive && <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-white/90" aria-hidden="true" />}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Mega Menu — rendered outside the overflow container so it is never clipped.
          Left offset is computed dynamically so it appears below the hovered item. */}
      {activeCategory?.megaMenu && (
        <div
          className="absolute top-full pt-1 z-[60]"
          style={{ left: `${menuLeftPx}px` }}
          onMouseEnter={() => handleMouseEnter(activeCategory.label)}
          onMouseLeave={handleMouseLeave}
        >
          <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-4 flex gap-6 min-w-[420px] animate-scale-in">
            {activeCategory.megaMenu.map((col) => (
              <div key={col.heading} className="flex-1 min-w-[120px]">
                <h4 className="text-[11px] font-extrabold text-gray-900 mb-2.5 uppercase tracking-wider">{col.heading}</h4>
                <ul className="space-y-1.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-xs text-gray-600 hover:text-red-600 hover:font-medium transition-colors block py-0.5"
                        onClick={() => setOpenMenu(null)}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CategoryBar() {
  return (
    <div className="w-full border-t border-white/10 theme-category-bar shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-0.5">
        <Suspense
          fallback={
            <div className="flex justify-center items-center gap-0 overflow-x-auto no-scrollbar py-0.5">
              <span className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-gray-200 select-none">
                Shop wise, Shop Elite
              </span>
              <Link
                href="/listings"
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-gray-200 hover:text-white hover:bg-red-600 transition-all interactive"
              >
                All
              </Link>
              {topCategories.map((cat) => (
                <Link
                  key={cat.label}
                  href={cat.href}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-gray-200 hover:text-white hover:bg-red-600 transition-all interactive"
                >
                  <span aria-hidden="true" className="text-[11px]">{cat.icon}</span>
                  {cat.label}
                </Link>
              ))}
            </div>
          }
        >
          <CategoryBarInner />
        </Suspense>
      </div>
    </div>
  );
}

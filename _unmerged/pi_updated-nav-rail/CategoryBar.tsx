'use client';

import { useTr } from '@/lib/i18n/useTr';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { Suspense } from 'react';
import { useCountry } from '@/context/CountryContext';
import { useNavCategoryCounts } from '@/hooks/useActiveSubcategoryCounts';
import { CountBadge } from '@/components/ui/CountBadge';
import { useCategoryTree } from '@/hooks/useCategoryTree';
import { useCategoryLayout } from '@/hooks/useCategoryLayout';
import { compareByRankThenCount, isAdminHidden, isConfirmedLive, sortByAdminRank } from '@/lib/categoryVisibility';
import { computeFit, splitTabs } from '@/lib/priorityFit';
import { buildMegaColumns } from '@/lib/megaMenu';
import { categoryHref } from '@/lib/categoryLinks';
import { AllCategoriesPanel, CategoryMegaPanel, MoreCategoriesPanel, type AllSection, type NavCategory } from '@/components/layout/NavMenus';

const MENU_CLOSE_DELAY_MS = 150;

export interface MegaMenuColumn {
  heading: string;
  /** `countSlug`: category slug used for the count badge when the href is not a plain category route. */
  links: { label: string; href: string; countSlug?: string }[];
}

export interface TopCategory {
  label: string;
  icon: string;
  href: string;
  /** Category slug when it can't be derived from `href` (live categories without a hand-made page). */
  slug?: string;
  megaMenu?: MegaMenuColumn[];
}

export const topCategories: TopCategory[] = [
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
  { label: 'Furniture', icon: '🛋️', href: '/furniture', megaMenu: [
    { heading: 'Rooms', links: [
      { label: 'Living Room', href: '/furniture/living-room' },
      { label: 'Bedroom', href: '/furniture/bedroom' },
      { label: 'Kitchen & Dining', href: '/furniture/kitchen-dining' },
    ]},
  ]},
  { label: 'Garden', icon: '🌿', href: '/garden', megaMenu: [
    { heading: 'Outdoor', links: [
      { label: 'Garden Furniture', href: '/garden/garden-furniture' },
      { label: 'BBQ & Grills', href: '/garden/bbq-grills' },
      { label: 'Plants & Seeds', href: '/garden/plants-seeds' },
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
  { label: 'Agriculture', icon: '🌾', href: '/agriculture', megaMenu: [
    { heading: 'Produce', links: [
      { label: 'Crops & Grains', href: '/agriculture/crops-grains' },
      { label: 'Fruits & Vegetables', href: '/agriculture/fruits-vegetables' },
      { label: 'Seeds & Inputs', href: '/agriculture/seeds-inputs' },
    ]},
    { heading: 'Animal Produce', links: [
      { label: 'Livestock', href: '/agriculture/livestock' },
      { label: 'Poultry & Eggs', href: '/agriculture/poultry-eggs' },
      { label: 'Dairy Products', href: '/agriculture/dairy-products' },
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
  'agriculture',
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

// Slug used for a tab's counter. Jobs counts open job posts (`counts.jobs`); CV is a static
// toolset, so it has no counter.
function topSlugOf(cat: TopCategory): string {
  if (cat.slug) return cat.slug;
  return new URL(cat.href, 'http://x').pathname.replace(/^\//, '');
}
function tabCount(cat: TopCategory, counts: Record<string, number> | null): number | undefined {
  if (!counts) return undefined;
  const slug = topSlugOf(cat);
  if (slug === 'cv-services') return undefined;
  return counts[slug === 'jobs' ? 'jobs' : slug];
}

// useLayoutEffect on the client (measure before paint, no flash); plain useEffect during SSR.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// At and above this width the strip fits its tabs to the available width ("priority+") and moves the
// rest into a "More" menu, so it never scrolls sideways. Below it, the strip stays a swipeable row.
const WIDE_QUERY = '(min-width: 1024px)';
const MORE_KEY = '__more__';
const ALL_KEY = '__all__';

function CategoryBarInner() {
  const tr = useTr();
  const pathname = usePathname();
  const params = useSearchParams();
  const currentQ = params ? params.get('q') || '' : '';
  const currentCategoryParam = params ? params.get('category') || '' : '';
  const { country } = useCountry();
  const { data: countData } = useNavCategoryCounts(country);
  const { tree } = useCategoryTree();
  const { rank: layoutRank, hidden: layoutHidden } = useCategoryLayout();
  const counts = countData?.counts ?? null;
  const fresh = countData?.new24h ?? {};
  const visibleTopCategories = useMemo(
    () => getVisibleTopCategories(topCategories, counts),
    [counts],
  );

  // Live top-level categories with no hand-made tab (Health & Beauty, Food, Building, Energy, …).
  // Strictly gated: shown only once counts are known AND the category has live listings, so a
  // brand-new empty category can never appear here.
  const extraTabs = useMemo<TopCategory[]>(() => {
    if (!tree || !counts) return [];
    const handMade = new Set(topCategories.map(topSlugOf));
    return tree
      .filter((p) => !handMade.has(p.slug) && !isAdminHidden(p.slug, layoutHidden) && isConfirmedLive(p.slug, counts))
      .sort((a, b) => compareByRankThenCount(a, b, counts))
      .map((p) => ({
        label: p.shortName || p.name,
        slug: p.slug,
        icon: p.icon || '📦',
        href: categoryHref(p.slug),
      }));
  }, [tree, counts, layoutHidden]);

  // Admin order (Admin → Category layout) wins when set; hidden categories are dropped.
  const allTabs = useMemo(
    () => sortByAdminRank(
      [...visibleTopCategories, ...extraTabs].filter((c) => !isAdminHidden(topSlugOf(c), layoutHidden)),
      topSlugOf,
      layoutRank,
    ),
    [visibleTopCategories, extraTabs, layoutRank, layoutHidden],
  );

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const outerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [menuLeftPx, setMenuLeftPx] = useState(0);
  const [menuCenterPx, setMenuCenterPx] = useState(0);
  const [caretPx, setCaretPx] = useState(28);
  const [panelLeftPx, setPanelLeftPx] = useState(0);
  const [isWide, setIsWide] = useState(false);
  const [fit, setFit] = useState<number>(Number.POSITIVE_INFINITY);

  const currentPath = pathname || '';
  const isListingsView = currentPath === '/' || currentPath.startsWith('/listings');

  const isTabActive = (cat: TopCategory): boolean => {
    const catUrl = new URL(cat.href, 'http://x');
    const catPathname = catUrl.pathname;
    const catCategory = catUrl.searchParams.get('category') || '';
    if (catCategory) return isListingsView && currentCategoryParam === catCategory;
    const catQ = catUrl.searchParams.get('q') || '';
    // Some categories have dedicated routes (e.g. /motors, /property), others
    // still use /listings?q=... query strings.
    // Match whole path segments: "/category/pets" must not light up on "/category/pets-animals".
    return catPathname !== '/listings'
      ? currentPath === catPathname || currentPath.startsWith(`${catPathname}/`)
      : isListingsView && catQ !== '' && catQ.toLowerCase() === currentQ.toLowerCase();
  };

  // ── Priority+ fitting ───────────────────────────────────────────────────────────────────────
  // A hidden copy of the strip (the "measurer") renders every tab at its natural width; from those
  // widths we work out how many tabs fit the row. Recomputed on resize, font load and whenever the
  // tab list or counts (badge widths) change.
  const recompute = useCallback(() => {
    const wide = typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches;
    setIsWide(wide);
    const measurer = measureRef.current;
    const row = rowRef.current;
    if (!wide || !measurer || !row) { setFit(Number.POSITIVE_INFINITY); return; }
    const widths = Array.from(measurer.children).map((el) => (el as HTMLElement).offsetWidth + 1); // +1: divider
    if (widths.length < 2) { setFit(Number.POSITIVE_INFINITY); return; }
    const [allWidth, ...rest] = widths;
    const moreWidth = rest.pop() ?? 0;
    setFit(computeFit(rest, row.clientWidth, moreWidth, allWidth));
  }, []);

  useIsoLayoutEffect(() => { recompute(); }, [recompute, allTabs, countData]);

  useEffect(() => {
    const row = rowRef.current;
    const measurer = measureRef.current;
    if (!row || !measurer || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(row);
    ro.observe(measurer);
    const mq = window.matchMedia(WIDE_QUERY);
    mq.addEventListener('change', recompute);
    return () => { ro.disconnect(); mq.removeEventListener('change', recompute); };
  }, [recompute]);

  const activeIdx = allTabs.findIndex(isTabActive);
  const { visible: visibleIdx, overflow: overflowIdx } = isWide
    ? splitTabs(allTabs.length, fit, activeIdx)
    : { visible: allTabs.map((_, i) => i), overflow: [] as number[] };
  const visibleTabs = visibleIdx.map((i) => allTabs[i]);
  const overflowTabs = overflowIdx.map((i) => allTabs[i]);

  // ── Menus ────────────────────────────────────────────────────────────────────────────────────
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
      setMenuCenterPx(itemRect.left - outerRect.left + itemRect.width / 2);
    }
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setOpenMenu(null), MENU_CLOSE_DELAY_MS);
  };

  const closeMenus = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpenMenu(null);
  };

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openMenu]);

  const moreOpen = openMenu === MORE_KEY && overflowTabs.length > 0;
  const allOpen = openMenu === ALL_KEY && isWide;
  const activeCategory = openMenu && openMenu !== MORE_KEY && openMenu !== ALL_KEY ? allTabs.find((c) => c.label === openMenu) : null;
  const activeCatPathname = activeCategory ? new URL(activeCategory.href, 'http://x').pathname : '';

  // Curated columns (capped) + one extra column of live subcategories the curated list doesn't link.
  const megaColumns = useMemo(() => {
    if (!activeCategory?.megaMenu) return null;
    const slug = topSlugOf(activeCategory);
    const children = tree?.find((p) => p.slug === slug)?.children ?? null;
    return buildMegaColumns(activeCategory.megaMenu, children, counts, {
      parentSlug: slug,
      linkSlugOf: (href) => getMegaMenuLinkSlug(href, activeCatPathname),
      extraHeading: `More in ${activeCategory.label}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, tree, counts]);

  // "All" panel: every category the buyer can see, each with ALL its live subcategories (most populated first).
  const allPanelSections = useMemo<AllSection[]>(() => {
    if (!allOpen) return [];
    return allTabs.map((cat) => {
      const slug = topSlugOf(cat);
      const live = (tree?.find((p) => p.slug === slug)?.children ?? [])
        .filter((ch) => (counts?.[ch.slug] ?? 0) > 0)
        .sort((a, b) => (counts?.[b.slug] ?? 0) - (counts?.[a.slug] ?? 0) || a.name.localeCompare(b.name))
        .map((ch) => ({ label: ch.shortName || ch.name, href: categoryHref(ch.slug), count: counts?.[ch.slug] ?? 0 }));
      // Hand-made storefronts without live data yet fall back to their curated links.
      const curated = live.length ? [] : (cat.megaMenu ?? []).flatMap((col) => col.links).map((l) => ({ label: l.label, href: l.href, count: 0 }));
      return {
        cat: { label: cat.label, icon: cat.icon, href: cat.href, slug, count: tabCount(cat, counts), fresh: fresh[slug] ?? 0 },
        subs: live.length ? live : curated,
      };
    });
  }, [allOpen, allTabs, tree, counts, fresh]);

  const toNav = (cat: TopCategory): NavCategory => {
    const slug = topSlugOf(cat);
    return { label: cat.label, icon: cat.icon, href: cat.href, slug, count: tabCount(cat, counts), fresh: fresh[slug] ?? 0 };
  };
  const activeTabSlug = activeIdx >= 0 ? topSlugOf(allTabs[activeIdx]) : undefined;

  // Keep the open panel inside the bar: anchor it under the hovered tab, but never past the right edge.
  useIsoLayoutEffect(() => {
    const panel = panelRef.current;
    const outer = outerRef.current;
    if (!openMenu || !panel || !outer) return;
    const max = Math.max(0, outer.clientWidth - panel.offsetWidth);
    const left = Math.max(0, Math.min(menuLeftPx, max));
    setPanelLeftPx(left);
    setCaretPx(Math.max(26, Math.min(menuCenterPx - left, panel.offsetWidth - 26)));
  }, [openMenu, menuLeftPx, menuCenterPx, megaColumns, overflowTabs.length, allOpen]);

  const getLinkClasses = (isActive: boolean) => {
    if (isActive) {
      return 'bg-red-600 text-white shadow-sm';
    }
    return 'text-gray-200 hover:text-white hover:bg-red-600';
  };

  const renderTab = (cat: TopCategory, forMeasure = false) => {
    const isActive = !forMeasure && isTabActive(cat);
    return (
      <Link
        href={cat.href}
        aria-current={isActive ? 'page' : undefined}
        tabIndex={forMeasure ? -1 : undefined}
        className={`relative flex items-center gap-1 px-3 py-2 text-[12.5px] xs:text-[13px] font-semibold whitespace-nowrap transition-all interactive ${getLinkClasses(isActive)}`}
      >
        <span aria-hidden="true" className="text-[15px] leading-none">{cat.icon}</span>
        {tr(cat.label)}
        <CountBadge count={tabCount(cat, counts)} fresh={fresh[topSlugOf(cat)] ?? 0} className="ml-0.5" />
        {isActive && <span className="absolute inset-x-1.5 -bottom-0 h-[3px] rounded-full bg-white/90" aria-hidden="true" />}
      </Link>
    );
  };

  const allActive = isListingsView && !currentQ && !currentCategoryParam;
  const hasMore = overflowTabs.length > 0;
  const moreButtonClasses = `relative flex h-full items-center gap-1 px-3 py-2 text-[12.5px] xs:text-[13px] font-semibold whitespace-nowrap transition-all interactive ${getLinkClasses(moreOpen)}`;

  return (
    /* Outer wrapper is the positioning context for menus so they escape the overflow container */
    <div className="relative" ref={outerRef}>
      {/* Hidden measuring copy of the strip: every tab at natural width, plus "All" first and "More" last.
          `invisible` keeps it out of the accessibility tree and tab order. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 -z-10 flex h-0 w-max overflow-hidden"
      >
        <span className="flex shrink-0 items-center px-3 py-2 text-[12.5px] xs:text-[13px] font-semibold whitespace-nowrap">
          {tr('All')}
          <CountBadge count={countData?.total} className="ml-1" />
        </span>
        {allTabs.map((cat) => (
          <div key={cat.label} className="shrink-0">{renderTab(cat, true)}</div>
        ))}
        <span className="flex shrink-0 items-center gap-1 px-3 py-2 text-[12.5px] xs:text-[13px] font-semibold whitespace-nowrap">
          {tr('More')}
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M19 9l-7 7-7-7" /></svg>
        </span>
      </div>

      {/* Category links row. From `lg` up it fits its tabs and uses "More"; below that it swipes.
          Auto margins on the first/last item centre the row without clipping its left edge when it
          overflows (justify-center would make the clipped part unreachable). */}
      <div
        ref={rowRef}
        className={`flex items-stretch divide-x divide-white/10 ${isWide ? 'overflow-hidden' : 'overflow-x-auto no-scrollbar'}`}
      >
        <div
          ref={(el) => { categoryRefs.current[ALL_KEY] = el; }}
          onMouseEnter={() => isWide && handleMouseEnter(ALL_KEY)}
          onFocus={() => isWide && handleMouseEnter(ALL_KEY)}
          onMouseLeave={handleMouseLeave}
          className="shrink-0 md:ml-auto"
        >
          <Link
            href="/listings"
            aria-haspopup={isWide ? 'true' : undefined}
            aria-expanded={isWide ? allOpen : undefined}
            className={`relative flex h-full items-center gap-1 px-3 py-2 text-[12.5px] xs:text-[13px] font-semibold whitespace-nowrap transition-all interactive ${getLinkClasses(allActive || allOpen)}`}
          >
            {tr('All')}
            <CountBadge count={countData?.total} className="ml-1" />
            {isWide && <svg className={`h-3 w-3 transition-transform ${allOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>}
            {allActive && <span className="absolute inset-x-1.5 -bottom-0 h-[3px] rounded-full bg-white/90" aria-hidden="true" />}
          </Link>
        </div>
        {visibleTabs.map((cat, i) => {
          const hasMega = Boolean(cat.megaMenu);
          const isLast = !hasMore && i === visibleTabs.length - 1;
          return (
            <div
              key={cat.label}
              ref={(el) => { categoryRefs.current[cat.label] = el; }}
              onMouseEnter={() => hasMega && handleMouseEnter(cat.label)}
              onFocus={() => hasMega && handleMouseEnter(cat.label)}
              onMouseLeave={handleMouseLeave}
              className={`shrink-0 ${isLast ? 'md:mr-auto' : ''}`}
            >
              {renderTab(cat)}
            </div>
          );
        })}
        {hasMore && (
          <div
            ref={(el) => { categoryRefs.current[MORE_KEY] = el; }}
            onMouseEnter={() => handleMouseEnter(MORE_KEY)}
            onMouseLeave={handleMouseLeave}
            className="shrink-0 md:mr-auto"
          >
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={moreOpen}
              onClick={() => (moreOpen ? closeMenus() : handleMouseEnter(MORE_KEY))}
              className={moreButtonClasses}
            >
              {tr('More')}
              <svg className={`h-3 w-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* Menus — rendered outside the overflow container so they are never clipped. They are anchored
          under the hovered tab, clamped to the bar's right edge and capped in height (scrolls inside). */}
      {(megaColumns || moreOpen || allOpen) && (
        <div
          ref={panelRef}
          className="absolute top-full z-[60] pt-2"
          style={{ left: `${panelLeftPx}px` }}
          onMouseEnter={() => openMenu && handleMouseEnter(openMenu)}
          onMouseLeave={handleMouseLeave}
        >
          {allOpen ? (
            <AllCategoriesPanel
              sections={allPanelSections}
              activeSlug={activeTabSlug}
              caretPx={caretPx}
              total={countData?.total}
              tr={tr}
              onNavigate={closeMenus}
            />
          ) : moreOpen ? (
            <MoreCategoriesPanel
              items={overflowTabs.map(toNav)}
              caretPx={caretPx}
              total={countData?.total}
              tr={tr}
              onNavigate={closeMenus}
            />
          ) : (
            activeCategory && megaColumns && (
              <CategoryMegaPanel
                cat={toNav(activeCategory)}
                columns={megaColumns}
                caretPx={caretPx}
                tr={tr}
                onNavigate={closeMenus}
                countFor={(link) => {
                  const slug = link.countSlug ?? getMegaMenuLinkSlug(link.href, activeCatPathname) ?? '';
                  return { count: counts?.[slug], fresh: fresh[slug] ?? 0 };
                }}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function CategoryBar() {
  const tr = useTr();
  return (
    <div className="w-full border-t border-white/10 theme-category-bar shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <Suspense
          fallback={
            <div className="flex justify-start md:justify-center items-stretch overflow-x-auto no-scrollbar divide-x divide-white/10">
              <Link
                href="/listings"
                className="flex items-center px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap text-gray-200 hover:text-white hover:bg-red-600 transition-all interactive"
              >
                {tr('All')}
              </Link>
              {topCategories.map((cat) => (
                <Link
                  key={cat.label}
                  href={cat.href}
                  className="flex items-center gap-1 px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap text-gray-200 hover:text-white hover:bg-red-600 transition-all interactive"
                >
                  <span aria-hidden="true" className="text-[15px] leading-none">{cat.icon}</span>
                  {tr(cat.label)}
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

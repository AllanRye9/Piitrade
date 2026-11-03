/**
 * One fixed icon per category, used by every header dropdown (tabs, "All", "More" and the mega menus).
 *
 * - Top-level icons are constants keyed by slug, so a category's title icon never changes between the tab, the
 *   dropdown header and the rail — whatever the API or an admin edit returns. The API icon is only used for a
 *   brand-new category that has no entry here yet.
 * - Subcategory links get a descriptive icon picked from keywords in their name, falling back to the parent's
 *   fixed icon, so every dropdown row has an icon next to its text.
 */

export const TOP_CATEGORY_ICONS: Record<string, string> = {
  motors: '🚗',
  property: '🏠',
  jobs: '💼',
  'cv-services': '📄',
  cv: '📄',
  classifieds: '📋',
  electronics: '💻',
  fashion: '👗',
  furniture: '🛋️',
  garden: '🌿',
  services: '🔧',
  agriculture: '🌾',
  'health-beauty': '💄',
  food: '🍽️',
  building: '🏗️',
  energy: '⚡',
  pets: '🐾',
  'pets-animals': '🐾',
  education: '🎓',
  events: '🎉',
  business: '🏢',
  industrial: '🏭',
  sports: '⚽',
  'arts-collectibles': '🎨',
  'baby-kids': '🧸',
  travel: '✈️',
};

/** The fixed icon of a top-level category (API icon only for categories not listed above). */
export function topCategoryIcon(slug: string, fallback?: string | null): string {
  return TOP_CATEGORY_ICONS[slug] ?? (fallback || '📦');
}

// First match wins, so the more specific words come first.
const SUB_RULES: [RegExp, string][] = [
  [/motorcycle|motorbike|boda|scooter/, '🏍️'],
  [/truck|lorry|bus\b|buses|van\b/, '🚚'],
  [/boat|ship|marine/, '⛵'],
  [/tyre|tire|wheel/, '🛞'],
  [/part|spare|accessor/, '🔩'],
  [/car|vehicle|suv|sedan|auto/, '🚗'],
  [/apartment|flat|condo/, '🏢'],
  [/land|plot/, '🏞️'],
  [/office|commercial|shop|retail|store/, '🏬'],
  [/warehouse|industrial|factory/, '🏭'],
  [/room|hostel|rental|rent/, '🔑'],
  [/house|home|villa|bungalow/, '🏡'],
  [/full.?time|part.?time|intern|contract|permanent/, '🕒'],
  [/freelance|remote/, '🧑‍💻'],
  [/tech|software|\bit\b|computer/, '🖥️'],
  [/health|medical|nurs|pharma|hospital/, '🩺'],
  [/financ|bank|account|insurance/, '💰'],
  [/cover letter|writing|\bcv\b|resume/, '✍️'],
  [/interview|talent|hire|recruit/, '🤝'],
  [/laptop|notebook/, '💻'],
  [/desktop|monitor|pc\b/, '🖥️'],
  [/tablet|ipad/, '📱'],
  [/phone|mobile|smartphone/, '📱'],
  [/headphone|audio|speaker|earphone|sound/, '🎧'],
  [/camera|photo|video/, '📷'],
  [/console|game|gaming|playstation|xbox/, '🎮'],
  [/tv|television|projector/, '📺'],
  [/women|ladies|girl|dress|skirt/, '👗'],
  [/men\b|men's|boys?\b|suit|shirt/, '👔'],
  [/shoe|sneaker|boot|sandal/, '👟'],
  [/bag|handbag|backpack|luggage/, '👜'],
  [/watch|jewel|ring|necklace/, '⌚'],
  [/kid|baby|toddler|child|toy/, '🧸'],
  [/living|sofa|couch/, '🛋️'],
  [/bed|mattress|bedroom/, '🛏️'],
  [/kitchen|dining|cook|stove|oven/, '🍳'],
  [/appliance|fridge|refrigerator|washing|microwave/, '🔌'],
  [/bbq|grill/, '🍖'],
  [/plant|seed|flower|nursery/, '🌱'],
  [/tool|hardware|drill/, '🛠️'],
  [/clean|laundry|housekeep/, '🧹'],
  [/plumb|electric|wiring|solar/, '🔌'],
  [/mover|moving|storage|transport|delivery|courier/, '📦'],
  [/tutor|lesson|school|teach|training|course/, '📚'],
  [/design|creative|graphic|art\b/, '🎨'],
  [/support|repair|maintenance|fix/, '🧰'],
  [/event|wedding|catering|party/, '🎉'],
  [/beauty|salon|hair|makeup|cosmetic/, '💅'],
  [/book|hobby|hobbies|music|instrument/, '📚'],
  [/sport|outdoor|fitness|gym|bicycle|bike/, '⚽'],
  [/crop|grain|maize|cereal|rice|bean/, '🌾'],
  [/fruit|vegetable|produce|banana|matooke/, '🥭'],
  [/livestock|cattle|cow|goat|sheep|pig/, '🐄'],
  [/poultry|chicken|egg/, '🐔'],
  [/dairy|milk|cheese|butter/, '🥛'],
  [/fish|aquaculture/, '🐟'],
  [/pet|dog|cat\b|puppy|kitten/, '🐾'],
  [/furniture/, '🛋️'],
];

/** Descriptive icon for a subcategory link; the parent's fixed icon when no keyword fits. */
export function subCategoryIcon(label: string, slug: string | undefined, parentIcon: string): string {
  const text = `${label} ${(slug || '').replace(/-/g, ' ')}`.toLowerCase();
  for (const [re, icon] of SUB_RULES) if (re.test(text)) return icon;
  return parentIcon || '•';
}

/** Last path segment of a plain category href ("/motors/used-cars" → "used-cars"). */
export function slugFromHref(href: string): string {
  try {
    const u = new URL(href, 'http://x');
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

// Uganda-demand taxonomy expansion (informal-sector focus).
// SINGLE SOURCE OF TRUTH for the categories added in migrations
//   20261023100000_uganda_subcategories_existing_parents
//   20261023110000_uganda_standalone_categories
// Both prisma/seed.ts and routes/categories.ts (auto-seed) import this file,
// so the lists can no longer drift apart. See UGANDA_CATEGORY_EXPANSION.md.
//
// RULE: Category.slug is globally unique (not per-parent). Never reuse a slug
// that exists anywhere in the tree — `ON CONFLICT DO NOTHING` / `upsert` would
// silently skip the row instead of failing.

export interface CategorySeed {
  name: string;
  slug: string;
  icon: string;
}

export interface StandaloneCategorySeed extends CategorySeed {
  children: CategorySeed[];
}

/** New subcategories for parents that already exist. Keyed by parent slug. */
export const UGANDA_SUBCATEGORY_ADDITIONS: Record<string, CategorySeed[]> = {
  "motors": [
    { name: "Boda Boda & Delivery Bikes", slug: "boda-boda-bikes", icon: "🏍️" },
    { name: "Tuk-Tuks & Three-Wheelers", slug: "tuk-tuk-three-wheelers", icon: "🛺" },
    { name: "Vans & Minibuses (Taxis)", slug: "vans-minibuses", icon: "🚐" },
  ],
  "property": [
    { name: "Farms & Estates", slug: "farms-estates", icon: "🌾" },
    { name: "Market Stalls, Kiosks & Arcade Shops", slug: "market-stalls-kiosks", icon: "🏪" },
  ],
  "jobs": [
    { name: "Casual & Daily Labour", slug: "casual-labour", icon: "🧱" },
    { name: "Security & Guards", slug: "security-jobs", icon: "🛡️" },
    { name: "Farm & Agribusiness Jobs", slug: "agriculture-jobs", icon: "🌱" },
    { name: "Engineering & Technical", slug: "engineering-jobs", icon: "⚙️" },
    { name: "Remote & Online Work", slug: "remote-jobs", icon: "🌐" },
  ],
  "classifieds": [
    { name: "Used Household Items", slug: "second-hand-household", icon: "♻️" },
    { name: "Businesses for Sale (Shops, Salons, Kiosks)", slug: "business-for-sale", icon: "💼" },
    { name: "Toys & Games", slug: "toys-games", icon: "🧸" },
    { name: "Strollers, Cots & Baby Gear", slug: "baby-gear", icon: "🍼" },
  ],
  "electronics": [
    { name: "Power Banks & UPS", slug: "power-banks-ups", icon: "🔋" },
  ],
  "fashion": [
    { name: "Second-Hand Clothes (Mivumba)", slug: "mitumba", icon: "♻️" },
    { name: "Second-Hand Shoes", slug: "mitumba-shoes", icon: "👟" },
    { name: "Baby & Toddler Clothing", slug: "baby-clothing", icon: "👶" },
    { name: "Sportswear & Jerseys", slug: "sportswear-jerseys", icon: "🎽" },
    { name: "Underwear & Sleepwear", slug: "underwear-sleepwear", icon: "🩲" },
    { name: "Fabrics & Textiles", slug: "fabrics-textiles", icon: "🧶" },
    { name: "Workwear, Overalls & Safety Boots", slug: "workwear-safety", icon: "🥾" },
    { name: "Sunglasses & Eyewear", slug: "eyewear", icon: "🕶️" },
    { name: "Bags, Backpacks & Luggage", slug: "bags-luggage", icon: "🎒" },
  ],
  "furniture": [
    { name: "Wardrobes, Shelves & Storage", slug: "storage-wardrobes", icon: "🗄️" },
    { name: "Made-to-Order & Local Carpentry", slug: "carpentry-made-to-order", icon: "🪚" },
    { name: "Second-Hand Furniture", slug: "second-hand-furniture", icon: "♻️" },
  ],
  "garden": [
    { name: "Flowers, Hedges & Landscaping", slug: "flowers-landscaping", icon: "🌸" },
    { name: "Pots, Planters & Nurseries", slug: "pots-nurseries", icon: "🪴" },
  ],
  "services": [
    { name: "Tailoring & Fashion Design", slug: "tailoring-fashion-design", icon: "🧵" },
    { name: "Car Wash & Detailing", slug: "car-wash-detailing", icon: "🚿" },
    { name: "Phone & Computer Repair", slug: "phone-computer-repair", icon: "📱" },
    { name: "Appliance & Electronics Repair", slug: "appliance-repair", icon: "🔧" },
    { name: "Welding & Metal Fabrication", slug: "welding-metalwork", icon: "🔥" },
    { name: "Carpentry & Joinery", slug: "carpentry-joinery", icon: "🪚" },
    { name: "Roofing, Ceilings & Gypsum", slug: "roofing-ceilings", icon: "🏠" },
    { name: "Painting & Decorating", slug: "painting-decorating", icon: "🎨" },
    { name: "Laundry & Dry Cleaning", slug: "laundry-dry-cleaning", icon: "🧺" },
    { name: "Pest Control & Fumigation", slug: "pest-control", icon: "🪳" },
    { name: "Shoe Repair & Cobblers", slug: "shoe-repair", icon: "👞" },
    { name: "DStv, Satellite & CCTV Installation", slug: "satellite-cctv-installation", icon: "📡" },
    { name: "Borehole Drilling & Water Services", slug: "borehole-water-services", icon: "💧" },
    { name: "Garbage & Sewage Services", slug: "waste-sanitation-services", icon: "♻️" },
    { name: "Typing, Secretarial & Translation", slug: "typing-translation", icon: "⌨️" },
    { name: "Funeral & Memorial Services", slug: "funeral-services", icon: "⚱️" },
  ],
  "agriculture": [
    { name: "Matooke, Cassava & Staple Foods", slug: "matooke-staples", icon: "🍌" },
    { name: "Flowers & Horticulture", slug: "flowers-horticulture", icon: "🌷" },
    { name: "Farm Services (Ploughing, Spraying, Harvesting)", slug: "farm-services", icon: "🚜" },
    { name: "Milling & Agro-Processing Services", slug: "agro-processing-services", icon: "⚙️" },
  ],
  "health-beauty": [
    { name: "Nails, Lashes & Beauty Tools", slug: "nails-lashes", icon: "💅" },
    { name: "Soap, Oils & Local Cosmetics", slug: "soap-oils-local", icon: "🧼" },
    { name: "Herbal & Natural Products", slug: "herbal-natural", icon: "🌿" },
    { name: "Glasses, Dental & Eye Care", slug: "optical-dental-care", icon: "👓" },
  ],
};

/** New top-level (standalone) categories with their own subcategories. */
export const UGANDA_STANDALONE_CATEGORIES: StandaloneCategorySeed[] = [
  {
    name: "Food & Beverages", slug: "food-groceries", icon: "🍲",
    children: [
      { name: "Street Food, Snacks & Rolex", slug: "street-food-snacks", icon: "🌯" },
      { name: "Flour, Sugar, Oil & Staples", slug: "staples-flour-oil", icon: "🌾" },
      { name: "Tea, Coffee & Cocoa Products", slug: "tea-coffee-cocoa", icon: "☕" },
    ],
  },
  {
    name: "Building, Construction & Hardware", slug: "building-construction", icon: "🏗️",
    children: [
      { name: "Cement, Bricks & Blocks", slug: "cement-bricks-blocks", icon: "🧱" },
      { name: "Iron Sheets & Roofing Materials", slug: "iron-sheets-roofing", icon: "🏠" },
      { name: "Steel, Rebar & Metal Sections", slug: "steel-metal", icon: "🔩" },
      { name: "Timber & Wood Products", slug: "timber-wood-products", icon: "🪵" },
      { name: "Sand, Stones & Murram", slug: "sand-stones-murram", icon: "⛰️" },
      { name: "Doors, Windows & Security Grills", slug: "doors-windows-grills", icon: "🚪" },
      { name: "Fencing, Barbed Wire & Mesh", slug: "fencing-wire", icon: "🧷" },
      { name: "Paint, Tiles & Finishing", slug: "paint-tiles-finishing", icon: "🎨" },
      { name: "Plumbing & Sanitary Materials", slug: "plumbing-materials", icon: "🚰" },
      { name: "Electrical Materials & Cables", slug: "electrical-materials", icon: "💡" },
      { name: "Water Tanks & Pumps", slug: "water-tanks-pumps", icon: "💧" },
      { name: "Hand & Power Tools", slug: "hand-power-tools", icon: "🔨" },
    ],
  },
  {
    name: "Business & Industrial", slug: "industrial-business", icon: "🏭",
    children: [
      { name: "Workshop & Manufacturing Machinery", slug: "workshop-machinery", icon: "⚙️" },
      { name: "Sewing & Knitting Machines", slug: "sewing-knitting-machines", icon: "🧵" },
      { name: "Milling & Agro-Processing Machines", slug: "milling-agro-machines", icon: "🌾" },
      { name: "Freezers & Cold Room Equipment", slug: "freezers-cold-rooms", icon: "🧊" },
      { name: "Shop Fittings, Shelves & POS", slug: "shop-fittings-pos", icon: "🧾" },
      { name: "Packaging & Printing Equipment", slug: "packaging-printing-equipment", icon: "📦" },
    ],
  },
  {
    name: "Energy, Solar & Cooking Fuel", slug: "energy-power", icon: "⚡",
    children: [
      { name: "Solar Panels, Kits & Lighting", slug: "solar-panels-kits", icon: "☀️" },
      { name: "Inverters, Batteries & Stabilizers", slug: "inverters-batteries", icon: "🔋" },
      { name: "Gas Cylinders & Cookers", slug: "gas-cylinders-stoves", icon: "🔥" },
      { name: "Charcoal, Briquettes & Firewood", slug: "charcoal-briquettes", icon: "🪵" },
      { name: "Energy-Saving Stoves & Biogas", slug: "energy-saving-stoves", icon: "♨️" },
      { name: "Solar & Power Installation Services", slug: "power-installation-services", icon: "🔧" },
    ],
  },
  {
    name: "Pets & Animals", slug: "pets-animals", icon: "🐕",
    children: [
      { name: "Pet Vet, Grooming & Boarding", slug: "pet-services", icon: "🩺" },
    ],
  },
  {
    name: "Education & Books", slug: "education-training", icon: "🎓",
    children: [
      { name: "Nursery, Primary & Secondary Schools", slug: "schools-nursery-secondary", icon: "🏫" },
      { name: "Colleges, Universities & Institutes", slug: "colleges-universities", icon: "🏛️" },
      { name: "Vocational & Skills Training", slug: "vocational-skills", icon: "🔧" },
      { name: "Driving Schools", slug: "driving-schools", icon: "🚗" },
    ],
  },
  {
    name: "Events & Entertainment", slug: "events-entertainment", icon: "🎉",
    children: [
      { name: "Venues & Halls", slug: "event-venues-halls", icon: "🏛️" },
    ],
  },
  {
    name: "Travel, Tours & Hospitality", slug: "travel-tourism", icon: "✈️",
    children: [
      { name: "Tours, Safaris & Gorilla Trekking", slug: "tours-safaris", icon: "🦍" },
      { name: "Hotels, Lodges & Guest Houses", slug: "hotels-lodges", icon: "🏨" },
      { name: "Flights, Visas & Travel Agents", slug: "flights-visas-agents", icon: "🛫" },
      { name: "Bus Travel & Cargo Services", slug: "bus-cargo-services", icon: "🚌" },
      { name: "Adventure, Rafting & Camping", slug: "adventure-camping", icon: "🏕️" },
    ],
  },
  {
    name: "Fine Jewellery", slug: "fine-jewellery", icon: "💎",
    children: [
      { name: "Necklaces", slug: "necklaces", icon: "📿" },
      { name: "Rings", slug: "rings", icon: "💍" },
      { name: "Bracelets", slug: "bracelets", icon: "✨" },
      { name: "Earrings", slug: "earrings", icon: "💎" },
      { name: "Pendants", slug: "pendants", icon: "🏅" },
      { name: "Brooches & Pins", slug: "brooches", icon: "🌸" },
      { name: "Jewellery Sets", slug: "sets", icon: "🎁" },
      { name: "Other Jewellery", slug: "other-jewellery", icon: "🔮" },
    ],
  },
  {
    name: "Arts & Collectibles", slug: "arts-collectibles", icon: "🎨",
    children: [
      { name: "Paintings & Prints", slug: "paintings", icon: "🖼️" },
      { name: "Sculptures", slug: "sculptures", icon: "🗿" },
      { name: "Photography Prints", slug: "photography", icon: "📷" },
      { name: "Antiques", slug: "antiques", icon: "🏺" },
      { name: "Coins & Stamps", slug: "coins-stamps", icon: "🪙" },
      { name: "Vintage Items", slug: "vintage", icon: "🕰️" },
      { name: "Tribal & Cultural Art", slug: "tribal-art", icon: "🎭" },
      { name: "Crafts & Handmade (Baskets, Bark Cloth)", slug: "crafts-handmade", icon: "🧺" },
      { name: "Other Collectibles", slug: "other-art", icon: "🔮" },
    ],
  },
];

/** Standalone parents without their children (shape used by DEFAULT_CATEGORIES / seed `categories`). */
export const UGANDA_STANDALONE_PARENTS: CategorySeed[] = UGANDA_STANDALONE_CATEGORIES.map(
  ({ name, slug, icon }) => ({ name, slug, icon }),
);

/**
 * Merges a base { parentSlug: subcategories[] } map with the Uganda additions
 * and the standalone parents' children. Never mutates the base map; skips any
 * slug already present under the same parent.
 */
export function withUgandaSubcategories(
  base: Record<string, CategorySeed[]>,
): Record<string, CategorySeed[]> {
  const out: Record<string, CategorySeed[]> = {};
  for (const [parent, subs] of Object.entries(base)) out[parent] = [...subs];
  const add = (parent: string, subs: CategorySeed[]) => {
    const list = (out[parent] = out[parent] || []);
    for (const s of subs) if (!list.some((x) => x.slug === s.slug)) list.push(s);
  };
  for (const [parent, subs] of Object.entries(UGANDA_SUBCATEGORY_ADDITIONS)) add(parent, subs);
  for (const c of UGANDA_STANDALONE_CATEGORIES) add(c.slug, c.children);
  return out;
}

/** Every slug introduced by this expansion (parents + children). */
export function allUgandaExpansionSlugs(): string[] {
  const slugs: string[] = [];
  for (const subs of Object.values(UGANDA_SUBCATEGORY_ADDITIONS)) slugs.push(...subs.map((s) => s.slug));
  for (const c of UGANDA_STANDALONE_CATEGORIES) slugs.push(c.slug, ...c.children.map((s) => s.slug));
  return slugs;
}

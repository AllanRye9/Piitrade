/**
 * categoryTaxonomy.ts — the marketplace's category tree and the "details" form each kind of ad asks for.
 *
 * Two levels: a top-level category (Motors, Property …) and its subcategories (Used Cars, Houses for Rent …).
 * The tree is ADDITIVE: on start-up every missing parent / subcategory is created, nothing that already exists
 * (or that an admin renamed / added / deleted fields on) is ever changed or removed. Slugs are unique across the
 * whole tree, so a new subcategory must never reuse a slug that exists anywhere else.
 *
 * Ad-type fields: `fieldsFor(slug, parentSlug, stored)` is the single source of truth for which extra fields an ad
 * form shows and the server validates. An admin-defined Category.fieldSchema (Admin → Categories → Custom Fields)
 * always wins when it has entries; otherwise the built-in set for that subcategory, else for its parent.
 * Motors, Property, Jobs and Agriculture also keep their dedicated forms in the listing page; the fields here add
 * to those only where listed below (none for those four).
 */

import { UGANDA_STANDALONE_PARENTS, withUgandaSubcategories } from '../data/ugandaTaxonomy';

export interface CategorySeed { name: string; slug: string; icon: string }

export type FieldType = 'text' | 'number' | 'select' | 'textarea' | 'date';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  /** Greyed example text inside the input. */
  placeholder?: string;
  /** Unit shown after a number ("cc", "kVA"). */
  unit?: string;
  /** One-line hint under the input. */
  help?: string;
  /** Show this field as a filter / headline spec on listing cards where supported. */
  highlight?: boolean;
}

// ─── The tree ───────────────────────────────────────────────────────────────

const BASE_CATEGORIES: CategorySeed[] = [
  { name: 'Motors', slug: 'motors', icon: '🚗' },
  { name: 'Property', slug: 'property', icon: '🏠' },
  { name: 'Jobs', slug: 'jobs', icon: '💼' },
  { name: 'CV Services', slug: 'cv-services', icon: '📄' },
  { name: 'Classifieds', slug: 'classifieds', icon: '📋' },
  { name: 'Electronics', slug: 'electronics', icon: '💻' },
  { name: 'Fashion', slug: 'fashion', icon: '👗' },
  { name: 'Furniture', slug: 'furniture', icon: '🛋️' },
  { name: 'Garden', slug: 'garden', icon: '🌿' },
  { name: 'Services', slug: 'services', icon: '🔧' },
  { name: 'Agriculture', slug: 'agriculture', icon: '🌾' },
  { name: 'Health & Beauty', slug: 'health-beauty', icon: '💄' },
  { name: 'Pets & Animals', slug: 'pets-animals', icon: '🐕' },
  { name: 'Business & Industrial', slug: 'industrial-business', icon: '🏭' },
  { name: 'Food & Beverages', slug: 'food-groceries', icon: '🍲' },
  { name: 'Education & Books', slug: 'education-training', icon: '🎓' },
  { name: 'Events & Entertainment', slug: 'events-entertainment', icon: '🎉' },
];

const s = (name: string, slug: string, icon: string): CategorySeed => ({ name, slug, icon });

const BASE_SUBCATEGORY_MAP: Record<string, CategorySeed[]> = {
  motors: [
    s('Used Cars', 'used-cars', '🚙'), s('New Cars', 'new-cars', '🏎️'), s('Classic Cars', 'classic-cars', '🚕'),
    s('Motorcycles', 'motorcycles', '🏍️'), s('Trucks & Buses', 'trucks-buses', '🚛'), s('Boats', 'boats', '⛵'),
    s('Car Parts', 'car-parts', '⚙️'), s('Tyres & Wheels', 'tyres-wheels', '🛞'), s('Car Accessories', 'car-accessories', '🪄'),
    s('Vehicle Hire & Rental', 'vehicle-hire', '🔑'), s('Heavy Equipment & Plant', 'heavy-equipment', '🚜'),
    s('Bicycles', 'bicycles', '🚲'), s('Motorcycle Parts & Gear', 'motorcycle-parts', '🪖'),
  ],
  property: [
    s('Apartments for Rent', 'apartments-rent', '🏢'), s('Houses for Rent', 'houses-rent', '🏠'), s('Rooms for Rent', 'rooms-rent', '🛏️'),
    s('Apartments for Sale', 'apartments-sale', '🏗️'), s('Houses for Sale', 'houses-sale', '🏡'), s('Land & Plots', 'land-plots', '🗺️'),
    s('Office Space', 'office-space', '🏢'), s('Shops & Retail', 'shops-retail', '🏪'), s('Warehouses', 'warehouses', '🏭'),
    s('Short-let & Guest Houses', 'short-let', '🛎️'), s('Hostels', 'hostels', '🎒'), s('Event Venues', 'event-venues', '🏛️'),
    s('Commercial Property for Sale', 'commercial-sale', '🏬'),
  ],
  jobs: [
    s('Full Time', 'full-time', '💼'), s('Part Time', 'part-time', '🕐'), s('Freelance', 'freelance', '💻'),
    s('Technology', 'technology', '🖥️'), s('Healthcare', 'healthcare', '🏥'), s('Finance', 'finance', '💰'),
    s('Internships & Graduate Trainee', 'internships', '🎓'), s('Education & Teaching', 'teaching-jobs', '📚'),
    s('Hospitality & Tourism', 'hospitality-jobs', '🍽️'), s('Construction & Trades', 'construction-jobs', '🧱'),
    s('Sales & Marketing', 'sales-marketing-jobs', '📈'), s('NGO & Development', 'ngo-jobs', '🤝'),
    s('Drivers & Logistics', 'driver-jobs', '🚚'), s('Domestic & Home Help', 'domestic-jobs', '🏠'),
  ],
  'cv-services': [
    s('CV Writing', 'cv-writing', '✍️'), s('Resume Templates', 'resume-templates', '📐'), s('LinkedIn Optimization', 'linkedin-optimization', '🔗'),
    s('Career Coaching', 'career-coaching', '🧑‍🏫'), s('Interview Preparation', 'interview-preparation', '🎤'), s('Cover Letters', 'cover-letters', '📝'),
  ],
  classifieds: [
    s('Furniture', 'furniture-classifieds', '🛋️'), s('Appliances', 'appliances', '🏠'), s('Tools & Garden', 'tools-garden', '🔧'),
    s('Kids & Baby', 'kids-baby', '🧒'), s('Sports & Outdoors', 'sports-outdoors', '⚽'), s('Books & Hobbies', 'books-hobbies', '📚'),
    s('Music & Instruments', 'music-instruments', '🎸'), s('Art & Collectibles', 'art-collectibles', '🖼️'),
    s('Free Stuff & Swaps', 'free-swaps', '🎁'), s('Lost & Found', 'lost-found', '🔎'),
  ],
  electronics: [
    s('Laptops', 'laptops', '💻'), s('Desktops & Monitors', 'desktops', '🖥️'), s('Tablets', 'tablets', '📱'),
    s('Smartphones', 'smartphones', '📱'), s('Headphones', 'headphones', '🎧'), s('Cameras', 'cameras', '📷'),
    s('Consoles', 'consoles', '🎮'), s('Games & Accessories', 'games-accessories', '🕹️'),
    s('Feature Phones', 'feature-phones', '☎️'), s('Phone Accessories', 'phone-accessories', '🔌'), s('Smart Watches & Wearables', 'smart-watches', '⌚'),
    s('TVs & Home Theatre', 'tvs-home-theatre', '📺'), s('Audio & Speakers', 'audio-speakers', '🔊'),
    s('Solar, Inverters & Batteries', 'solar-power', '☀️'), s('CCTV & Security', 'cctv-security', '📹'),
    s('Networking & Routers', 'networking', '📡'), s('Printers & Scanners', 'printers-scanners', '🖨️'), s('Computer Accessories', 'computer-accessories', '⌨️'),
  ],
  fashion: [
    s("Women's Clothing", 'women-clothing', '👗'), s("Women's Shoes", 'women-shoes', '👠'), s('Bags & Accessories', 'women-bags', '👜'),
    s("Men's Clothing", 'men-clothing', '👔'), s("Men's Shoes", 'men-shoes', '👞'), s('Watches', 'watches', '⌚'),
    s("Girls' Clothing", 'girls-clothing', '👧'), s("Boys' Clothing", 'boys-clothing', '👦'),
    s('Jewellery', 'jewellery', '💍'), s('Traditional & Cultural Wear', 'traditional-wear', '🧣'),
    s('School Uniforms', 'school-uniforms', '🎽'), s('Wedding & Occasion Wear', 'wedding-wear', '👰'), s('Kids Shoes', 'kids-shoes', '👟'),
  ],
  furniture: [
    s('Living Room', 'living-room', '🛋️'), s('Bedroom', 'bedroom', '🛏️'), s('Kitchen & Dining', 'kitchen-dining', '🍳'),
    s('Office Furniture', 'office-furniture', '🪑'), s('Mattresses & Bedding', 'mattresses-bedding', '🛌'), s('Home Decor & Lighting', 'home-decor', '🕯️'),
    s('Curtains, Carpets & Rugs', 'curtains-carpets', '🪟'), s('Kitchen Appliances', 'kitchen-appliances', '🍽️'),
  ],
  garden: [
    s('Garden Furniture', 'garden-furniture', '🪴'), s('BBQ & Grills', 'bbq-grills', '🔥'), s('Plants & Seeds', 'plants-seeds', '🌱'),
    s('Garden Tools & Equipment', 'garden-tools', '🧰'), s('Pots, Landscaping & Fencing', 'landscaping', '🏡'),
  ],
  services: [
    s('Cleaning', 'cleaning', '🧹'), s('Plumbing & Electrical', 'plumbing-electrical', '🔌'), s('Movers & Storage', 'movers-storage', '📦'),
    s('Tutoring', 'tutoring', '📖'), s('Design & Creative', 'design-creative', '🎨'), s('IT & Tech Support', 'it-tech-support', '💻'),
    s('Beauty & Salon', 'beauty-salon', '💇'), s('Photography & Video', 'photography-video', '📸'), s('Catering & Events', 'catering-events', '🍰'),
    s('Security Services', 'security-services', '🛡️'), s('Repairs & Maintenance', 'repairs-maintenance', '🛠️'),
    s('Construction & Renovation', 'construction-renovation', '🏗️'), s('Legal, Accounting & Business', 'business-services', '⚖️'),
    s('Transport & Delivery', 'transport-delivery', '🚚'), s('Car Services & Garages', 'car-services', '🔧'),
    s('Printing & Branding', 'printing-branding', '🖨️'), s('Health & Wellness Services', 'wellness-services', '🧘'),
  ],
  agriculture: [
    s('Crops & Grains', 'crops-grains', '🌽'), s('Fruits & Vegetables', 'fruits-vegetables', '🍅'), s('Livestock', 'livestock', '🐄'),
    s('Poultry & Eggs', 'poultry-eggs', '🐔'), s('Dairy Products', 'dairy-products', '🥛'), s('Seeds & Inputs', 'seeds-inputs', '🌱'),
    s('Farm Equipment', 'farm-equipment', '🚜'), s('Coffee, Tea & Cash Crops', 'cash-crops', '☕'), s('Fish & Aquaculture', 'fish-aquaculture', '🐟'),
    s('Animal Feeds', 'animal-feeds', '🌾'), s('Fertilisers & Agrochemicals', 'fertilisers', '🧪'), s('Honey & Beekeeping', 'honey-beekeeping', '🍯'),
    s('Irrigation & Farm Structures', 'irrigation', '💧'), s('Veterinary Products & Services', 'veterinary', '💉'),
  ],
  'health-beauty': [
    s('Skincare', 'skincare', '🧴'), s('Hair Care, Wigs & Weaves', 'hair-care', '💇‍♀️'), s('Makeup', 'makeup', '💄'),
    s('Fragrances', 'fragrances', '🌸'), s('Personal Care', 'personal-care', '🧼'), s('Health Equipment & Supplies', 'health-equipment', '🩺'),
    s('Vitamins & Supplements', 'supplements', '💊'), s('Fitness Equipment', 'fitness-equipment', '🏋️'),
  ],
  'pets-animals': [
    s('Dogs & Puppies', 'dogs', '🐕'), s('Cats & Kittens', 'cats', '🐈'), s('Birds', 'birds', '🦜'), s('Fish & Aquariums', 'aquarium-fish', '🐠'),
    s('Pet Food', 'pet-food', '🥫'), s('Pet Accessories & Care', 'pet-accessories', '🦴'), s('Other Pets', 'other-pets', '🐇'),
  ],
  'industrial-business': [
    s('Machinery & Tools', 'machinery-tools', '⚙️'), s('Construction Materials', 'construction-materials', '🧱'),
    s('Office Equipment & Supplies', 'office-equipment', '🗄️'), s('Restaurant & Catering Equipment', 'catering-equipment', '🍳'),
    s('Salon & Barber Equipment', 'salon-equipment', '💈'), s('Generators & Power Equipment', 'generators', '⚡'),
    s('Safety & Protective Gear', 'safety-gear', '🦺'), s('Wholesale & Bulk Lots', 'wholesale-bulk', '📦'),
  ],
  'food-groceries': [
    s('Prepared Meals & Catering', 'prepared-meals', '🍛'), s('Bakery & Cakes', 'bakery-cakes', '🎂'), s('Drinks & Juices', 'drinks-juices', '🧃'),
    s('Packaged & Dry Foods', 'packaged-foods', '🥫'), s('Spices, Sauces & Oils', 'spices-oils', '🌶️'), s('Meat & Fish Products', 'meat-fish', '🥩'),
  ],
  'education-training': [
    s('Textbooks & Study Guides', 'textbooks', '📘'), s('Courses & Training', 'courses-training', '🎓'), s('School Supplies', 'school-supplies', '✏️'),
    s('Scholarships & Admissions', 'scholarships', '🏅'), s('Language Classes', 'language-classes', '🗣️'),
  ],
  'events-entertainment': [
    s('Event Tickets', 'event-tickets', '🎫'), s('Equipment Hire (Tents, Chairs, Sound)', 'event-hire', '🎪'), s('DJs, MCs & Live Bands', 'djs-bands', '🎧'),
    s('Wedding Services', 'wedding-services', '💒'), s('Party Supplies & Decor', 'party-supplies', '🎈'),
  ],
};

// Uganda expansion (data/ugandaTaxonomy.ts): extra subcategories for the parents above plus a few standalone
// parents (Building & Hardware, Energy & Power, Travel & Tourism, Fine Jewellery, Arts & Collectibles).
// Anything this file already defines wins: the Uganda data omits duplicates, and the merge below also skips any
// slug that already exists anywhere in the tree, so slugs stay globally unique.
export const DEFAULT_CATEGORIES: CategorySeed[] = [
  ...BASE_CATEGORIES,
  ...UGANDA_STANDALONE_PARENTS.filter((c) => !BASE_CATEGORIES.some((b) => b.slug === c.slug)),
];

export const SUBCATEGORY_MAP: Record<string, CategorySeed[]> = (() => {
  const merged = withUgandaSubcategories(BASE_SUBCATEGORY_MAP);
  const seen = new Set<string>([...BASE_CATEGORIES.map((c) => c.slug), ...Object.values(BASE_SUBCATEGORY_MAP).flat().map((c) => c.slug)]);
  const out: Record<string, CategorySeed[]> = {};
  for (const [parent, subs] of Object.entries(merged)) {
    const base = BASE_SUBCATEGORY_MAP[parent] ?? [];
    const baseSlugs = new Set(base.map((c) => c.slug));
    out[parent] = [...base];
    for (const c of subs) {
      if (baseSlugs.has(c.slug)) continue;
      if (seen.has(c.slug)) continue;
      seen.add(c.slug);
      out[parent].push(c);
    }
  }
  return out;
})();

export const ALL_SUBCATEGORY_SLUGS: string[] = Object.values(SUBCATEGORY_MAP).flat().map((c) => c.slug);

// ─── Ad-type fields ─────────────────────────────────────────────────────────

const text = (name: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'text', ...o });
const num = (name: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'number', ...o });
const sel = (name: string, label: string, options: string[], o: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'select', options, ...o });
const area = (name: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'textarea', ...o });
const date = (name: string, label: string, o: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'date', ...o });
const YES_NO = ['Yes', 'No'];

const PHONE_BRANDS = ['Apple', 'Samsung', 'Tecno', 'Infinix', 'Itel', 'Xiaomi', 'Redmi', 'Huawei', 'Honor', 'Oppo', 'Realme', 'Vivo', 'Nokia', 'Google Pixel', 'OnePlus', 'Motorola', 'Other'];
const LAPTOP_BRANDS = ['HP', 'Dell', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Toshiba', 'Microsoft', 'Samsung', 'MSI', 'Other'];
const STORAGE = ['8GB', '16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];
const RAM = ['1GB', '2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '32GB', '64GB'];
const COLOURS = ['Black', 'White', 'Grey', 'Silver', 'Gold', 'Blue', 'Red', 'Green', 'Brown', 'Pink', 'Purple', 'Orange', 'Yellow', 'Multicolour'];
const WARRANTY = ['No warranty', '1 month', '3 months', '6 months', '1 year', '2 years or more'];
const CLOTHES_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'One size'];
const SHOE_SIZES = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47'];
const KID_SIZES = ['0-3 months', '3-6 months', '6-12 months', '1-2 years', '2-4 years', '4-6 years', '6-8 years', '8-10 years', '10-12 years', '12-14 years'];
const KID_SHOE_SIZES = ['18-22', '23-27', '28-32', '33-36'];
const PRICE_BASIS = ['Fixed price', 'Per hour', 'Per day', 'Per job / project', 'Per week', 'Per month', 'Negotiable'];
const MATERIALS = ['Wood', 'Metal', 'Leather', 'Fabric', 'Plastic', 'Glass', 'Rattan / Cane', 'Foam', 'Other'];

const PRESETS = {
  phone: [
    sel('brand', 'Brand', PHONE_BRANDS, { required: true, highlight: true }),
    text('model', 'Model', { required: true, placeholder: 'e.g. Galaxy A54, iPhone 13 Pro', highlight: true }),
    sel('storage', 'Storage', STORAGE, { highlight: true }),
    sel('ram', 'RAM', RAM),
    text('color', 'Colour'),
    sel('sim', 'SIM', ['Single SIM', 'Dual SIM', 'eSIM']),
    sel('warranty', 'Warranty', WARRANTY),
    sel('boxed', 'Comes with box & charger', YES_NO),
  ],
  featurePhone: [
    sel('brand', 'Brand', ['Nokia', 'Itel', 'Tecno', 'Samsung', 'Other'], { required: true }),
    text('model', 'Model'), sel('sim', 'SIM', ['Single SIM', 'Dual SIM', 'Triple SIM']), sel('warranty', 'Warranty', WARRANTY),
  ],
  tablet: [
    sel('brand', 'Brand', ['Apple', 'Samsung', 'Huawei', 'Lenovo', 'Amazon', 'Tecno', 'Other'], { required: true, highlight: true }),
    text('model', 'Model', { required: true }), sel('storage', 'Storage', STORAGE), sel('ram', 'RAM', RAM),
    num('screenSize', 'Screen size', { unit: 'inches' }), sel('connectivity', 'Connectivity', ['Wi-Fi only', 'Wi-Fi + SIM']), sel('warranty', 'Warranty', WARRANTY),
  ],
  laptop: [
    sel('brand', 'Brand', LAPTOP_BRANDS, { required: true, highlight: true }),
    text('model', 'Model', { required: true, placeholder: 'e.g. EliteBook 840 G5, MacBook Air M1' }),
    text('processor', 'Processor', { placeholder: 'e.g. Intel Core i5 8th gen', highlight: true }),
    sel('ram', 'RAM', RAM, { highlight: true }),
    sel('storage', 'Storage size', ['128GB', '256GB', '512GB', '1TB', '2TB'], { highlight: true }),
    sel('storageType', 'Storage type', ['SSD', 'HDD', 'SSD + HDD']),
    num('screenSize', 'Screen size', { unit: 'inches' }),
    sel('os', 'Operating system', ['Windows 11', 'Windows 10', 'macOS', 'Linux', 'Chrome OS', 'None']),
    text('graphics', 'Graphics card', { placeholder: 'e.g. Integrated, RTX 3050' }),
    sel('warranty', 'Warranty', WARRANTY),
  ],
  desktop: [
    sel('type', 'Type', ['Desktop computer', 'All-in-one', 'Monitor', 'Mini PC', 'Server']),
    sel('brand', 'Brand', ['HP', 'Dell', 'Lenovo', 'Apple', 'Asus', 'Acer', 'Samsung', 'LG', 'Other'], { required: true }),
    text('model', 'Model'), text('processor', 'Processor'), sel('ram', 'RAM', RAM), sel('storage', 'Storage', ['128GB', '256GB', '512GB', '1TB', '2TB']),
    num('screenSize', 'Screen size', { unit: 'inches' }), sel('warranty', 'Warranty', WARRANTY),
  ],
  tv: [
    sel('brand', 'Brand', ['Samsung', 'LG', 'Sony', 'Hisense', 'TCL', 'Skyworth', 'Hikers', 'Other'], { required: true, highlight: true }),
    num('screenSize', 'Screen size', { unit: 'inches', required: true, highlight: true }),
    sel('display', 'Display', ['LED', 'QLED', 'OLED', 'LCD', 'Plasma']),
    sel('resolution', 'Resolution', ['HD', 'Full HD', '4K', '8K']), sel('smart', 'Smart TV', YES_NO), sel('warranty', 'Warranty', WARRANTY),
  ],
  audio: [
    sel('brand', 'Brand', ['JBL', 'Sony', 'Bose', 'Samsung', 'LG', 'Apple', 'Anker', 'Hisense', 'Other'], { required: true }),
    text('model', 'Model'), sel('connectivity', 'Connectivity', ['Bluetooth', 'Wired', 'Bluetooth + Wired']),
    num('power', 'Power output', { unit: 'W' }), sel('warranty', 'Warranty', WARRANTY),
  ],
  headphones: [
    sel('brand', 'Brand', ['Apple', 'Sony', 'JBL', 'Samsung', 'Anker', 'Beats', 'Bose', 'Other'], { required: true }),
    sel('type', 'Type', ['Over-ear', 'On-ear', 'In-ear / earbuds', 'Neckband']), sel('connectivity', 'Connectivity', ['Bluetooth', 'Wired']), sel('noiseCancelling', 'Noise cancelling', YES_NO),
  ],
  camera: [
    sel('brand', 'Brand', ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'Panasonic', 'GoPro', 'DJI', 'Other'], { required: true }),
    text('model', 'Model', { required: true }), sel('cameraType', 'Type', ['DSLR', 'Mirrorless', 'Compact', 'Video camera', 'Action camera', 'Drone']),
    num('megapixels', 'Megapixels', { unit: 'MP' }), num('shutterCount', 'Shutter count', { help: 'Number of photos taken, if known' }), text('lens', 'Lens / kit included'),
  ],
  console: [
    sel('platform', 'Platform', ['PlayStation 5', 'PlayStation 4', 'PlayStation 3', 'Xbox Series X/S', 'Xbox One', 'Nintendo Switch', 'PC / Other'], { required: true }),
    sel('storage', 'Storage', ['250GB', '500GB', '825GB', '1TB', '2TB']), num('controllers', 'Controllers included'), sel('games', 'Games included', YES_NO),
  ],
  gamesAccessories: [
    sel('platform', 'Platform', ['PlayStation', 'Xbox', 'Nintendo', 'PC', 'Other'], { required: true }),
    sel('itemType', 'Item', ['Game', 'Controller', 'Headset', 'Charger / cable', 'Other']), text('title', 'Game title / model'),
  ],
  phoneAccessory: [
    sel('itemType', 'Item', ['Charger', 'Cable', 'Power bank', 'Phone case', 'Screen protector', 'Earphones', 'Memory card', 'Holder / stand', 'Other'], { required: true }),
    text('compatible', 'Compatible with', { placeholder: 'e.g. iPhone 13, USB-C phones' }), text('brand', 'Brand'),
  ],
  smartWatch: [
    sel('brand', 'Brand', ['Apple', 'Samsung', 'Huawei', 'Xiaomi', 'Garmin', 'Fitbit', 'Other'], { required: true }), text('model', 'Model'), sel('warranty', 'Warranty', WARRANTY),
  ],
  solar: [
    sel('itemType', 'Item', ['Solar panel', 'Inverter', 'Battery', 'Charge controller', 'Complete solar kit', 'Solar lights / lamp', 'UPS', 'Other'], { required: true, highlight: true }),
    text('brand', 'Brand'), num('power', 'Power rating', { unit: 'W / kVA', help: 'Panel watts or inverter kVA' }),
    text('capacity', 'Battery capacity', { placeholder: 'e.g. 200Ah, 5kWh' }), sel('voltage', 'System voltage', ['12V', '24V', '48V', 'Other']), sel('warranty', 'Warranty', WARRANTY),
  ],
  cctv: [
    sel('itemType', 'Item', ['Camera', 'DVR / NVR', 'Complete kit', 'Alarm system', 'Electric fence', 'Door lock / access control', 'Other'], { required: true }),
    text('brand', 'Brand'), num('cameras', 'Number of cameras'), sel('resolution', 'Resolution', ['720p', '1080p', '2K', '4K']), sel('warranty', 'Warranty', WARRANTY),
  ],
  networking: [
    sel('itemType', 'Item', ['Router', 'Modem / MiFi', 'Switch', 'Access point', 'Range extender', 'Cable / connectors', 'Other'], { required: true }), text('brand', 'Brand'), text('model', 'Model'),
  ],
  printer: [
    sel('itemType', 'Item', ['Printer', 'Scanner', 'Photocopier', 'Ink / toner', 'Other'], { required: true }), text('brand', 'Brand'), text('model', 'Model'),
    sel('printType', 'Print type', ['Laser', 'Inkjet', 'Thermal', 'Multifunction']), sel('colourPrint', 'Colour', ['Black & white', 'Colour']),
  ],
  computerAccessory: [
    sel('itemType', 'Item', ['Keyboard', 'Mouse', 'Charger', 'Bag', 'Hard drive / flash disk', 'RAM / SSD upgrade', 'Webcam', 'Monitor stand', 'Other'], { required: true }), text('brand', 'Brand'), text('compatible', 'Compatible with'),
  ],
  clothing: (sizes: string[]) => [
    sel('size', 'Size', sizes, { required: true, highlight: true }), text('brand', 'Brand'), sel('color', 'Colour', COLOURS), text('material', 'Material', { placeholder: 'e.g. Cotton, Kitenge, Denim' }),
  ],
  shoes: (sizes: string[]) => [
    sel('size', 'Shoe size', sizes, { required: true, highlight: true }), text('brand', 'Brand'), sel('color', 'Colour', COLOURS), sel('shoeType', 'Type', ['Sneakers', 'Formal', 'Boots', 'Sandals', 'Heels', 'Flats', 'Sports', 'School shoes', 'Other']),
  ],
  bag: [
    sel('itemType', 'Item', ['Handbag', 'Backpack', 'Travel bag / suitcase', 'Wallet', 'Belt', 'Sunglasses', 'Scarf / hat', 'Other'], { required: true }), text('brand', 'Brand'), sel('color', 'Colour', COLOURS), text('material', 'Material'),
  ],
  watch: [
    text('brand', 'Brand', { required: true }), sel('movement', 'Movement', ['Quartz', 'Automatic', 'Digital', 'Smart']), sel('gender', 'For', ['Men', 'Women', 'Unisex', 'Kids']),
    sel('strap', 'Strap', ['Metal', 'Leather', 'Rubber / silicone', 'Fabric']), sel('boxed', 'Box & papers', YES_NO),
  ],
  jewellery: [
    sel('itemType', 'Item', ['Ring', 'Necklace', 'Earrings', 'Bracelet', 'Anklet', 'Set', 'Other'], { required: true }),
    sel('material', 'Material', ['Gold', 'Silver', 'Gold plated', 'Stainless steel', 'Beads', 'Other']), sel('gender', 'For', ['Women', 'Men', 'Unisex', 'Kids']),
  ],
  traditional: [
    sel('itemType', 'Item', ['Gomesi', 'Kanzu', 'Kitenge outfit', 'Shuka / Maasai', 'Other'], { required: true }), sel('size', 'Size', CLOTHES_SIZES), sel('color', 'Colour', COLOURS), sel('gender', 'For', ['Women', 'Men', 'Kids']),
  ],
  uniform: [
    text('school', 'School', { required: true }), sel('level', 'Level', ['Nursery', 'Primary', 'Secondary', 'University']), sel('size', 'Size', [...KID_SIZES, ...CLOTHES_SIZES]), sel('gender', 'For', ['Girls', 'Boys', 'Unisex']),
  ],
  furniture: [
    sel('itemType', 'Item', ['Sofa / couch', 'Armchair', 'Coffee / side table', 'TV stand', 'Cabinet / shelf', 'Bed', 'Wardrobe', 'Dining set', 'Desk / office chair', 'Other']),
    sel('material', 'Material', MATERIALS, { highlight: true }), sel('color', 'Colour', COLOURS), text('dimensions', 'Size (L × W × H)', { placeholder: 'e.g. 200 × 90 × 85 cm' }),
    num('seats', 'Seats / pieces in set'), sel('delivery', 'Delivery available', YES_NO),
  ],
  mattress: [
    sel('itemType', 'Item', ['Mattress', 'Bed sheets', 'Duvet / blanket', 'Pillows', 'Mosquito net', 'Other'], { required: true }), sel('size', 'Size', ['Single (3x6)', 'Three-quarter (4x6)', 'Double (5x6)', 'Queen (6x6)', 'King (6x7)', 'Other']),
    sel('thickness', 'Mattress type', ['Foam', 'Spring', 'Orthopedic', 'Memory foam', 'Other']),
  ],
  decor: [
    sel('itemType', 'Item', ['Wall art / frames', 'Lamp / lighting', 'Mirror', 'Clock', 'Vase / ornaments', 'Plants (artificial)', 'Other']), sel('color', 'Colour', COLOURS), text('dimensions', 'Size'),
  ],
  rug: [
    sel('itemType', 'Item', ['Curtains', 'Carpet', 'Rug / mat', 'Blinds', 'Other'], { required: true }), text('dimensions', 'Size'), sel('color', 'Colour', COLOURS),
  ],
  appliance: [
    sel('itemType', 'Item', ['Fridge / freezer', 'Cooker / stove', 'Microwave', 'Washing machine', 'Blender / juicer', 'Kettle / toaster', 'Fan / heater / AC', 'Iron', 'Water dispenser', 'Gas cylinder / burner', 'Other']),
    sel('brand', 'Brand', ['Samsung', 'LG', 'Hisense', 'Ramtons', 'Von', 'Hotpoint', 'Bruhm', 'Midea', 'Other'], { highlight: true }), text('capacity', 'Capacity / size', { placeholder: 'e.g. 250L, 7kg, 4 burners' }),
    sel('power', 'Power source', ['Electric', 'Gas', 'Solar', 'Charcoal / wood', 'Battery']), sel('warranty', 'Warranty', WARRANTY),
  ],
  tools: [
    sel('itemType', 'Item', ['Power tool', 'Hand tool', 'Ladder', 'Welding equipment', 'Pump', 'Other']), text('brand', 'Brand'), sel('power', 'Power source', ['Electric', 'Petrol', 'Battery', 'Manual']),
  ],
  kids: [
    sel('itemType', 'Item', ['Clothes', 'Shoes', 'Toys', 'Pram / stroller', 'Car seat', 'Cot / bed', 'Feeding', 'Diapers', 'School bags', 'Other']), sel('ageGroup', 'Age group', ['0-12 months', '1-3 years', '3-6 years', '6-12 years', '12+ years']), text('brand', 'Brand'),
  ],
  sports: [
    sel('itemType', 'Item', ['Football / boots', 'Gym equipment', 'Bicycle', 'Camping / hiking', 'Swimming', 'Boxing / martial arts', 'Other']), text('brand', 'Brand'), text('size', 'Size'),
  ],
  books: [
    sel('itemType', 'Item', ['Book', 'Board game', 'Puzzle', 'Collectible', 'Craft supplies', 'Other']), text('title', 'Title / name'), text('author', 'Author / maker'),
  ],
  music: [
    sel('itemType', 'Instrument / gear', ['Guitar', 'Keyboard / piano', 'Drums', 'Microphone', 'Mixer / amp', 'Traditional (adungu, endongo, etc.)', 'Other'], { required: true }), text('brand', 'Brand'), text('model', 'Model'),
  ],
  art: [
    sel('itemType', 'Item', ['Painting', 'Sculpture', 'Craft / basket', 'Antique', 'Coin / stamp', 'Other']), text('artist', 'Artist / maker'), text('year', 'Year / era'),
  ],
  service: [
    sel('priceBasis', 'Pricing basis', PRICE_BASIS, { required: true, highlight: true }),
    text('serviceArea', 'Areas / districts you serve', { required: true, placeholder: 'e.g. Kampala, Wakiso, Entebbe' }),
    num('experience', 'Years of experience', { unit: 'years' }),
    sel('availability', 'Availability', ['Weekdays', 'Weekends', 'Every day', '24/7 / emergencies', 'By appointment']),
    sel('travels', 'Comes to the customer', YES_NO), text('qualifications', 'Qualifications / licence'),
  ],
  repairs: [
    sel('itemType', 'What you repair', ['Phones', 'Laptops / computers', 'TVs / electronics', 'Fridges / appliances', 'Generators', 'Furniture', 'Other']), sel('priceBasis', 'Pricing basis', PRICE_BASIS), text('serviceArea', 'Areas / districts you serve', { required: true }), sel('warrantyOnWork', 'Warranty on work', ['None', '1 week', '1 month', '3 months', '6 months']),
  ],
  transport: [
    sel('vehicleType', 'Vehicle', ['Boda boda', 'Pickup', 'Van', 'Lorry / truck', 'Taxi / car', 'Bus / coaster', 'Other'], { required: true }), sel('priceBasis', 'Pricing basis', PRICE_BASIS), text('serviceArea', 'Areas / routes', { required: true }), sel('insured', 'Insured', YES_NO),
  ],
  tutoring: [
    text('subjects', 'Subjects', { required: true }), sel('level', 'Level', ['Nursery', 'Primary', 'O-Level', 'A-Level', 'University', 'Adult / professional']), sel('mode', 'Mode', ['In person', 'Online', 'Both']), sel('priceBasis', 'Pricing basis', PRICE_BASIS), text('serviceArea', 'Area / district'),
  ],
  events: [
    sel('priceBasis', 'Pricing basis', ['Per event', 'Per hour', 'Per day', 'Per person', 'Negotiable']), num('capacity', 'Guests served', { help: 'Largest event you can handle' }), text('serviceArea', 'Areas / districts you serve', { required: true }), date('availableFrom', 'Available from'),
  ],
  beautyProduct: [
    sel('itemType', 'Product type', ['Cleanser', 'Moisturiser', 'Serum', 'Sunscreen', 'Soap / body wash', 'Lotion / oil', 'Deodorant', 'Hair product', 'Perfume', 'Other']), text('brand', 'Brand'), text('size', 'Size / volume', { placeholder: 'e.g. 250ml' }),
    sel('suitableFor', 'Suitable for', ['Women', 'Men', 'Unisex', 'Kids']), sel('authentic', 'Original / authentic', YES_NO), date('expiry', 'Expiry date'),
  ],
  hair: [
    sel('itemType', 'Item', ['Wig', 'Weave / extension', 'Braids / crochet hair', 'Hair oil / treatment', 'Dryer / straightener', 'Other'], { required: true }), sel('hairType', 'Hair type', ['Human hair', 'Synthetic', 'Mixed']), text('length', 'Length', { placeholder: 'e.g. 18 inches' }), sel('color', 'Colour', COLOURS),
  ],
  healthEquipment: [
    sel('itemType', 'Item', ['BP monitor', 'Thermometer', 'Wheelchair / crutches', 'Glucometer', 'First aid', 'Mobility aid', 'Other']), text('brand', 'Brand'), sel('warranty', 'Warranty', WARRANTY),
  ],
  fitness: [
    sel('itemType', 'Item', ['Treadmill', 'Weights / dumbbells', 'Exercise bike', 'Bench / rack', 'Mats / yoga', 'Other']), text('brand', 'Brand'), text('weight', 'Weight / capacity'),
  ],
  pet: [
    text('breed', 'Breed', { required: true, highlight: true }), sel('sex', 'Sex', ['Male', 'Female']), text('age', 'Age', { required: true, placeholder: 'e.g. 3 months' }),
    sel('vaccinated', 'Vaccinated', YES_NO), sel('dewormed', 'Dewormed', YES_NO), sel('papers', 'Pedigree papers', YES_NO),
  ],
  petSupplies: [
    sel('petType', 'For', ['Dogs', 'Cats', 'Birds', 'Fish', 'Other']), text('brand', 'Brand'), text('size', 'Size / weight'),
  ],
  machinery: [
    text('brand', 'Brand'), text('model', 'Model'), num('year', 'Year of manufacture'), sel('power', 'Power source', ['Electric', 'Diesel', 'Petrol', 'Manual', 'Solar']), num('powerRating', 'Power rating', { unit: 'kW / HP' }), sel('warranty', 'Warranty', WARRANTY),
  ],
  materials: [
    sel('itemType', 'Material', ['Cement', 'Iron sheets', 'Steel bars', 'Bricks / blocks', 'Timber', 'Tiles', 'Paint', 'Plumbing / electrical', 'Sand / gravel', 'Other'], { required: true }), text('brand', 'Brand'), text('quantity', 'Quantity available'), sel('delivery', 'Delivery available', YES_NO),
  ],
  generator: [
    sel('itemType', 'Item', ['Generator', 'Welding machine', 'Compressor', 'Power tool', 'Voltage stabiliser', 'Other']), text('brand', 'Brand'), num('powerRating', 'Power rating', { unit: 'kVA' }), sel('fuel', 'Fuel', ['Petrol', 'Diesel', 'Gas', 'Solar']), num('hoursUsed', 'Hours used'),
  ],
  food: [
    sel('storage', 'Product state', ['Ready to eat', 'Fresh', 'Frozen', 'Dry / packaged']), text('packSize', 'Pack size / quantity', { placeholder: 'e.g. 1kg, 12 pieces' }), sel('delivery', 'Delivery available', YES_NO), sel('orderLead', 'Order lead time', ['Same day', '1 day', '2-3 days', '1 week']),
  ],
  textbook: [
    text('title', 'Title', { required: true }), text('author', 'Author'), text('subject', 'Subject'), sel('level', 'Level', ['Primary', 'O-Level', 'A-Level', 'University', 'Professional / other']), text('edition', 'Edition'),
  ],
  course: [
    text('provider', 'Institution / trainer'), sel('mode', 'Mode', ['In person', 'Online', 'Hybrid']), text('duration', 'Duration', { placeholder: 'e.g. 6 weeks' }), sel('certificate', 'Certificate awarded', YES_NO), date('startDate', 'Next start date'),
  ],
  tickets: [
    text('eventName', 'Event', { required: true }), date('eventDate', 'Event date', { required: true }), text('venue', 'Venue', { required: true }), sel('ticketType', 'Ticket type', ['Regular', 'VIP', 'VVIP', 'Table / group']), num('ticketCount', 'Number of tickets'),
  ],
  hire: [
    sel('priceBasis', 'Pricing basis', ['Per event', 'Per day', 'Per item', 'Negotiable']), text('items', 'What is available', { placeholder: 'e.g. 200 chairs, 3 tents, PA system' }), sel('delivery', 'Delivery & setup', YES_NO), text('serviceArea', 'Areas / districts you serve'),
  ],
  fishFarm: [
    sel('itemType', 'Item', ['Live fish', 'Fingerlings', 'Smoked / dried fish', 'Fresh fish', 'Ponds & equipment', 'Fish feed']), text('species', 'Species', { placeholder: 'e.g. Tilapia, Catfish' }), text('quantity', 'Quantity available'),
  ],
  feed: [
    sel('animal', 'For', ['Poultry', 'Pigs', 'Cattle / dairy', 'Goats / sheep', 'Fish', 'Rabbits', 'Other']), text('brand', 'Brand'), text('packSize', 'Pack size', { placeholder: 'e.g. 50kg bag' }), sel('feedType', 'Type', ['Starter', 'Grower', 'Layers', 'Finisher', 'Concentrate', 'Hay / silage', 'Other']),
  ],
  fertiliser: [
    sel('itemType', 'Item', ['Fertiliser (NPK, urea, DAP)', 'Pesticide / herbicide', 'Fungicide', 'Organic manure', 'Other'], { required: true }), text('brand', 'Brand'), text('packSize', 'Pack size'), date('expiry', 'Expiry date'),
  ],
  honey: [
    sel('itemType', 'Item', ['Honey', 'Beeswax', 'Beehive / equipment', 'Bee colony', 'Other']), text('packSize', 'Pack size', { placeholder: 'e.g. 1 litre' }), sel('origin', 'Type', ['Raw / unprocessed', 'Processed']),
  ],
  irrigation: [
    sel('itemType', 'Item', ['Water pump', 'Drip kit', 'Water tank', 'Greenhouse', 'Poultry house / cage', 'Pipes / fittings', 'Other']), text('brand', 'Brand'), text('capacity', 'Capacity / size'),
  ],
  vet: [
    sel('itemType', 'Item', ['Vaccines', 'Drugs', 'Dewormers', 'Vet consultation', 'Artificial insemination', 'Other']), text('serviceArea', 'Areas / districts you serve'), date('expiry', 'Expiry date (products)'),
  ],
  cashCrop: [
    sel('crop', 'Crop', ['Coffee (Robusta)', 'Coffee (Arabica)', 'Tea', 'Cocoa', 'Vanilla', 'Cotton', 'Tobacco', 'Sugarcane', 'Other']), sel('grade', 'Grade / state', ['Kiboko', 'FAQ', 'Screen 15+', 'Parchment', 'Green beans', 'Roasted', 'Other']), text('quantity', 'Quantity available'),
  ],
  handyCar: [
    sel('serviceType', 'Service', ['Mechanic', 'Car wash', 'Towing', 'Spraying / panel beating', 'Tyre fitting', 'Auto electrical', 'Other'], { required: true }), sel('priceBasis', 'Pricing basis', PRICE_BASIS), text('serviceArea', 'Areas / districts you serve', { required: true }), sel('travels', 'Comes to the customer', YES_NO),
  ],
} as const;

type PresetKey = keyof typeof PRESETS;
const P = (k: Exclude<PresetKey, 'clothing' | 'shoes'>): FieldDef[] => PRESETS[k] as unknown as FieldDef[];

/** Fields by SUBCATEGORY slug. */
const BY_SLUG: Record<string, FieldDef[]> = {
  smartphones: P('phone'), 'feature-phones': P('featurePhone'), tablets: P('tablet'), laptops: P('laptop'), desktops: P('desktop'),
  headphones: P('headphones'), cameras: P('camera'), consoles: P('console'), 'games-accessories': P('gamesAccessories'),
  'phone-accessories': P('phoneAccessory'), 'smart-watches': P('smartWatch'), 'tvs-home-theatre': P('tv'), 'audio-speakers': P('audio'),
  'solar-power': P('solar'), 'cctv-security': P('cctv'), networking: P('networking'), 'printers-scanners': P('printer'), 'computer-accessories': P('computerAccessory'),
  'women-clothing': [...PRESETS.clothing(CLOTHES_SIZES)], 'men-clothing': [...PRESETS.clothing(CLOTHES_SIZES)],
  'girls-clothing': [...PRESETS.clothing(KID_SIZES)], 'boys-clothing': [...PRESETS.clothing(KID_SIZES)],
  'women-shoes': [...PRESETS.shoes(SHOE_SIZES)], 'men-shoes': [...PRESETS.shoes(SHOE_SIZES)], 'kids-shoes': [...PRESETS.shoes(KID_SHOE_SIZES)],
  'women-bags': P('bag'), watches: P('watch'), jewellery: P('jewellery'), 'traditional-wear': P('traditional'), 'school-uniforms': P('uniform'),
  'wedding-wear': [...PRESETS.clothing(CLOTHES_SIZES)],
  'living-room': P('furniture'), bedroom: P('furniture'), 'kitchen-dining': P('furniture'), 'office-furniture': P('furniture'), 'furniture-classifieds': P('furniture'),
  'mattresses-bedding': P('mattress'), 'home-decor': P('decor'), 'curtains-carpets': P('rug'), 'kitchen-appliances': P('appliance'), appliances: P('appliance'),
  'tools-garden': P('tools'), 'garden-tools': P('tools'), 'kids-baby': P('kids'), 'sports-outdoors': P('sports'), 'books-hobbies': P('books'),
  'music-instruments': P('music'), 'art-collectibles': P('art'),
  'beauty-salon': P('service'), 'photography-video': P('events'), 'catering-events': P('events'), 'security-services': P('service'), 'repairs-maintenance': P('repairs'),
  'construction-renovation': P('service'), 'business-services': P('service'), 'transport-delivery': P('transport'), 'car-services': P('handyCar'),
  'printing-branding': P('service'), 'wellness-services': P('service'), cleaning: P('service'), 'plumbing-electrical': P('service'), 'movers-storage': P('transport'),
  tutoring: P('tutoring'), 'design-creative': P('service'), 'it-tech-support': P('repairs'),
  skincare: P('beautyProduct'), makeup: P('beautyProduct'), fragrances: P('beautyProduct'), 'personal-care': P('beautyProduct'), supplements: P('beautyProduct'),
  'hair-care': P('hair'), 'health-equipment': P('healthEquipment'), 'fitness-equipment': P('fitness'),
  dogs: P('pet'), cats: P('pet'), birds: P('pet'), 'aquarium-fish': P('pet'), 'other-pets': P('pet'), 'pet-food': P('petSupplies'), 'pet-accessories': P('petSupplies'),
  'machinery-tools': P('machinery'), 'construction-materials': P('materials'), 'office-equipment': P('machinery'), 'catering-equipment': P('machinery'),
  'salon-equipment': P('machinery'), generators: P('generator'), 'safety-gear': [sel('itemType', 'Item', ['Helmet', 'Boots', 'Gloves', 'Overalls / reflector', 'Fire extinguisher', 'First aid', 'Other'], { required: true }), text('brand', 'Brand'), text('size', 'Size')], 'wholesale-bulk': P('materials'),
  'prepared-meals': P('food'), 'bakery-cakes': P('food'), 'drinks-juices': P('food'), 'packaged-foods': P('food'), 'spices-oils': P('food'), 'meat-fish': P('food'),
  textbooks: P('textbook'), 'courses-training': P('course'), 'language-classes': P('course'), 'school-supplies': [sel('itemType', 'Item', ['Exercise books', 'Textbooks', 'School bag', 'Geometry set / stationery', 'Lab equipment', 'Other'], { required: true }), sel('level', 'Level', ['Nursery', 'Primary', 'Secondary', 'University'])], scholarships: P('course'),
  'event-tickets': P('tickets'), 'event-hire': P('hire'), 'djs-bands': P('events'), 'wedding-services': P('events'), 'party-supplies': P('hire'),
  'fish-aquaculture': P('fishFarm'), 'animal-feeds': P('feed'), fertilisers: P('fertiliser'), 'honey-beekeeping': P('honey'), irrigation: P('irrigation'),
  veterinary: P('vet'), 'cash-crops': P('cashCrop'),
};

/** Fallback by PARENT slug (a subcategory with no entry above, or the parent selected itself). */
const BY_PARENT: Record<string, FieldDef[]> = {
  services: P('service'),
  electronics: [sel('brand', 'Brand', PHONE_BRANDS.concat(['HP', 'Dell', 'Lenovo', 'Sony', 'LG']).filter((v, i, a) => a.indexOf(v) === i), { highlight: true }), text('model', 'Model'), sel('warranty', 'Warranty', WARRANTY)],
  fashion: [text('brand', 'Brand'), text('size', 'Size'), sel('color', 'Colour', COLOURS)],
  furniture: P('furniture'),
  'health-beauty': P('beautyProduct'),
  'pets-animals': P('pet'),
  'industrial-business': P('machinery'),
  'food-groceries': P('food'),
  'education-training': P('textbook'),
  'events-entertainment': P('events'),
  // Uganda expansion parents (data/ugandaTaxonomy.ts)
  'building-construction': [text('brand', 'Brand / make'), sel('condition', 'Condition', ['New', 'Used', 'Surplus / leftover']), text('quantity', 'Quantity / pack size')],
  'energy-power': [text('brand', 'Brand'), text('capacity', 'Capacity / rating', { help: 'e.g. 5kVA, 200W panel, 12V 100Ah' }), sel('condition', 'Condition', ['New', 'Used']), sel('warranty', 'Warranty', ['None', '6 months', '1 year', '2+ years'])],
  'travel-tourism': [text('destination', 'Destination / area'), text('duration', 'Duration', { help: 'e.g. 3 days, 1 night' }), text('groupSize', 'Group size')],
  'fine-jewellery': [sel('material', 'Material', ['Gold', 'Silver', 'Platinum', 'Gemstone', 'Other']), text('purity', 'Purity / carat'), sel('condition', 'Condition', ['New', 'Used'])],
  'arts-collectibles': [text('artist', 'Artist / maker'), text('year', 'Year / era'), sel('condition', 'Condition', ['New', 'Used', 'Antique'])],
};

/** Slugs whose ad form already has a dedicated section in the listing page; the generic fields are not added there. */
export const DEDICATED_FORM_PARENTS = new Set(['motors', 'property', 'jobs']);

const isUsableSchema = (v: unknown): v is FieldDef[] => Array.isArray(v) && v.length > 0;

/**
 * The fields the ad form asks for (and the server validates) for a category.
 * `stored` is Category.fieldSchema as saved by an admin; when it has entries it replaces the built-in set.
 */
export function fieldsFor(slug: string | null | undefined, parentSlug: string | null | undefined, stored?: unknown): FieldDef[] {
  if (isUsableSchema(stored)) return stored;
  const top = parentSlug ?? slug ?? '';
  if (DEDICATED_FORM_PARENTS.has(top)) return [];
  if (slug && BY_SLUG[slug]) return BY_SLUG[slug];
  if (parentSlug && BY_PARENT[parentSlug]) return BY_PARENT[parentSlug];
  if (!parentSlug && slug && BY_PARENT[slug]) return BY_PARENT[slug];
  return [];
}

export interface FieldCheck { missing: string[]; invalid: string[]; clean: Record<string, string> }

/**
 * Validates submitted answers against a field list: required fields present, selects one of the options,
 * numbers numeric, dates ISO. Unknown keys are dropped; values are trimmed and capped at 500 characters.
 */
export function checkFieldValues(fields: FieldDef[], values: Record<string, unknown> | null | undefined): FieldCheck {
  const missing: string[] = [];
  const invalid: string[] = [];
  const clean: Record<string, string> = {};
  const answers = values && typeof values === 'object' ? values : {};
  for (const f of fields) {
    const raw = (answers as Record<string, unknown>)[f.name];
    const v = raw == null ? '' : String(raw).trim().slice(0, 500);
    if (!v) { if (f.required) missing.push(f.label || f.name); continue; }
    if (f.type === 'select' && f.options && !f.options.includes(v)) { invalid.push(`${f.label || f.name}`); continue; }
    if (f.type === 'number' && !Number.isFinite(Number(v))) { invalid.push(`${f.label || f.name}`); continue; }
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { invalid.push(`${f.label || f.name}`); continue; }
    clean[f.name] = v;
  }
  return { missing, invalid, clean };
}

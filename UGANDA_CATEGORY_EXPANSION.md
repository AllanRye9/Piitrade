> **Merged-codebase note (read first).** After merging with main (round 7), the Uganda expansion is **118 new rows**, not 197:
> 53 subcategories under existing parents, 10 standalone parents (5 of them are the same top-level slugs main already had, so only
> 5 are really new) and 55 of their subcategories. 79 entries were dropped because main's `categoryTaxonomy.ts` already has the same
> idea (30 identical slugs, 49 under a different slug). Migrations were renumbered to `20261027100000`-`140000`. Figures and slug
> lists below describe the original, pre-merge design; see `MERGE_NOTES.md` for the current state.

# Uganda Category Expansion — Implementation Log & Context to Follow

Date: 2026-10-23 · Project: Piitrade / pi-classifieds (Next.js frontend + Express/Prisma backend) · Upload reviewed: `pii.zip`

## 1. Request (as stated)
Audit `/listings/` (single post and admin bulk post) so the site can take any form of goods and services, benchmarked on **jiji.ug** and **Dubizzle**. Add the missing categories: those that fit an existing parent go in as **subcategories**; those that are standalone are implemented **separately**. Only items in demand in **Uganda**, especially the **informal sector**. Log everything in a `.md` with context to follow. (Earlier in the same session: add the missing "classified" entry to the listing/bulk-post part.)

## 2. Result at a glance
| | Count |
|---|---|
| Subcategories added to **existing** parents | 111 across 11 parents |
| **Standalone** top-level categories added | 10 (with 76 subcategories) |
| New category rows total | 197 |
| Tagged informal-sector | 101 of 187 subcategories |
| Parent categories before → after | 12 → 22 |

## 2b. Progress checklist (✅ finished · ⬜ open)
**Finished**
- ✅ Audit of `/listings/create` and `/admin/bulk-post` against Jiji/Dubizzle breadth (gap list in the chat + section 7/10)
- ✅ "classified" gap fixed in bulk-post (singular and variants now resolve to Classifieds)
- ✅ 111 subcategories added under existing parents (migration `20261023100000`)
- ✅ 10 standalone parents + 76 subcategories, implemented separately (migration `20261023110000`)
- ✅ Rollback scripts for both migrations
- ✅ Single shared data module; `seed.ts` and the `routes/categories.ts` auto-seed both use it (Health & Beauty drift fixed)
- ✅ 6 guard unit tests (slug collisions, naming, page-slug compatibility, idempotent merge)
- ✅ ~185 Uganda/informal-sector CSV synonyms + option-chip slug sets (create and bulk-post)
- ✅ Informal-sector tagging and the exclusion list (section 7)
- ✅ Capacity audit of site surfaces and the arrangement/management strategy (sections 11–14)
- ✅ **Phase 0 built and verified (section 15):** header tab strip fits to width with a "More" menu, mega-menu limits, cascading subcategory filter, API-driven search dropdown, empty categories hidden on every buyer surface
- ✅ **Phase 1 built and verified (section 16):** `/categories` index page, home tiles and mobile grid (top categories + "More"), admin **Category Layout** (order and hide), searchable category picker with recents and a phone sheet, shared synonyms, sitemap fix
- ✅ **Phase 2 built and verified (section 17):** category display fields in the database (order, short name, menu group, retire), generic API-driven category pages `/category/<slug>`, admin **Category Structure** (reorder, rename for tiles, group, retire, merge)
- ✅ **Listing alerts built and verified (section 18):** set criteria (e.g. land under UGX 5,000,000, smartphones under UGX 250,000); the moment a matching listing is posted the user gets a profile notification, an e-mail and a sound alert on the site (≈60 ms measured locally)

**Open** (details in sections 10 and 13)
- ⬜ Run both migrations on staging; full backend `tsc` and frontend build; click-through QA
- ⬜ Phase 3 governance automation (section 13); alert follow-ups: browser push for when the site is closed, WhatsApp/SMS, job alerts (section 18.8)
- ⬜ Run the new migrations on staging with the project's own `prisma migrate deploy` (verified here with plain `psql`, section 19)
- ⬜ Look at Phases 0 and 1 in a real browser (1024 / 1280 / 1536 / 1920 px desktop, a real phone for the picker sheet and home grid); tests simulate widths and touch, they don't render pixels
- ⬜ Posting-form gaps: condition, price units, negotiable price, per-category custom fields (section 10)

## 3. Decision rules used
1. **Subcategory vs standalone.** A category became a **standalone parent** only if (a) it is a distinct shopping/browsing intent, (b) it has several children of its own, and (c) putting it under an existing parent would bury it or mix unrelated buyers. Otherwise it became a subcategory of the closest existing parent.
2. **Phones & Tablets was deliberately NOT made standalone** (Jiji's largest category). Smartphones/Tablets already live under Electronics with listings, the `/electronics` page config and counts depending on them; moving them would break those. Instead Electronics gained phone accessories, feature phones, power banks, etc.
3. **Babies & Kids, Sports/Fitness, Musical Instruments** were also kept as subcategories (Classifieds / Fashion) rather than standalone, to avoid splitting thin categories.
4. **Informal-sector tag (🛠)** = goods or services typically traded by individual vendors, artisans, market traders, boda/transport operators and micro-businesses (second-hand clothes, charcoal, kiosks, welders, salons, boda parts, and so on).
5. **Slugs are globally unique** in this schema (`Category.slug @unique`, not per parent). Every new slug was checked against every existing slug (197 new, 0 collisions).
6. `fine-jewellery` and `arts-collectibles` were created with the **exact slugs the existing frontend pages already use** (`/fine-jewellery`, `/arts-collectibles` previously had no category behind them).

> **Honesty note on "demand":** the Uganda-demand and informal-sector selection is a judgement from knowledge of the Ugandan market, **not measured platform data**. Validate/prune with `/admin/search-logs`, `/admin/analytics` and listing counts after launch (see section 9).

## 4. Files changed / added
| File | Change |
|---|---|
| `backend/src/data/ugandaTaxonomy.ts` | **New.** Single source of truth: `UGANDA_SUBCATEGORY_ADDITIONS`, `UGANDA_STANDALONE_CATEGORIES`, `UGANDA_STANDALONE_PARENTS`, `withUgandaSubcategories()`, `allUgandaExpansionSlugs()` |
| `backend/src/data/ugandaTaxonomy.test.ts` | **New.** 6 unit tests: no duplicate slugs, no collision with `prisma/seed.ts`, kebab-case, parents exist, jewellery/arts page slugs kept, merge is idempotent |
| `backend/prisma/migrations/20261023100000_uganda_subcategories_existing_parents/migration.sql` | **New.** Part A (existing parents). Idempotent `ON CONFLICT (slug) DO NOTHING` |
| `backend/prisma/migrations/20261023110000_uganda_standalone_categories/migration.sql` | **New.** Part B (standalone parents + children), separate so it rolls back independently |
| `backend/prisma/rollbacks/…100000…down.sql`, `…110000…down.sql` | **New.** Delete only rows no listing uses |
| `backend/prisma/seed.ts` | Imports the data module; merges additions into `categories` / `subcategoryMap` (file keeps its CRLF line endings) |
| `backend/src/routes/categories.ts` | Auto-seed (`DEFAULT_CATEGORIES`, `SUBCATEGORY_MAP`) now merges the same data. Also fixes a drift: `health-beauty` was missing from the auto-seed list |
| `frontend/app/admin/bulk-post/page.tsx` | `CATEGORY_SYNONYMS`: +"classified" variants and ~185 Uganda/informal terms (boda boda, mivumba, kitenge, fundi, kiosk, rolex, matooke, charcoal, …) mapped to real slugs; option-chip slug sets extended |
| `frontend/app/listings/create/page.tsx` | Same option-chip slug set extensions (so new categories get sensible size/colour/etc. suggestions) |

## 5. Part A — new subcategories under EXISTING parents (🛠 = informal-sector)

### Motors (`motors`) — 8 added
| Subcategory | Slug | Informal |
|---|---|---|
| 🏍️ Boda Boda & Delivery Bikes | `boda-boda-bikes` | 🛠 |
| 🛺 Tuk-Tuks & Three-Wheelers | `tuk-tuk-three-wheelers` | 🛠 |
| 🚐 Vans & Minibuses (Taxis) | `vans-minibuses` | 🛠 |
| 🚲 Bicycles | `bicycles` | 🛠 |
| 🏗️ Heavy Equipment & Machinery | `heavy-equipment` |  |
| 🔩 Motorcycle Parts & Accessories | `motorcycle-parts` | 🛠 |
| 🔑 Vehicle Hire & Rental | `vehicle-hire` |  |
| 🛠️ Garage & Auto Repair Services | `auto-repair-services` | 🛠 |

### Property (`property`) — 5 added
| Subcategory | Slug | Informal |
|---|---|---|
| 🧳 Short-Term & Holiday Rentals | `short-term-rentals` |  |
| 🏬 Commercial Property for Sale | `commercial-for-sale` |  |
| 🌾 Farms & Estates | `farms-estates` |  |
| 🎓 Student Hostels | `student-hostels` | 🛠 |
| 🏪 Market Stalls, Kiosks & Arcade Shops | `market-stalls-kiosks` | 🛠 |

### Jobs (`jobs`) — 13 added
| Subcategory | Slug | Informal |
|---|---|---|
| 🧱 Casual & Daily Labour | `casual-labour` | 🛠 |
| 🧹 House Help, Nannies & Domestic Staff | `domestic-staff` | 🛠 |
| 🚗 Drivers, Boda Riders & Conductors | `drivers-riders` | 🛠 |
| 🏗️ Construction & Artisans (Fundis) | `construction-jobs` | 🛠 |
| 📈 Sales, Shop Attendants & Marketing | `sales-marketing-jobs` | 🛠 |
| 🍽️ Hotels, Restaurants & Bars | `hospitality-jobs` |  |
| 🛡️ Security & Guards | `security-jobs` | 🛠 |
| 🏫 Teaching & Education | `teaching-jobs` |  |
| 🌱 Farm & Agribusiness Jobs | `agriculture-jobs` | 🛠 |
| 🌍 NGO & Development | `ngo-jobs` |  |
| ⚙️ Engineering & Technical | `engineering-jobs` |  |
| 🎓 Internships & Graduate Trainees | `internships` |  |
| 🌐 Remote & Online Work | `remote-jobs` |  |

### Classifieds (`classifieds`) — 10 added
| Subcategory | Slug | Informal |
|---|---|---|
| ♻️ Used Household Items | `second-hand-household` | 🛠 |
| 📦 Wholesale & Bulk Deals | `wholesale-bulk` | 🛠 |
| 💼 Businesses for Sale (Shops, Salons, Kiosks) | `business-for-sale` | 🛠 |
| 🔄 Swap & Barter | `swap-barter` | 🛠 |
| 🎁 Free Stuff & Giveaways | `free-items` | 🛠 |
| 🔎 Lost & Found | `lost-found` |  |
| 🧸 Toys & Games | `toys-games` |  |
| 🍼 Strollers, Cots & Baby Gear | `baby-gear` |  |
| 📎 Stationery & School Supplies | `school-supplies` | 🛠 |
| 🎸 Musical Instruments & Equipment | `musical-instruments` |  |

### Electronics (`electronics`) — 10 added
| Subcategory | Slug | Informal |
|---|---|---|
| 🔌 Phone Accessories & Chargers | `phone-accessories` | 🛠 |
| 📞 Basic & Feature Phones | `feature-phones` | 🛠 |
| 📺 TVs & Decoders | `tvs-home-entertainment` |  |
| 🔊 Speakers, Sound Systems & Radios | `speakers-audio` | 🛠 |
| 🖨️ Printers, Scanners & Copiers | `printers-scanners` |  |
| 📡 Routers & Networking | `networking-wifi` |  |
| ⌚ Smartwatches & Wearables | `smartwatches` |  |
| 🔋 Power Banks & UPS | `power-banks-ups` | 🛠 |
| 📹 CCTV & Security Systems | `cctv-security` |  |
| 🖱️ Computer Accessories & Storage | `computer-accessories` |  |

### Fashion (`fashion`) — 12 added
| Subcategory | Slug | Informal |
|---|---|---|
| ♻️ Second-Hand Clothes (Mivumba) | `mitumba` | 🛠 |
| 👟 Second-Hand Shoes | `mitumba-shoes` | 🛠 |
| 🧵 African Wear, Kitenge & Gomesi | `african-wear` | 🛠 |
| 🎒 School Uniforms | `school-uniforms` | 🛠 |
| 💒 Wedding, Bridal & Introduction Attire | `wedding-attire` |  |
| 👶 Baby & Toddler Clothing | `baby-clothing` |  |
| 🎽 Sportswear & Jerseys | `sportswear-jerseys` |  |
| 🩲 Underwear & Sleepwear | `underwear-sleepwear` |  |
| 🧶 Fabrics & Textiles | `fabrics-textiles` | 🛠 |
| 🥾 Workwear, Overalls & Safety Boots | `workwear-safety` | 🛠 |
| 🕶️ Sunglasses & Eyewear | `eyewear` |  |
| 🎒 Bags, Backpacks & Luggage | `bags-luggage` |  |

### Furniture (`furniture`) — 7 added
| Subcategory | Slug | Informal |
|---|---|---|
| 💼 Office Furniture | `office-furniture` |  |
| 🛏️ Mattresses & Bedding | `mattresses-bedding` | 🛠 |
| 🗄️ Wardrobes, Shelves & Storage | `storage-wardrobes` |  |
| 🖼️ Home Decor, Curtains & Rugs | `home-decor-curtains` |  |
| 💡 Lighting & Fans | `lighting-fans` |  |
| 🪚 Made-to-Order & Local Carpentry | `carpentry-made-to-order` | 🛠 |
| ♻️ Second-Hand Furniture | `second-hand-furniture` | 🛠 |

### Garden (`garden`) — 3 added
| Subcategory | Slug | Informal |
|---|---|---|
| 🌸 Flowers, Hedges & Landscaping | `flowers-landscaping` | 🛠 |
| 🪴 Pots, Planters & Nurseries | `pots-nurseries` | 🛠 |
| 🚿 Garden Tools & Irrigation | `garden-tools-irrigation` |  |

### Services (`services`) — 24 added
| Subcategory | Slug | Informal |
|---|---|---|
| 💇 Salons, Barbers & Hairdressing | `beauty-salons-barbers` | 🛠 |
| 🧵 Tailoring & Fashion Design | `tailoring-fashion-design` | 🛠 |
| 🚿 Car Wash & Detailing | `car-wash-detailing` | 🛠 |
| 📱 Phone & Computer Repair | `phone-computer-repair` | 🛠 |
| 🔧 Appliance & Electronics Repair | `appliance-repair` | 🛠 |
| 🔥 Welding & Metal Fabrication | `welding-metalwork` | 🛠 |
| 🪚 Carpentry & Joinery | `carpentry-joinery` | 🛠 |
| 🧱 Masonry, Bricklaying & Building Works | `masonry-building` | 🛠 |
| 🏠 Roofing, Ceilings & Gypsum | `roofing-ceilings` | 🛠 |
| 🎨 Painting & Decorating | `painting-decorating` | 🛠 |
| 🍲 Catering & Cooking | `catering-cooking` | 🛠 |
| 📸 Photography & Videography | `photography-video-services` | 🛠 |
| 🛵 Boda Delivery, Courier & Errands | `delivery-courier` | 🛠 |
| 🧺 Laundry & Dry Cleaning | `laundry-dry-cleaning` | 🛠 |
| 🪳 Pest Control & Fumigation | `pest-control` |  |
| 🛡️ Security Guards & Alarm Services | `security-services` |  |
| 🖨️ Printing, Branding & Signage | `printing-branding` | 🛠 |
| 👞 Shoe Repair & Cobblers | `shoe-repair` | 🛠 |
| 📡 DStv, Satellite & CCTV Installation | `satellite-cctv-installation` | 🛠 |
| 💧 Borehole Drilling & Water Services | `borehole-water-services` |  |
| ♻️ Garbage & Sewage Services | `waste-sanitation-services` | 🛠 |
| ⚖️ Legal & Accounting Services | `legal-accounting` |  |
| ⌨️ Typing, Secretarial & Translation | `typing-translation` | 🛠 |
| ⚱️ Funeral & Memorial Services | `funeral-services` |  |

### Agriculture (`agriculture`) — 11 added
| Subcategory | Slug | Informal |
|---|---|---|
| 🍌 Matooke, Cassava & Staple Foods | `matooke-staples` | 🛠 |
| 🐟 Fish & Aquaculture | `fish-aquaculture` | 🛠 |
| 🌾 Animal Feed & Supplements | `animal-feed` | 🛠 |
| 🧪 Fertilizers & Agrochemicals | `fertilizers-agrochemicals` |  |
| 💧 Irrigation & Water Pumps | `irrigation-pumps` |  |
| 🐝 Bees, Honey & Hives | `beekeeping-honey` | 🛠 |
| ☕ Coffee, Cocoa & Cash Crops | `coffee-cash-crops` |  |
| 🌷 Flowers & Horticulture | `flowers-horticulture` |  |
| 🩺 Veterinary Services & Drugs | `veterinary-services` | 🛠 |
| 🚜 Farm Services (Ploughing, Spraying, Harvesting) | `farm-services` | 🛠 |
| ⚙️ Milling & Agro-Processing Services | `agro-processing-services` | 🛠 |

### Health & Beauty (`health-beauty`) — 8 added
| Subcategory | Slug | Informal |
|---|---|---|
| 💇 Wigs, Weaves & Hair Extensions | `hair-extensions-wigs` | 🛠 |
| 💅 Nails, Lashes & Beauty Tools | `nails-lashes` | 🛠 |
| 🧼 Soap, Oils & Local Cosmetics | `soap-oils-local` | 🛠 |
| ✂️ Salon & Barber Equipment | `salon-barber-equipment` | 🛠 |
| 💊 Vitamins & Supplements | `supplements-vitamins` |  |
| 🌿 Herbal & Natural Products | `herbal-natural` | 🛠 |
| 🩺 Medical Equipment & Supplies | `medical-equipment` |  |
| 👓 Glasses, Dental & Eye Care | `optical-dental-care` |  |

## 6. Part B — STANDALONE categories (separate migration)

### 🛒 Food, Drinks & Groceries (`food-groceries`) — 8 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 🌯 Street Food, Snacks & Rolex | `street-food-snacks` | 🛠 |
| 🎂 Bakery, Cakes & Pastries | `bakery-cakes` | 🛠 |
| 🌾 Flour, Sugar, Oil & Staples | `staples-flour-oil` | 🛠 |
| 🥩 Meat & Fish (Fresh & Smoked) | `meat-fish-processed` | 🛠 |
| 🥤 Juices, Soft Drinks & Water | `juices-water` | 🛠 |
| ☕ Tea, Coffee & Cocoa Products | `tea-coffee-cocoa` |  |
| 🍯 Spices, Honey & Condiments | `spices-honey` | 🛠 |
| 🥫 Packaged Groceries | `groceries-packaged` |  |

### 🏗️ Building, Construction & Hardware (`building-construction`) — 12 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 🧱 Cement, Bricks & Blocks | `cement-bricks-blocks` | 🛠 |
| 🏠 Iron Sheets & Roofing Materials | `iron-sheets-roofing` | 🛠 |
| 🔩 Steel, Rebar & Metal Sections | `steel-metal` | 🛠 |
| 🪵 Timber & Wood Products | `timber-wood-products` | 🛠 |
| ⛰️ Sand, Stones & Murram | `sand-stones-murram` | 🛠 |
| 🚪 Doors, Windows & Security Grills | `doors-windows-grills` | 🛠 |
| 🧷 Fencing, Barbed Wire & Mesh | `fencing-wire` | 🛠 |
| 🎨 Paint, Tiles & Finishing | `paint-tiles-finishing` |  |
| 🚰 Plumbing & Sanitary Materials | `plumbing-materials` |  |
| 💡 Electrical Materials & Cables | `electrical-materials` |  |
| 💧 Water Tanks & Pumps | `water-tanks-pumps` |  |
| 🔨 Hand & Power Tools | `hand-power-tools` | 🛠 |

### 🏭 Business, Industrial & Machinery (`industrial-business`) — 9 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| ⚙️ Workshop & Manufacturing Machinery | `workshop-machinery` | 🛠 |
| 🧵 Sewing & Knitting Machines | `sewing-knitting-machines` | 🛠 |
| 🌾 Milling & Agro-Processing Machines | `milling-agro-machines` | 🛠 |
| 🧊 Freezers & Cold Room Equipment | `freezers-cold-rooms` | 🛠 |
| 🍳 Commercial Kitchen & Catering Equipment | `commercial-kitchen` |  |
| 🧾 Shop Fittings, Shelves & POS | `shop-fittings-pos` | 🛠 |
| 📦 Packaging & Printing Equipment | `packaging-printing-equipment` |  |
| 🦺 Safety Gear & PPE | `safety-ppe` |  |
| 🗂️ Office Equipment | `office-equipment` |  |

### ⚡ Energy, Solar & Cooking Fuel (`energy-power`) — 7 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| ☀️ Solar Panels, Kits & Lighting | `solar-panels-kits` | 🛠 |
| 🔋 Inverters, Batteries & Stabilizers | `inverters-batteries` | 🛠 |
| ⚡ Generators | `generators` |  |
| 🔥 Gas Cylinders & Cookers | `gas-cylinders-stoves` | 🛠 |
| 🪵 Charcoal, Briquettes & Firewood | `charcoal-briquettes` | 🛠 |
| ♨️ Energy-Saving Stoves & Biogas | `energy-saving-stoves` | 🛠 |
| 🔧 Solar & Power Installation Services | `power-installation-services` | 🛠 |

### 🐕 Pets & Pet Supplies (`pets-animals`) — 6 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 🐶 Dogs & Puppies | `dogs-puppies` |  |
| 🐱 Cats & Kittens | `cats-kittens` |  |
| 🕊️ Birds & Pigeons | `birds-pigeons` | 🛠 |
| 🐠 Aquarium Fish | `aquarium-fish` |  |
| 🦴 Pet Food & Supplies | `pet-food-supplies` |  |
| 🩺 Pet Vet, Grooming & Boarding | `pet-services` |  |

### 🎓 Education & Training (`education-training`) — 6 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 🏫 Nursery, Primary & Secondary Schools | `schools-nursery-secondary` |  |
| 🏛️ Colleges, Universities & Institutes | `colleges-universities` |  |
| 🔧 Vocational & Skills Training | `vocational-skills` | 🛠 |
| 🚗 Driving Schools | `driving-schools` | 🛠 |
| 🗣️ Language & Professional Courses | `language-professional-courses` |  |
| 📚 Textbooks & Study Materials | `textbooks-study-materials` |  |

### 🎉 Events, Weddings & Entertainment (`events-entertainment`) — 6 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 🎪 Tents, Chairs & Equipment Hire | `tents-chairs-hire` | 🛠 |
| 🎧 DJs, MCs & Sound Systems | `djs-mcs-sound` | 🛠 |
| 💍 Wedding Planning, Decor & Makeup | `wedding-services` | 🛠 |
| 🎤 Bands, Dancers & Performers | `performers-bands` | 🛠 |
| 🏛️ Venues & Halls | `event-venues-halls` |  |
| 🎫 Tickets & Shows | `event-tickets` |  |

### ✈️ Travel, Tours & Hospitality (`travel-tourism`) — 5 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 🦍 Tours, Safaris & Gorilla Trekking | `tours-safaris` |  |
| 🏨 Hotels, Lodges & Guest Houses | `hotels-lodges` |  |
| 🛫 Flights, Visas & Travel Agents | `flights-visas-agents` |  |
| 🚌 Bus Travel & Cargo Services | `bus-cargo-services` | 🛠 |
| 🏕️ Adventure, Rafting & Camping | `adventure-camping` |  |

### 💎 Fine Jewellery (`fine-jewellery`) — 8 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 📿 Necklaces | `necklaces` |  |
| 💍 Rings | `rings` |  |
| ✨ Bracelets | `bracelets` |  |
| 💎 Earrings | `earrings` |  |
| 🏅 Pendants | `pendants` |  |
| 🌸 Brooches & Pins | `brooches` |  |
| 🎁 Jewellery Sets | `sets` |  |
| 🔮 Other Jewellery | `other-jewellery` |  |

### 🎨 Arts & Collectibles (`arts-collectibles`) — 9 subcategories
| Subcategory | Slug | Informal |
|---|---|---|
| 🖼️ Paintings & Prints | `paintings` |  |
| 🗿 Sculptures | `sculptures` |  |
| 📷 Photography Prints | `photography` |  |
| 🏺 Antiques | `antiques` |  |
| 🪙 Coins & Stamps | `coins-stamps` |  |
| 🕰️ Vintage Items | `vintage` |  |
| 🎭 Tribal & Cultural Art | `tribal-art` |  |
| 🧺 Crafts & Handmade (Baskets, Bark Cloth) | `crafts-handmade` | 🛠 |
| 🔮 Other Collectibles | `other-art` |  |

Notes on moves made to avoid overlap: charcoal/firewood and generators/solar sit in **Energy** (not Agriculture/Electronics); timber sits in **Building** (not Agriculture); salon/barber *equipment* sits in Health & Beauty while salon/barber *services* sit in Services.

## 7. Considered but NOT added (and why)
| Item | Reason |
|---|---|
| Alcohol & spirits | Age-restricted and regulated; needs a moderation/age-gate decision first |
| Loans, SACCO, forex, mobile-money agent lines | Financial-services/fraud risk; needs product and legal decision |
| Adult / sexual wellness | Content policy risk |
| Betting / gambling | Regulated |
| Digital products & gift cards | Low informal-sector relevance, high scam risk |
| Community & volunteering | Low listing demand for now |
| Phones & Tablets as standalone | See rule 2 |
| Third category level (e.g. Phones → Brand → Model) | Needs schema/UI work; see section 9 |
| Extra beads/handmade jewellery child | `/fine-jewellery` page has a hard-coded subcategory list; add it there at the same time |

## 8. How to apply
1. Deploy backend; run `prisma migrate deploy` (applies `20261023100000` then `20261023110000`). Both are idempotent and safe to re-run.
2. Fresh/dev database: `prisma db seed` now creates the same tree.
3. `GET /api/categories` is cached ~120 s (`stale-while-revalidate` 300 s), so new categories appear within a few minutes. The frontend needs no deploy for the pickers to show them (CategoryPicker, FilterSidebar and bulk-post read `/categories`).
4. Rollback: run the matching `.down.sql` from `backend/prisma/rollbacks/`. They delete only categories with **no listings**.
5. Tests: `npm test` in `backend` (the new `ugandaTaxonomy.test.ts` is included).

## 9. Verification status
**Done:** slug collision check (197 new, 0 collisions); the 6 unit tests passed in an isolated run; type-check of the data module (`tsc --strict`); syntax check of every modified file; every synonym target verified to exist.
**NOT done (no database or full install in this sandbox):** running the migrations against Postgres, a full `tsc` build of the whole backend, the frontend build, and exercising the UI. Please run the migrations on a staging copy first.

## 10. Context to follow — open items and gotchas

**Gotchas for whoever continues**
- Slugs are global. `ON CONFLICT DO NOTHING` / Prisma `upsert` **silently skips** a colliding slug instead of failing. The new test guards against collisions with `seed.ts`.
- The base category lists still exist in two places (`seed.ts` and `routes/categories.ts`); only the Uganda expansion is shared. Consolidating them into the data module is the logical next cleanup.
- `routes/categories.ts` auto-seed re-creates any parent in `DEFAULT_CATEGORIES` that is missing, so a parent an admin deleted on purpose will reappear. Remove it from the list if that matters.
- `prisma/seed.ts` has CRLF line endings; preserve them when editing.
- `isCategoryOrDescendant()` gating for Motors/Property/Jobs/Agriculture works by tree walk, so the new Jobs/Motors/Property/Agriculture subcategories automatically get the matching detail sections.

**Remaining gaps vs "any goods and services" (found in the audit, NOT yet fixed)**
- ⬜ **#1** **Condition** is only `NEW | USED` (Prisma enum). Services, jobs, digital and "refurbished" have no honest value. Suggest adding `NOT_APPLICABLE` and `REFURBISHED` (enum migration plus form and filter changes).
- ⬜ **#2** **Price unit** is only `ITEM | KG | TONNE`. Informal services and rentals need per hour / day / week / month / per visit / per bag / per sack / per dozen / per sqm / per trip. Needs a `PriceUnit` enum migration plus the create, bulk-post and card display.
- ⬜ **#3** **Price is required.** Add "Negotiable" and "Contact for price" (and allow 0 for free items) so Free Stuff, Swap & Barter and service listings can post.
- ⬜ **#4** **Custom fields** (`Category.fieldSchema`, set in `/admin/categories`) are empty for every new subcategory. Highest-value schemas to define first: Boda Boda & Delivery Bikes, Mitumba, Matooke & Staples, Solar Panels, Salons & Barbers, Casual Labour, Cement & Bricks, Student Hostels.
- ⬜ (planned: P1/P2) **#5** **No dedicated storefront pages** for the 10 standalone parents (they exist as categories, reachable via `/listings?category=<slug>`, the picker and filters). `/fine-jewellery` and `/arts-collectibles` pages already exist and now have real categories behind them. Others would need a page each (follow the `CategoryPageTemplate` pattern) plus a `config.ts`.
- ✅ **#6** **Navigation (header strip, search dropdown and filters in Phase 0; home tiles, mobile grid and `/categories` in Phase 1):** `CategoryBar.tsx`, `lib/homeCategories.ts` and `HeaderSearch.tsx` have hard-coded category lists (HeaderSearch's dropdown, for example) that do not include the new parents.
- ⬜ **#7** **`FOOD_SLUGS`** in both posting forms still lists old placeholder slugs; point it at `food-groceries` children if option chips are wanted there.
- ✅ **#8** (comment fixed in Phase 0; the other, about `food-beverages`, was already accurate) Two stale code comments in `HeroSideCards.tsx` say `health-beauty` and `food-beverages` do not exist; `health-beauty` now does (since an earlier migration) and `food-groceries` now exists.
- ⬜ **#9** **Moderation:** Herbal & Natural Products, Pets and Veterinary Drugs deserve moderation prompt tuning (health claims, live animals, prescription items) in `routes/listings.ts` `MODERATION_SYSTEM_PROMPT`.
- ⬜ **#10** **Languages/i18n:** category names are English only; Luganda/Swahili labels would help informal-sector sellers.
- ⬜ (planned: P2) **#11** **Three-level taxonomy** (brand/model) is not supported by the picker or `GET /categories` (which returns parent + direct children only), although the rollup counts code already handles deeper trees.
- ⬜ (planned: P3) **#12** **Data-driven pruning:** after 4 to 6 weeks, review `/admin/search-logs` and per-category counts, then hide or merge empty categories (`useActiveSubcategoryCounts` already hides empty subcategories on storefront pages).

---

## 11. Capacity audit — how the new taxonomy loads each part of the site
**Scale change:** 12 parents / 77 subcategories → **22 parents / 264 subcategories (286 rows)**. Biggest parents after the change: Services 30, Fashion 20, Jobs 19, Electronics 18, Agriculture 18, Motors 17, Classifieds 16.
Figures marked ~ are estimates from the code (nothing was measured in a browser).

| # | Surface (file) | How it works today | Load with new taxonomy | Risk |
|---|---|---|---|---|
| 1 | Header tab strip (`components/layout/CategoryBar.tsx`) | One row, `overflow-x-auto`, tabs hard-coded in `topCategories`, `md:justify-center`. Tabs for empty listing-driven categories are hidden by count | ~110–130 px per tab → 12 tabs ≈ 1.3–1.6k px vs ~1.25k available (already tight at 1280 px); **23 tabs ≈ 2.5–3k px**. The 10 new parents are not in the hard-coded list, so they are currently invisible in the header | **High.** Also a latent bug: a centred flex row that overflows clips its left edge and the clipped part cannot be scrolled to |
| 2 | Mega menus (same file) | Columns `flex gap-6 min-w-[420px]`; no max-height and no viewport clamp; left offset follows the hovered tab | Services would grow 6 → 30 links; menus for right-hand tabs can run off-screen | **High** |
| 3 | Home tiles, desktop (`HomeCategoryTiles.tsx`, `lib/homeCategories.ts`) | `RowCarousel`, 5/6/8/10 tiles per view, arrows | Handles 21 tiles technically, but long scroll dilutes the best categories | Medium |
| 4 | Home grid, mobile (`MobileCategoryGrid.tsx`) | Fixed 4×2 grid of categories flagged `mobile: true` | New categories are unreachable from the mobile home | **High** (discoverability) |
| 5 | Category picker in the post forms (`components/ui/CategoryPicker.tsx`) | Two columns, each `max-h-[18rem]` scroll; sub-column opens on **hover**; stacked on mobile | 22 parents and up to 30 children scroll fine on desktop; on phones it is two stacked 18 rem scroll areas (≈ 580 px) and hover does not exist on touch; no search | **High** for seller UX |
| 6 | `/listings` filter (`FilterSidebar.tsx`) | One native `<select>` of **parents only** | 22 options is fine, but all 264 subcategories can't be filtered at all | **High** (functional gap) |
| 7 | Header search category dropdown (`HeaderSearch.tsx`) | Hard-coded 9 options (no Agriculture, Health & Beauty or any new parent); suggestions are API-driven | Stale list | Medium |
| 8 | Category pages (`CategoryPageTemplate.tsx`, per-parent `config.ts`) | Tile grid 2/3/4/6/7 cols; tiles come from a **hard-coded subcategory map** per page, then hidden if count is 0 | Grid scales, but new subcategories **do not appear** until each page config is extended; the 10 new parents have no pages (jewellery/arts pages exist) | **High** (invisible content) |
| 9 | Counts API (`utils/categoryCounts.ts`) | One computation, 5 s cache, rolled up | ~286 keys × 3 maps ≈ ~20 KB raw / ~2 KB gzip | Low |
| 10 | `GET /categories` (cached 120 s) | Parents + direct children with ids | ~55 KB raw / ~13 KB gzip (estimate; confirm compression is on); fetched by nav, picker and filter | Low–Medium |
| 11 | Labels | Names are full text everywhere | **107 of 197 new names exceed 24 characters, 38 exceed 30, 6 exceed 36** (e.g. "Farm Services (Ploughing, Spraying, Harvesting)") — will wrap in tiles, chips and menus | Medium |
| 12 | Empty states | Nav, page templates and subcategory lists already hide zero-count entries | Every new category starts at **0 listings**; any surface without count-gating will show empty pages | **High** (quality) |
| 13 | Admin categories page (`app/admin/categories/page.tsx`, 1069 lines) | Not inspected in depth | 286 rows: verify it has search, collapse and reorder | Unknown |
| 14 | SEO (`app/sitemap.ts`) | Not inspected | Empty category pages in the sitemap would be thin content | Unknown |

**Reading of the audit:** the *data layer scales fine* (counts, payloads, filtering by parent). What does **not** scale is anything **hard-coded or single-row**: the header strip, mega menus, mobile grid, page configs, and the search dropdown. The existing "hide if zero listings" behaviour is the strongest asset and should be extended to every buyer-facing surface.

## 12. Strategy — arrange and manage the categories without overflow or quality loss

### 12.1 Principles
1. **Two audiences, two rules.** *Sellers* (post form, bulk post) always see the full tree (never count-gated), so anyone can post anything. *Buyers* (nav, home, category pages, search) see only categories with live listings, so no empty pages.
2. **Rank, don't list.** Navigation shows the top-ranked categories that fit; the rest go behind one "All categories" entry. Fit is computed from available width (priority+ pattern), not from a fixed number.
3. **Data-driven, not hard-coded.** Every surface reads the category tree from the API; display order and pinning come from admin settings; copy is not duplicated in components.
4. **Short labels for tight spaces.** Add a `shortName` (≤ 22 characters) used in tiles, chips and menus; the full name is used on pages, picker and breadcrumbs.
5. **Cap, group, then split.** Soft cap of 20 children per parent, hard cap 30; above that, introduce menu groups (12.5) or a new parent.
6. **Supply before promotion.** A category is not promoted to nav/home until it has seeded listings (use admin bulk post).

### 12.2 Three display tiers
| Tier | Where it appears | Who/what decides |
|---|---|---|
| **1 – Pinned** | Header tabs, home tiles, mobile grid | Admin rank + live count ≥ threshold (start at ≥ 1; raise to ≥ 5 per country once volume exists) |
| **2 – Browse** | "All categories" panel and `/categories` index, category pages, filters | Live count ≥ 1 |
| **3 – Long tail** | Post-form picker, search suggestions, CSV import | Always available |

**Proposed starting rank for Uganda (judgement; admin-adjustable):** 1 Motors · 2 Property · 3 Electronics · 4 Fashion · 5 Jobs · 6 Services · 7 Agriculture · 8 Building & Construction · 9 Food & Groceries · 10 Classifieds · 11 Furniture · 12 Energy & Solar · then Health & Beauty, Business & Machinery, Events, Education, Pets, Travel, Garden, Arts, Jewellery, CV Services. Re-rank after 4–6 weeks from `/admin/search-logs` and live counts.

### 12.3 Per-surface arrangement (the "capacity budget")
| Surface | Target behaviour | Hard limit |
|---|---|---|
| Header tabs | Priority+ nav: render tabs in rank order, measure, move what doesn't fit into a final **"More ▾ / All categories"** menu; fix the centring bug with `justify-content: safe center` | No horizontal scroll ≥ 1024 px; ≤ 10 visible tabs at 1280 px |
| Mega menu | Curated columns kept (≤ 8 links each) **plus one "More in X" column** of the most-populated live subcategories the curated list doesn't link (≤ 8), + **"See all in X →"**; clamped to the bar's right edge; `max-height: min(70vh, 32rem)` with scroll | ≤ 3 curated columns + 1 "More in X" column; ≤ 8 links per column *(as built in Phase 0)* |
| "All categories" panel / `/categories` page | Grid 1/2/3/4 columns by breakpoint; each parent card shows up to 6 subcategory chips + "See all N" | All 22 parents, count-gated |
| Home tiles (desktop) | Top 12 by rank + final "All categories" tile; carousel stays | ≤ 13 tiles |
| Home grid (mobile) | Top 7 by rank + **"More"** tile (4×2 grid) linking to `/categories` | 8 slots |
| Post-form picker | Add **search box** (matches names and the shared synonym list: typing "boda" or "mivumba" jumps to the right place), **recently used**, and on phones a **full-screen drill-down sheet** (parents → children) instead of hover | No hover-only interaction |
| `/listings` filter | Add a **cascading subcategory select** (children of the chosen parent, with counts) and removable chips | All 264 subcategories filterable |
| Header search dropdown | Build from the API (pinned categories) instead of the 9 hard-coded options | — |
| Category pages | Tiles from API (name/icon) with a per-parent gradient fallback, count-gated; keep hand-made configs only for overrides | No page that needs a code change per new subcategory |
| Labels | Tile/menu/chip text uses `shortName` when name > 24 characters | Name ≤ 40 characters (test-enforced) |

### 12.4 Empty-state and supply policy
- Buyer surfaces: show a category only if live count ≥ threshold. Parents with zero listings stay in the picker and `/categories` only when ≥ 1 child has listings.
- Seller prompt: in the post form, show **"Popular places to post"** chips (Tier 1 categories) and an "Other …" fallback where a parent has none, to limit mis-filing.
- Launch order: (1) categories live in the picker only (current state after migration), (2) seed 10–20 listings in each Tier-1 candidate via bulk post, (3) promote to nav/home, (4) review after 4–6 weeks.
- SEO: `noindex` and sitemap exclusion for categories with zero listings; verify what `app/sitemap.ts` emits today.

### 12.5 Keeping big parents tidy — proposed menu groups
Add an optional `menuGroup` label per subcategory (used by the mega menu and `/categories` cards). Starting groups for the largest parents:
- **Services (30):** *Repair & Maintenance* (Phone & Computer Repair, Appliance Repair, Shoe Repair, Car Wash) · *Building & Trades* (Welding, Carpentry, Masonry, Roofing, Painting, Plumbing & Electrical, Borehole Drilling, Satellite/CCTV Installation) · *Beauty & Personal* (Salons & Barbers, Tailoring, Laundry) · *Food & Events* (Catering, Photography & Video) · *Transport & Moving* (Delivery & Courier, Movers & Storage) · *Professional & Office* (Legal & Accounting, Typing & Translation, Printing & Branding, Design, IT Support, Tutoring) · *Home & Safety* (Cleaning, Pest Control, Security, Waste, Funeral).
- **Jobs (19):** *Everyday work* (Casual Labour, Domestic Staff, Drivers, Construction, Sales & Shop, Hospitality, Security, Farm) · *Professional* (Technology, Healthcare, Finance, Engineering, Teaching, NGO) · *Type* (Full Time, Part Time, Freelance, Internships, Remote).
- **Fashion (20), Electronics (18), Agriculture (18), Motors (17):** split into 3 groups each (e.g. Fashion: *Clothing*, *Shoes & Bags*, *Second-hand & Local wear*).

### 12.6 Governance — how to keep it from sprawling again
1. One source of truth: migrate from the TS data module to admin-managed rows once `sortOrder`, `shortName`, `menuGroup` and `isActive` exist (section 13, P2).
2. Rule for adding a subcategory: only if it has **≥ 10 live listings filed under a parent's "Other"** or **≥ 20 searches/month** with no match. Rule for a new standalone parent: needs ≥ 5 viable children and a distinct buying intent.
3. Auto-hide: no live listings for 60 days → hidden from buyer surfaces (never deleted; still in the picker).
4. Safe operations: **merge** (re-parent listings, keep the old slug as a redirect), **rename** (slug unchanged), **hide** (`isActive=false`).
5. Quarterly review of search logs, zero-result queries and per-category counts; update the synonym list from real searches.
6. CI guards (extend `ugandaTaxonomy.test.ts`): name ≤ 40 characters, ≤ 30 children per parent, no slug collisions, every synonym target exists.

## 13. Phased implementation plan
| Phase | Goal | Work (files) | Done when |
|---|---|---|---|
| **P0 — before promoting any new category** ✅ | Remove overflow/functional risks | ✅ Header: priority+ nav and the `justify-center` clipping fix (`CategoryBar.tsx`) · ✅ Mega menu: viewport clamp, max-height, per-column cap, "More in X" column, "See all" · ✅ Filter: cascading subcategory select + chip (`FilterSidebar.tsx`) · ✅ Search dropdown from API + server-side suggestion gating (`HeaderSearch.tsx`, `routes/listings.ts`) · ✅ Count-gating on every buyer surface (section 15.3) | No horizontal scroll at 1024–1920 px *(logic verified; confirm visually)*; every live subcategory can be filtered; no empty category shown to buyers |
| **P1 — discoverability** ✅ | Make the long tail reachable | ✅ `/categories` index page (search, chips, count-gated) · ✅ Mobile home "More" tile (top 7 + More) and desktop "All categories" tile (top 12 + All) · ✅ Picker: search, recents, phone sheet · ✅ Shared `lib/categorySynonyms.ts` used by CSV import, picker and index search · ✅ Rank/hide via the existing `generalSettings` JSON and a new **Admin → Category Layout** page (**no schema change**) | Mobile user reaches any category in ≤ 3 taps; admin can reorder and hide categories without a deploy |
| **P2 — structure in the database** ✅ | Stop hard-coding | ✅ Prisma migration: `sortOrder`, `shortName`, `menuGroup`, `isActive` (+ backfill) · ✅ Generic API-driven category/subcategory page `/category/<slug>` · ✅ Admin Category Structure: search, collapse, reorder, short name, group, retire, merge · ✅ `shortName` used in live tiles, chips and menus · ✅ `mobile` flag and `SUBCATEGORY_INDEX` retired · ⬜ the hand-made storefront pages (`/services`, `/motors`, …) still use their own hard-coded subcategory lists | A new subcategory appears on its `/category/<slug>` page with **no code change** |
| **P3 — governance** | Keep quality over time | ⬜ Auto-hide idle categories (60 days) · ⬜ Zero-result-search report · ⬜ Extended CI guards (12.6) · ⬜ `noindex`/sitemap rules for empty categories | Quarterly review runbook in place |

**QA matrix for every phase:** viewports 320, 375, 768, 1024, 1280, 1536, 1920 px × data states (0 listings, a few, fully populated) × label stress test (longest 10 names) × keyboard/touch navigation × layout-shift check on first paint.

## 14. Context to follow (for the next session)
- Start with **P0**; those fixes are small and independent, and they are what stops overflow when the first new categories go live.
- The 10 standalone parents exist in the database after migration `20261023110000` but **are not in `topCategories` or `HOME_CATEGORIES`**; do not add them by hand to those lists — do P0/P1 first so they are ranked and count-gated.
- Estimates in section 11 (tab widths, payload sizes) were not measured; check them in the browser and with the network panel before sizing P0.
- If an existing environment has already applied migrations `20261023100000/110000`, **do not edit those migration files** (Prisma checksums); rename or regroup categories with a new migration or the admin tools.
- The earlier chat summary said the original tree had 87 subcategories; the correct figure is **77** (so 77 + 187 new = 264).

---

## 15. Phase 0 — implementation log (✅ built · verified as noted)

### 15.1 What was built
| Item | Where | Behaviour |
|---|---|---|
| ✅ **Header tab strip, priority+** | `components/layout/CategoryBar.tsx`, `lib/priorityFit.ts` | From 1024 px up the strip measures every tab (hidden copy) and shows as many as fit **in rank order**; the rest go into a **"More ▾"** menu (2–3 column grid, scrolls inside, "Browse all listings →"). If the current page's tab would be hidden it takes the last visible slot. Below 1024 px it stays a swipeable strip. The `md:justify-center` clipping bug is fixed with auto margins on the first/last item. Escape closes menus |
| ✅ **Live extra tabs** | same | Top-level categories with **no hand-made tab** (Health & Beauty, Food, Building, Energy, …) appear after the hand-made ones (and in "More") **only when counts are known and the category has live listings**. They link to `/listings?category=<slug>` |
| ✅ **Mega menu limits** | same, `lib/megaMenu.ts` | Curated columns capped at 8 links; one extra **"More in X"** column of live subcategories the curated list doesn't link (most populated first, ≤ 8, never empty ones, never for Jobs/CV); footer **"See all in X →"**; panel clamped to the bar width; `max-height` with inner scroll |
| ✅ **Cascading subcategory filter** | `components/listings/FilterSidebar.tsx` | Parent select (buyer-visible parents, with counts) → second **Subcategory** select (live children, most populated first, "All in X") → removable chip. A subcategory in the URL pre-selects its parent; a selected-but-empty category stays visible |
| ✅ **Search dropdown from the API** | `components/layout/HeaderSearch.tsx`, `hooks/useCategoryTree.ts` | The 9 hard-coded options remain only as a fallback until the tree **and** counts load; afterwards the select lists buyer-visible parents in rank order |
| ✅ **Search suggestions never lead to an empty category** | `backend/src/routes/listings.ts`, `utils/suggestCategories.ts` | `/listings/suggest` over-fetches name matches then keeps only categories with live listings (Uganda counts; Jobs/CV trees exempt; fails open if counts can't load) |
| ✅ **Shared rules** | `lib/categoryVisibility.ts` | `isBuyerVisible` (fails open), `isConfirmedLive` (strict, for additive surfaces), default Uganda rank, `buildCategoryOptions` |

### 15.2 Files (all in `pii-phase0-1-changes.zip`, same folder layout as the project)
Frontend: `components/layout/CategoryBar.tsx`, `components/layout/HeaderSearch.tsx`, `components/listings/FilterSidebar.tsx`, `components/ui/HomeCategoryTiles.tsx`, `components/ui/MobileCategoryGrid.tsx`, `components/ui/HeroSideCards.tsx` (comment only), `app/browse/all/page.tsx`, **new:** `lib/categoryVisibility.ts`, `lib/priorityFit.ts`, `lib/megaMenu.ts`, `hooks/useCategoryTree.ts`.
Backend: `src/routes/listings.ts` (suggest endpoint), **new:** `src/utils/suggestCategories.ts` + `.test.ts`.
Tests (separate, because the frontend has no test runner): `frontend-tests/` — see 15.5.

### 15.3 Count-gating audit (buyer surfaces)
| Surface | Before | After |
|---|---|---|
| Header tabs and mega links | Gated (listing-driven categories only) | Same, plus strict gating for the new live extras |
| Home tiles (desktop) and mobile 4×2 grid | **Not gated** | ✅ Gated (Jobs and CV Services exempt; shows everything while counts load) |
| Home "All categories" sidebar (`HeroSideCards.tsx`) | Gated | Unchanged |
| Category pages and subcategory lists (templates) | Gated | Unchanged |
| `/browse/all` category pills | **Not gated** | ✅ Gated (selected pill always kept) |
| `/listings` filter | Parents only, ungated | ✅ Gated parents + gated subcategories |
| Header search select | Hard-coded | ✅ API-driven and gated |
| Search suggestions (server) | **Not gated** | ✅ Gated |
| Local subcategory suggestions in `HeaderSearch.tsx` (`SUBCATEGORY_INDEX`, built from the hand-made mega menus) | Not gated | ⬜ **Still ungated** (it only contains the existing hand-made subcategories; fix with P1/P2 when menus become data-driven) |
| Seller surfaces (post form, bulk post, admin) | Full tree | Unchanged on purpose |

**Behaviour change to be aware of:** home tiles and the mobile grid now hide a category with zero listings (as the header strip already did). On a very young marketplace this can leave only a few tiles.

### 15.4 Verification
| Check | Result |
|---|---|
| Frontend `tsc --noEmit` (full project) | ✅ clean |
| Frontend `next lint` | ✅ no warnings or errors |
| Frontend `next build` (production) | ✅ succeeds |
| 18 logic tests (visibility rules, fitting, split, mega-menu builder) | ✅ pass |
| 9 component tests, `CategoryBar` in jsdom (swipe strip below 1024; fits everything; overflow → N tabs + More; every tab reachable; active tab swapped in; Escape; extras gated, hidden while counts unknown, marked active; "More in X" column and "See all") | ✅ pass |
| 6 component tests, `FilterSidebar` (gating, fail-open, cascade, URL round-trip, chip) | ✅ pass |
| 4 backend tests, suggestion filter | ✅ pass (run in isolation) |
| Backend full `tsc` / existing integration tests / migrations on Postgres | ⬜ **not run** (no database or generated Prisma client in the sandbox) |
| Real-browser pixel check (1024–1920 px), touch and keyboard pass, layout shift on first paint | ⬜ **not done**; jsdom simulates widths (each tab = 120 px), it does not lay out real fonts |

### 15.5 Running the frontend tests
They live in `frontend-tests/` inside the zip (`navtest/*.test.ts(x)` + `vitest.nav.config.mjs`). Copy them into `frontend/`, then:
`npm i -D vitest@2 jsdom @testing-library/react@16 @testing-library/dom @vitejs/plugin-react@4 --legacy-peer-deps` and `npx vitest run --config vitest.nav.config.mjs`.
(The project's current peer-dependency set needs `--legacy-peer-deps`.) Add vitest to the project properly if you want these in CI.

### 15.6 Known limits and decisions
- Tab fitting uses measured widths at runtime; if a web font loads late it re-measures (ResizeObserver). The active-tab swap can occasionally make the row a few pixels tighter; the row clips rather than scrolls.
- Extra "More in X" links and extra tabs go to `/listings?category=<slug>` because dedicated `/<parent>/<sub>` pages only exist for hand-made config. If a curated link uses a different slug from the API for the same subcategory, that subcategory could appear twice (curated + "More in X"); check when you review the menus.
- The ten standalone parents are still **not** in `HOME_CATEGORIES` (home tiles/mobile grid) — that needs the rank/pin settings from P1, by design.
- Counts are Uganda-scoped for suggestions (the endpoint is Uganda-only today); the nav/filter use the visitor's country.

### 15.7 Next: Phase 1
`/categories` index page · mobile "More" tile on the home grid · category picker search + recents + mobile sheet · shared `lib/categorySynonyms.ts` · rank/pin via `SiteConfig`. Start with the index page; the mobile "More" tile and the home tiles depend on it.

---

## 16. Phase 1 — implementation log (✅ built · verified as noted)

### 16.1 What was built
| Item | Where | Behaviour |
|---|---|---|
| ✅ **`/categories` index page** | `app/categories/page.tsx`, `components/categories/CategoriesIndex.tsx`, `categoryIndexModel.ts` | One card per **live** top-level category in admin rank order (default Uganda rank otherwise): icon, name, listing count, up to 6 most-populated live subcategory chips, "See all (+N)". Search box ("boda boda", "salon", "cement") matches names and the shared synonyms. Skeleton while loading, friendly empty and error states. Jobs/CV cards have no chips (not listing-driven). Page metadata and canonical set |
| ✅ **Home tiles** | `lib/homeTiles.ts`, `HomeCategoryTiles.tsx`, `MobileCategoryGrid.tsx` | Hand-made tiles **plus live categories that have no tile** (Food, Building, Energy, …), ordered by admin rank, empty/hidden dropped. **Desktop:** top 12 + an "All categories" tile. **Mobile (4×2):** top 7 + a **"More"** tile → `/categories`. Long names wrap to 2 lines |
| ✅ **Category layout setting** | backend `utils/siteSettings.ts`, `app.ts`; frontend `context/SiteConfigContext.tsx`, `hooks/useCategoryLayout.ts` | `categoryRank` (ordered slugs) and `hiddenCategories` (slugs) stored in the existing `SiteConfig.generalSettings` JSON, validated (kebab-case, de-duplicated, max 60), served by `/api/public/site-config`. **No migration.** Empty by default, which leaves behaviour unchanged |
| ✅ **Admin → Category Layout** | `app/admin/category-layout/page.tsx` (+ nav link) | List of every top-level category with its live count, **Top / ▲ / ▼** buttons, **Hide from buyers** checkbox, **Reset to default**, **Save layout** (disabled until changed). Shows "No listings yet · hidden from buyers automatically" for empty ones |
| ✅ **Layout applied everywhere buyers look** | `CategoryBar.tsx`, `HeaderSearch.tsx`, `FilterSidebar.tsx`, `app/browse/all/page.tsx`, home tiles, `/categories` | Admin order wins when set; hidden categories are removed (a currently selected one is always kept). Hidden categories remain available to sellers and via direct links |
| ✅ **Category picker** | `components/ui/CategoryPicker.tsx`, `categoryPickerModel.ts` | **Search** (names, "Parent › Child", shared synonyms; arrow keys + Enter), **Recent** picks (5, saved in `localStorage`, ignored if storage is unavailable), **phone sheet** (full screen, drill-down parents → children, Back, "All in X", locks page scroll), Escape closes. **Never count-gated** (sellers can post into empty categories) |
| ✅ **Shared synonyms** | `lib/categorySynonyms.ts` | The ~220-term map moved out of bulk-post (which now imports it) + `findSynonymSlugs()` |
| ✅ **Link helper** | `lib/categoryLinks.ts` | Dedicated page for top-level categories that have one, otherwise `/listings?category=<slug>`; subcategories always the latter |
| ✅ **Sitemap fix** | `app/sitemap.ts` | The old sitemap emitted `/browse/<slug>` for every top-level category; **that route has never existed** (404s). It now emits real URLs only for categories with live listings (Jobs/CV exempt), adds `/categories`, de-duplicates against static routes, and emits none if counts can't be fetched |

### 16.2 Files
Everything is in `pii-phase0-1-changes.zip` (cumulative for Phases 0 and 1; apply it after `pii-category-expansion-changes.zip`, it overwrites `bulk-post/page.tsx` with the latest version).
New: `lib/categorySynonyms.ts`, `lib/categoryLinks.ts`, `lib/homeTiles.ts`, `hooks/useCategoryLayout.ts`, `components/categories/*`, `components/ui/categoryPickerModel.ts`, `components/admin/categoryLayoutModel.ts`, `app/categories/page.tsx`, `app/admin/category-layout/page.tsx`, backend `utils/siteSettings.test.ts`.
Changed: `lib/categoryVisibility.ts`, `context/SiteConfigContext.tsx`, `CategoryBar.tsx`, `HeaderSearch.tsx`, `FilterSidebar.tsx`, `HomeCategoryTiles.tsx`, `MobileCategoryGrid.tsx`, `CategoryPicker.tsx`, `app/browse/all/page.tsx`, `app/admin/bulk-post/page.tsx`, `app/admin/layout.tsx`, `app/sitemap.ts`, backend `utils/siteSettings.ts`, `app.ts`.

### 16.3 Behaviour changes to know about
- **Home tile order changes by default.** Tiles now follow the default Uganda rank (Motors, Property, Electronics, Fashion, Jobs, Services, Agriculture, …, Classifieds, Furniture, …) instead of the old hand-made order. Use **Admin → Category Layout** to change it.
- **Mobile grid composition changes:** 7 tiles + "More". With the default rank, Furniture and Classifieds move behind "More" and Agriculture appears. The `mobile` flag in `HOME_CATEGORIES` is no longer used.
- **Desktop row:** at most 12 tiles + "All categories".
- **Sitemap:** the dead `/browse/<slug>` URLs are gone; category URLs appear only once a category has listings.

### 16.4 Deploy notes
1. **Deploy the backend first.** An older backend silently ignores unknown keys on `PUT /admin/settings`, so Category Layout saves would appear to succeed but not persist.
2. No database migration is needed for Phase 1 (settings live in `generalSettings`). The Part A/B category migrations from section 8 are still required for the new categories to exist.
3. Settings reach buyers through `/api/public/site-config` (cached ~60 s, and the site context fetches it with `no-store`), so changes show within about a minute.
4. New UI strings go through `tr()`; they fall back to English until translated.

### 16.5 Verification
| Check | Result |
|---|---|
| Frontend `tsc --noEmit` | ✅ clean |
| Frontend `next lint` | ✅ no warnings or errors |
| Frontend `next build` (production) | ✅ succeeds; `/categories` and `/admin/category-layout` are generated |
| Frontend tests: **76 pass** (logic: visibility, fitting, mega menu, rank/hide, home tiles, index model, picker model, layout model; components: CategoryBar, FilterSidebar, `/categories`, home tiles, picker incl. phone sheet, Admin Category Layout incl. save payload and error; sitemap) | ✅ |
| Mutation check (deliberately broke rank, hide, and synonym search to confirm tests fail) | ✅ caught after adding synonym-only tests |
| Backend tests: **11 pass** (settings normalisation, suggestion filter) | ✅ run in isolation |
| Backend full `tsc` / existing integration tests / migrations on Postgres | ✅ later run for real — see section 19 (the sandbox gained a real PostgreSQL) |
| Real browser, real phone, screen reader | ⬜ not done |

### 16.6 Known limits
- ~~Subcategory chips and links go to `/listings?category=<slug>`~~ — superseded: they now go to `/category/<slug>` (section 17).
- Category Layout controls **top-level** categories only. Subcategory order is by live count.
- Hiding is a buyer-surface setting, not access control: a hidden category's URL still works.
- Recent picks are per browser. The picker is intentionally not gated by counts.
- The local subcategory suggestions inside `HeaderSearch.tsx` (`SUBCATEGORY_INDEX`) are still ungated (see 15.3).
- Saving the layout stores the full order of all current top-level slugs; categories added later follow after them in default order until you reorder.

### 16.7 Next: Phase 2 (structure in the database) — **done, see section 17**
Prisma migration for `Category.sortOrder`, `shortName`, `menuGroup`, `isActive` · generic API-driven category and subcategory page route (replaces one folder per parent and the hard-coded subcategory lists) · admin tools: search/collapse, drag-reorder children, merge and hide · use `shortName` in tiles and menus · retire the `mobile` flag and `SUBCATEGORY_INDEX`. Phase 3 (governance automation) follows.

---

## 17. Phase 2 — structure in the database (✅ built · verified as noted)

### 17.1 What was built
| Item | Where | Behaviour |
|---|---|---|
| ✅ **Display fields** | `schema.prisma`, migration `20261024100000_category_display_fields` | `Category.sortOrder` (default 0), `shortName` (≤ 24 chars), `menuGroup` (≤ 40), `isActive` (default true). Defaults keep today's behaviour: the API is still alphabetical until an admin reorders |
| ✅ **Backfill** | same migration | **101 short names** (every new name that was too long for a tile, e.g. "Farm Services (Ploughing, Spraying, Harvesting)" → "Farm Services") and **122 menu groups** for Services (7 groups, all 30 subcategories), Jobs, Fashion, Electronics, Agriculture and Motors (section 12.5). Only fills blanks, never overwrites an admin's value; safe to re-run |
| ✅ **Public API** | `routes/categories.ts` | `GET /categories` and `/:slug/subcategories` return **active categories only**, ordered by `sortOrder` then name, with the new fields. New `GET /categories/by-slug/:slug` returns a category (parent or subcategory) with its parent (breadcrumb), active children in order and active siblings; 404 for unknown/retired (a retired parent hides its children too) |
| ✅ **Retire** | `routes/listings.ts` | A retired category (or one under a retired parent) is refused for **new** listings with "This category is no longer available". Existing listings keep their category; nothing is deleted |
| ✅ **Admin API** | `routes/admin.ts`, `utils/categoryAdmin.ts` | `PUT/POST /admin/categories` accept and validate the new fields. `GET /admin/categories-structure` (one query, retired included). `PUT /admin/categories-structure` = batch edit, **all-or-nothing**, ≤ 500 rows, audited. `POST /admin/categories/:id/merge {targetId}` moves listings, subcategories and alert rules into the target, then deletes the source, in one transaction, audited |
| ✅ **Generic category page** | `app/category/[slug]/page.tsx`, `components/categories/CategoryPageClient.tsx`, `categoryPageModel.ts` | Breadcrumb, header with live count, subcategory tiles **grouped by menuGroup** (short names, only those with listings), related siblings, latest 24 listings, "Filter & sort" link to `/listings?category=`, empty state with "Post the first one" and "Alert me when one is posted". Server-rendered metadata and canonical; `noindex` while a category has no listings |
| ✅ **Links** | `lib/categoryLinks.ts` | New top-level categories and **all subcategories** now link to `/category/<slug>` (hand-made storefronts keep their own routes); the sitemap uses the same helper |
| ✅ **Admin → Category Structure** | `app/admin/category-structure/page.tsx`, `categoryStructureModel.ts` (+ nav link) | Tree with search and expand/collapse; per row: ▲▼ reorder (renumbers siblings 0, 10, 20…), short name, group (suggestions from siblings), Active switch, **Merge…** (pick target, type the slug to confirm). Save sends only changed fields; invalid values block saving |
| ✅ **Retired old hard-coding** | `lib/homeCategories.ts`, `HeaderSearch.tsx`, `lib/subcategorySuggestions.ts` | The `mobile` flag is gone (rank decides). Header-search subcategory suggestions come from the live tree (only categories with listings, admin-hidden respected, synonyms understood) instead of the hand-made mega-menu index |
| ✅ **Small fixes** | `CategoryBar.tsx` | Active-tab matching uses whole path segments (`/category/pets` no longer lights up on `/category/pets-animals`) |

### 17.2 Behaviour changes to know about
- Links to new categories and every subcategory now go to **`/category/<slug>`**, not `/listings?category=<slug>`.
- Retiring a category hides it from the public tree immediately (within the ~2-minute cache) and blocks new listings in it. Merge is permanent.
- The seller category picker now shows categories in `sortOrder` (still alphabetical by default).

### 17.3 Limits
- Mega-menu "More in X" columns are not grouped by `menuGroup` yet (category pages are).
- The hand-made storefronts (`/services`, `/motors`, …) still use their own static subcategory lists; the generic page is the API-driven alternative.
- Top-level order for **buyers** is still Admin → Category Layout; `sortOrder` orders the API (seller picker, category pages, filters).

## 18. Listing alerts — instant notifications (✅ built · verified as noted)

### 18.1 What a user gets
A user creates an alert on **Profile → Alerts** (`/profile/alerts`; the old "Saved searches" page redirects there, the "Save search" chip is now **Alert me**). Criteria: **category** (any level), **keyword**, **min/max price in UGX**, **location**, **condition**, **only with photos**, **only verified sellers**. Quick starts included: *Land under UGX 5,000,000*, *Smartphones under UGX 250,000*, *Used cars under UGX 30,000,000*, *Rooms for rent under UGX 300,000*, *Laptops under UGX 1,500,000*. The form shows how many live listings match right now.
When someone posts (or approves, or drops the price of) a matching listing, the user gets, immediately:
1. **A notification on their profile** (the alert feed on the Alerts page with unread count) and in the **header bell** (updates instantly),
2. **An e-mail** (verified addresses, if the alert's E-mail box is on),
3. **A pop-up toast and a chime** anywhere on the site while Piitrade is open (if the alert's Sound box and the browser's "Sound on this device" are on), and the tab title flashes if the tab is in the background.
Each alert has its own switches: **Alerts on**, **E-mail**, **Sound**.

### 18.2 How it works
`listing becomes live → DB trigger → queue row (+ NOTIFY) → worker → match → one delivery per user per listing → notification row + e-mail + live push`
- **Trigger** (migration `20261024120000_listing_alerts`): on `Listing`, fires when a row is inserted as `ACTIVE`, becomes `ACTIVE`, or is `ACTIVE` and its **price changes**. It covers **every write path** (seller post, admin approve, bulk post, scripts) with no per-route hooks. It inserts into the durable queue `ListingAlertEvent` (one pending row per listing) and sends `pg_notify`.
- **Worker** (`utils/alertWorker.ts`, started from `index.ts`): wakes on NOTIFY, also polls (30 s; 5 s if LISTEN is unavailable), claims events with `FOR UPDATE SKIP LOCKED` (several server instances share the work, nothing is processed twice, a crashed worker's claim is retried after 2 minutes, up to 5 attempts). A start-up self-test checks that NOTIFY really round-trips (some poolers accept LISTEN but never deliver) and logs which mode it is in.
- **Matching** (`utils/listingAlerts.ts`): candidate alerts are pre-filtered by category in SQL (an alert on *Property* matches a *Land* listing); price, location, condition, photos and verified-seller checks run in memory; a keyword needs one indexed query. **One notification per user per listing** (the alert with the most channels on wins). A seller is never alerted about their own listing; banned users are skipped.
- **Exactly once:** `ListingAlertDelivery` is unique on (listing, user), written in the same transaction as the notification. Racing instances, retries and later price edits can't send a second alert for the same listing to the same user. A price drop that makes a listing newly match **does** alert once.
- **Live push:** `GET /api/alerts/stream` (Server-Sent Events, max 5 tabs per user, re-auth every 30 min, 25 s heartbeat, not compressed). Other server instances relay through a second NOTIFY channel. The browser client (`lib/alertStream.ts`) reads the stream with `fetch` because the API uses Bearer tokens (the browser's EventSource can't send them), reconnects with backoff, and a poll of `GET /api/alerts/recent` backs it up; the page de-duplicates by id.
- **E-mail** (`sendListingAlertEmail`): HTML-escaped, links to the listing and to alert settings; max **20 e-mails per user per day** (beyond that the profile alert and sound still arrive).

### 18.3 Rules worth knowing
- Prices are in **UGX**. A listing quoted in another currency never matches an alert that has a price bound (no exchange rates are applied) but still matches alerts without one.
- An alert needs at least one criterion. Up to **20 alerts per user** (was 10).
- `emailAlert` on `SavedSearch` is the master "alerts on" switch (historical name); new columns `notifyEmail`, `notifySound`, `categorySlug`, `lastAlertAt`.
- "New since you last looked" badges now count since the alert was last **opened** (the old 5-minute sweep that kept resetting it, and its digest notification, are gone).

### 18.4 Files
Backend: `utils/listingAlerts.ts`, `utils/alertWorker.ts`, `utils/alertHub.ts`, `routes/alerts.ts` (`/api/alerts/stream|recent|feed|feed/read|preview`), `routes/savedSearches.ts`, `utils/savedSearches.ts`, `utils/email.ts`, `utils/lifecycleJobs.ts`, `app.ts` (route + stream excluded from compression), `index.ts` (starts the worker); migrations `20261024110000` (enum value `LISTING_ALERT`) and `20261024120000`.
Frontend: `components/alerts/AlertListener.tsx` (mounted in the root layout), `app/profile/alerts/page.tsx`, `lib/alerts.ts`, `lib/alertStream.ts`, `lib/alertSound.ts`, header bell + notifications page + account menu + profile tile updates.

### 18.5 Deploy checklist
1. Run the migrations (the app role must be allowed to create triggers/functions; the enum migration must be its own step, as shipped).
2. **Use a direct database connection** (`DATABASE_PRIVATE_URL`/`DATABASE_URL` that supports LISTEN). Behind a transaction-mode pooler alerts still work via 5-second polling and the log says so.
3. Make sure the **e-mail provider** is configured (otherwise alerts still appear on the profile and with sound).
4. **Reverse proxy:** the stream sends `X-Accel-Buffering: no`; check that your proxy/CDN does not buffer `text/event-stream` and allows 30-minute connections. If it does, the 12-second poll still delivers (slower).
5. Existing alert-on saved searches **will now send e-mail** (they had only ever produced an in-app digest). To keep them in-app only: `UPDATE "SavedSearch" SET "notifyEmail" = false WHERE "createdAt" < now();` before or right after deploy.
6. Watch the log line `Alert listener connected (instant alerts on)` after each start.

### 18.6 Verification
| Check | Result |
|---|---|
| Backend `tsc --noEmit` | ✅ clean |
| Backend unit tests | ✅ 217 pass (matching rules incl. the 5,000,000 / 250,000 examples and boundaries; e-mail escaping and header-injection) |
| Backend integration tests on **real PostgreSQL** | ✅ 142 pass, of which 17 are alerts: trigger rules, land/smartphone scenarios, exactly-once, price-drop-into-range, switches/eligibility, keyword/location/condition/photos/currency, one alert per user, daily cap, exclusive claiming and stale-claim retry, purge, feed/read/recent/preview and isolation, alert settings API and 20-alert cap, **live SSE stream received by the right user only**, per-user stream cap, **LISTEN wake-up with no manual drain (< 3 s)**, cross-instance relay |
| Mutation checks (broke the seller exclusion, the claim lock, the price boundary on purpose) | ✅ all caught |
| **End-to-end with a separate real server process** (`index.ts`) and the **real frontend stream client**: insert a listing into the database | ✅ received by the connected client in **≈ 61 ms** locally; a non-matching listing produced nothing; feed, poll and delivery rows agree; queue fully drained |
| Frontend: type-check, lint, production build, **126 tests** (stream parser incl. split chunks/401/backoff, sound, listener toasts/dedupe/sound flags/title flash, Alerts page flows, category page, admin structure incl. merge) | ✅ |
| Real browser / phone, real e-mail delivery, behind your real proxy | ⬜ not done |

Two real defects were found by these tests and fixed: (1) a listing title was placed **unescaped** in the e-mail preheader (HTML injection into other users' e-mails); (2) "Mark all read" dispatched the alert event without a payload and crashed the Alerts page's own listener. Links in alert data are also now restricted to same-site paths on the server and the client.

### 18.7 Known limits
- **Sound plays only while Piitrade is open** in a browser (browsers allow audio only after the visitor has clicked/tapped once on the site; before that the toast shows with a hint). When the site is closed, the e-mail is the channel.
- Alerts cover **listings**; job posts (a separate model) are not covered yet.
- Every instance wakes on a notification but only one claims each event; the claim is exclusive, so work is not duplicated.
- A single alert fires once per listing per user, ever (by design: no repeat alerts for later edits).

### 18.8 Next ideas
Browser push notifications (alert when the site is closed), WhatsApp/SMS delivery (high reach in Uganda), a daily digest mode, job-post alerts, price-drop alerts on favourites.

## 19. Real-database verification of the earlier category work (new)
The sandbox now has a real PostgreSQL 16, so migrations were applied for real (all 48 original migrations, then the new ones, in order, with `psql`).
- **Finding:** on a database built from migrations alone, the main parents (Motors, Property, Jobs, …) do **not** exist — only the seed/auto-seed creates them. Part A (`20261023100000`) therefore inserts nothing there, by design (it only adds to parents that exist). On a production-like database (12 parents + 77 subcategories seeded first) the migrations produce **exactly 22 parents and 264 subcategories**, all 30 Services subcategories get a group, and re-running every migration changes nothing.
- Backend baseline before the Phase 2 and alerts work: type-check clean, 208 unit + 116 integration tests passing; after: **217 unit + 142 integration**.
- Not verifiable here: `prisma migrate deploy`/`migrate diff` (the Prisma schema engine can't be downloaded in the sandbox). The migration files are plain SQL; the partial unique index on `ListingAlertEvent` can't be expressed in `schema.prisma`, so check on staging that `prisma migrate dev`/`diff` does not try to drop it.

## 20. Applying everything (final order)
One cumulative bundle replaces the earlier zips: **`pii-all-changes.zip`** = the 83 project files that differ from your original upload (36 modified, 47 new; same folder layout) plus `tests/` (frontend tests, end-to-end test and a README). Unzip over the project, run the migrations in order (`20261023100000` … `20261024120000`), deploy the backend first, then the frontend.

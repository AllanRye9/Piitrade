/**
 * Order-quantity rules for agriculture produce (Alibaba-style wholesale
 * selling): a minimum order quantity (MOQ) and volume price tiers.
 *
 *   MOQ 50, base price UGX 3,000 / kg, tiers [{100 → 2,800}, {500 → 2,500}]
 *   → 50–99 kg at 3,000 · 100–499 kg at 2,800 · 500+ kg at 2,500
 *
 * Quantities are in the listing's own unit (its `priceUnit`: items, kg or
 * tonnes). Everything here is pure so the cart, order and listing routes
 * (and the tests) share one definition of the rules.
 */

export interface PriceTier {
  minQty: number;
  price: number;
}

export const MAX_PRICE_TIERS = 5;

export type QuantityRulesResult =
  | { ok: true; minOrderQuantity: number | null; priceTiers: PriceTier[] | null }
  | { ok: false; message: string };

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Read tiers back from the JSON column defensively (never throws, always sorted). */
export function parsePriceTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t !== null && typeof t === 'object')
    .map((t) => t as { minQty?: unknown; price?: unknown })
    .filter((t) => isWhole(t.minQty) && t.minQty >= 2 && typeof t.price === 'number' && Number.isFinite(t.price) && t.price >= 0)
    .map((t) => ({ minQty: t.minQty as number, price: t.price as number }))
    .sort((a, b) => a.minQty - b.minQty);
}

/** The per-unit price that applies to an order of `qty` units. */
export function unitPriceForQuantity(basePrice: number, tiers: PriceTier[], qty: number): number {
  let price = basePrice;
  for (const tier of tiers) {
    if (qty >= tier.minQty) price = tier.price;
  }
  return price;
}

/** Validate seller-supplied MOQ / tiers. Empty input means "no rule". */
export function sanitizeQuantityRules(
  input: { minOrderQuantity?: unknown; priceTiers?: unknown },
  ctx: { basePrice: number; stock: number },
): QuantityRulesResult {
  let minOrderQuantity: number | null = null;
  const rawMoq = input.minOrderQuantity;
  if (rawMoq !== undefined && rawMoq !== null && rawMoq !== '') {
    const moq = typeof rawMoq === 'string' ? Number(rawMoq.trim()) : rawMoq;
    if (!isWhole(moq) || moq < 1) {
      return { ok: false, message: 'Minimum order quantity must be a whole number of 1 or more' };
    }
    if (ctx.stock > 0 && moq > ctx.stock) {
      return { ok: false, message: 'Minimum order quantity cannot be more than the quantity available' };
    }
    minOrderQuantity = moq > 1 ? moq : null;
  }

  const rawTiers = input.priceTiers;
  if (rawTiers === undefined || rawTiers === null || (Array.isArray(rawTiers) && rawTiers.length === 0)) {
    return { ok: true, minOrderQuantity, priceTiers: null };
  }
  if (!Array.isArray(rawTiers)) return { ok: false, message: 'priceTiers must be a list' };
  if (rawTiers.length > MAX_PRICE_TIERS) {
    return { ok: false, message: `You can add at most ${MAX_PRICE_TIERS} volume price tiers` };
  }

  const tiers: PriceTier[] = [];
  for (const t of rawTiers as { minQty?: unknown; price?: unknown }[]) {
    const minQty = typeof t?.minQty === 'string' ? Number((t.minQty as string).trim()) : t?.minQty;
    const price = typeof t?.price === 'string' ? Number((t.price as string).trim()) : t?.price;
    if (!isWhole(minQty) || minQty < 2) {
      return { ok: false, message: 'Each price tier needs a whole-number quantity of 2 or more' };
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return { ok: false, message: 'Each price tier needs a valid price' };
    }
    tiers.push({ minQty, price });
  }
  tiers.sort((a, b) => a.minQty - b.minQty);

  const floorQty = minOrderQuantity ?? 1;
  let previousPrice = ctx.basePrice;
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (i > 0 && tier.minQty === tiers[i - 1].minQty) {
      return { ok: false, message: 'Two price tiers cannot start at the same quantity' };
    }
    if (tier.minQty <= floorQty) {
      return { ok: false, message: 'Each price tier must start above the minimum order quantity' };
    }
    if (ctx.stock > 0 && tier.minQty > ctx.stock) {
      return { ok: false, message: 'A price tier cannot start above the quantity available' };
    }
    if (tier.price >= previousPrice) {
      return { ok: false, message: 'Bigger orders must be cheaper: each tier price must be lower than the one before it' };
    }
    previousPrice = tier.price;
  }
  return { ok: true, minOrderQuantity, priceTiers: tiers };
}

/** A human-readable problem with ordering `qty` of a listing, or null if fine. */
export function quantityProblem(
  listing: { title: string; minOrderQuantity?: number | null },
  qty: number,
): string | null {
  if (!Number.isFinite(qty) || qty < 1) return 'Quantity must be at least 1';
  const moq = listing.minOrderQuantity ?? 0;
  if (moq > 1 && qty < moq) {
    return `The minimum order for "${listing.title}" is ${moq}`;
  }
  return null;
}

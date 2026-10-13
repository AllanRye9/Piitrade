"use strict";
// Marketplace search engine helpers: query parsing, precise multi-field
// matching, relevance scoring, vocabulary-based typo correction.
//
// Query syntax (all optional):
//   iphone 14 pro        every word must match somewhere (title, category,
//                        location, tags, description) — order independent
//   "toyota harrier"     exact phrase
//   laptop -hp           exclude anything mentioning "hp"
//   phone under 500k     price limits: under/below/max N, over/above/min N,
//   tv between 1m and 2m   between A and B  (N accepts 500k, 1.5m, 1,200,000)
// Plurals and a few common synonyms (phone/mobile, car/vehicle…) are matched
// automatically, and a misspelt word is corrected against real listing words.
Object.defineProperty(exports, "__esModule", { value: true });
exports.singularize = singularize;
exports.parseSearchQuery = parseSearchQuery;
exports.hasSearchTerms = hasSearchTerms;
exports.buildSearchWhere = buildSearchWhere;
exports.scoreListing = scoreListing;
exports.getVocabulary = getVocabulary;
exports.levenshtein = levenshtein;
exports.correctQuery = correctQuery;
exports.completeWord = completeWord;
const prisma_1 = require("./prisma");
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'for', 'in', 'on', 'at', 'of', 'to', 'and', 'or', 'with', 'by', 'from', 'near', 'sale', 'sell', 'selling', 'buy',
]);
const SYNONYMS = {
    phone: ['mobile', 'smartphone', 'cellphone'],
    mobile: ['phone', 'smartphone'],
    smartphone: ['phone', 'mobile'],
    car: ['vehicle', 'automobile'],
    vehicle: ['car'],
    tv: ['television'],
    television: ['tv'],
    laptop: ['notebook', 'macbook'],
    notebook: ['laptop'],
    house: ['home'],
    home: ['house'],
    apartment: ['flat'],
    flat: ['apartment'],
    sofa: ['couch'],
    couch: ['sofa'],
    fridge: ['refrigerator'],
    refrigerator: ['fridge'],
    bike: ['bicycle', 'motorcycle'],
    motorbike: ['motorcycle', 'boda'],
    job: ['vacancy', 'employment'],
    vacancy: ['job'],
    shoes: ['sneakers', 'shoe'],
    dress: ['gown'],
};
function parseAmount(num, unit) {
    const n = parseFloat(num.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0)
        return null;
    const u = (unit || '').toLowerCase();
    const mult = u === 'k' || u === 'thousand' ? 1000 : u === 'm' || u === 'million' ? 1000000 : 1;
    return Math.round(n * mult);
}
const AMT = '(?:ugx|ush|shs?)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|m|thousand|million)?(?![a-z0-9])';
function singularize(w) {
    if (w.length > 4 && w.endsWith('ies'))
        return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(ches|shes|xes|ses)$/.test(w))
        return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss'))
        return w.slice(0, -1);
    return w;
}
function parseSearchQuery(raw) {
    let rest = (raw || '').slice(0, 200);
    const phrases = [];
    rest = rest.replace(/"([^"]{2,80})"/g, (_m, p) => {
        phrases.push(p.trim().toLowerCase());
        return ' ';
    });
    // Price phrases are lifted out of the text so they constrain price instead
    // of being matched as words.
    let priceMin;
    let priceMax;
    rest = rest.toLowerCase();
    rest = rest.replace(new RegExp(`\\bbetween\\s*${AMT}\\s*(?:and|to|-)\\s*${AMT}`, 'g'), (_m, a, au, b, bu) => {
        // "1 and 2m" → unit on the second number applies to both when the first has none
        const lo = parseAmount(a, au || bu);
        const hi = parseAmount(b, bu);
        if (lo && hi) {
            priceMin = Math.min(lo, hi);
            priceMax = Math.max(lo, hi);
        }
        return ' ';
    });
    rest = rest.replace(new RegExp(`\\b(?:under|below|less than|cheaper than|up to|max(?:imum)?)\\s*${AMT}`, 'g'), (_m, n, u) => {
        const v = parseAmount(n, u);
        if (v)
            priceMax = v;
        return ' ';
    });
    rest = rest.replace(new RegExp(`\\b(?:over|above|more than|at least|min(?:imum)?|from)\\s*${AMT}`, 'g'), (_m, n, u) => {
        const v = parseAmount(n, u);
        if (v)
            priceMin = v;
        return ' ';
    });
    const exclude = [];
    const tokens = [];
    for (const piece of rest.split(/\s+/)) {
        if (!piece)
            continue;
        if (piece.startsWith('-') && piece.length > 2) {
            const w = piece.slice(1).replace(/[^a-z0-9]/g, '');
            if (w)
                exclude.push(w);
            continue;
        }
        // keep letters/digits; split things like "i-phone" or "4k/uhd"
        for (const w of piece.split(/[^a-z0-9]+/)) {
            if (!w)
                continue;
            if (STOP_WORDS.has(w) || w === 'ugx' || w === 'ush')
                continue;
            if (w.length < 2 && !/\d/.test(w))
                continue;
            if (!tokens.includes(w))
                tokens.push(w);
        }
    }
    const capped = tokens.slice(0, 8);
    const variants = new Map();
    for (const t of capped) {
        const set = new Set([t]);
        const s = singularize(t);
        set.add(s);
        if (!/\d/.test(t) && t.length > 2 && !t.endsWith('s'))
            set.add(t + 's');
        for (const base of [t, s])
            (SYNONYMS[base] || []).forEach((x) => set.add(x));
        variants.set(t, [...set]);
    }
    return { raw, phrases: phrases.slice(0, 3), tokens: capped, exclude: exclude.slice(0, 5), variants, priceMin, priceMax };
}
function hasSearchTerms(p) {
    return p.tokens.length > 0 || p.phrases.length > 0 || p.priceMin !== undefined || p.priceMax !== undefined;
}
const contains = (v) => ({ contains: v, mode: 'insensitive' });
/** Prisma filter implementing the parsed query (AND across words, OR across fields). */
function buildSearchWhere(p) {
    const and = [];
    for (const t of p.tokens) {
        const vs = p.variants.get(t) || [t];
        const or = [];
        for (const v of vs) {
            or.push({ title: contains(v) }, { description: contains(v) }, { location: contains(v) }, { category: { name: contains(v) } }, { category: { parent: { name: contains(v) } } }, { user: { store: { name: contains(v) } } }, { motorDetails: { path: ['make'], string_contains: v } }, { motorDetails: { path: ['model'], string_contains: v } }, { propertyDetails: { path: ['propertyType'], string_contains: v } });
        }
        or.push({ tags: { hasSome: vs } });
        // SKU / model numbers typed exactly
        if (/\d/.test(t))
            or.push({ sku: contains(t) });
        and.push({ OR: or });
    }
    for (const ph of p.phrases) {
        and.push({ OR: [{ title: contains(ph) }, { description: contains(ph) }] });
    }
    if (p.priceMin !== undefined || p.priceMax !== undefined) {
        and.push({ price: { ...(p.priceMin !== undefined && { gte: p.priceMin }), ...(p.priceMax !== undefined && { lte: p.priceMax }) } });
    }
    for (const x of p.exclude) {
        and.push({ NOT: { OR: [{ title: contains(x) }, { description: contains(x) }, { category: { name: contains(x) } }] } });
    }
    return and.length ? { AND: and } : {};
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Deterministic relevance score — higher is better. */
function scoreListing(l, p) {
    const title = (l.title || '').toLowerCase();
    const desc = (l.description || '').toLowerCase();
    const loc = (l.location || '').toLowerCase();
    const cat = `${l.category?.name || ''} ${l.category?.parent?.name || ''}`.toLowerCase();
    const tags = (l.tags || []).map((t) => t.toLowerCase());
    const phraseAll = p.tokens.join(' ');
    let score = 0;
    if (phraseAll) {
        if (title === phraseAll)
            score += 100;
        else if (title.startsWith(phraseAll))
            score += 55;
        else if (title.includes(phraseAll))
            score += 40;
    }
    for (const ph of p.phrases) {
        if (title.includes(ph))
            score += 45;
        else if (desc.includes(ph))
            score += 15;
    }
    let titleHits = 0;
    for (const t of p.tokens) {
        const vs = p.variants.get(t) || [t];
        let best = 0;
        let inTitle = false;
        for (const v of vs) {
            const isExact = v === t || v === singularize(t);
            const w = isExact ? 1 : 0.7; // synonyms count a bit less than the typed word
            const wordRe = new RegExp(`\\b${escapeRe(v)}`);
            const wholeRe = new RegExp(`\\b${escapeRe(v)}\\b`);
            let s = 0;
            if (wholeRe.test(title))
                s = 22;
            else if (wordRe.test(title))
                s = 16;
            else if (title.includes(v))
                s = 9;
            if (tags.includes(v))
                s = Math.max(s, 12);
            if (cat.includes(v))
                s = Math.max(s, 10);
            if (wholeRe.test(loc))
                s = Math.max(s, 6);
            if (desc.includes(v))
                s = Math.max(s, 4);
            best = Math.max(best, s * w);
            if (title.includes(v))
                inTitle = true;
        }
        if (inTitle)
            titleHits += 1;
        score += best;
    }
    if (p.tokens.length > 1 && titleHits >= p.tokens.length)
        score += 25; // every word in the title
    // word order bonus: tokens appear in the title in the typed order
    if (p.tokens.length > 1) {
        let pos = -1;
        let ordered = true;
        for (const t of p.tokens) {
            const i = title.indexOf(t, pos + 1);
            if (i === -1) {
                ordered = false;
                break;
            }
            pos = i;
        }
        if (ordered)
            score += 8;
    }
    if (l.tier === 'PLATINUM')
        score += 6;
    else if (l.tier === 'GOLD')
        score += 3;
    if (l.user?.isKycVerified)
        score += 1;
    score += Math.min(4, (l.views || 0) / 250);
    // gentle freshness: up to +3 for listings < 30 days old
    const ageDays = (Date.now() - new Date(l.createdAt).getTime()) / 86400000;
    if (ageDays < 30)
        score += 3 * (1 - ageDays / 30);
    return score;
}
// ─── Vocabulary-based typo correction ─────────────────────────────────────
let vocab = null;
let vocabExpiry = 0;
async function getVocabulary() {
    if (vocab && Date.now() < vocabExpiry)
        return vocab;
    const now = new Date();
    const [rows, cats] = await Promise.all([
        prisma_1.prisma.listing.findMany({
            where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            select: { title: true, tags: true },
            orderBy: { createdAt: 'desc' },
            take: 4000,
        }),
        prisma_1.prisma.category.findMany({ select: { name: true } }),
    ]);
    const m = new Map();
    const add = (s) => {
        for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) {
            if (w.length < 3 || STOP_WORDS.has(w))
                continue;
            m.set(w, (m.get(w) || 0) + 1);
        }
    };
    for (const r of rows) {
        add(r.title);
        (r.tags || []).forEach(add);
    }
    for (const c of cats)
        add(c.name);
    for (const k of Object.keys(SYNONYMS))
        if (!m.has(k))
            m.set(k, 1);
    vocab = m;
    vocabExpiry = Date.now() + 10 * 60 * 1000;
    return m;
}
function levenshtein(a, b, max) {
    if (Math.abs(a.length - b.length) > max)
        return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            cur.push(v);
            if (v < rowMin)
                rowMin = v;
        }
        if (rowMin > max)
            return max + 1;
        prev = cur;
    }
    return prev[b.length];
}
/** Returns a corrected query string if any word looks misspelt, else null. */
async function correctQuery(p) {
    if (p.tokens.length === 0)
        return null;
    const words = await getVocabulary();
    let changed = false;
    const out = p.tokens.map((t) => {
        if (/\d/.test(t) || t.length < 4)
            return t;
        if (words.has(t) || words.has(singularize(t)))
            return t;
        const max = t.length <= 5 ? 1 : 2;
        let best = null;
        let bestD = max + 1;
        let bestFreq = 0;
        for (const [w, f] of words) {
            if (w[0] !== t[0] && w[1] !== t[1])
                continue; // cheap prefilter
            const d = levenshtein(t, w, max);
            if (d < bestD || (d === bestD && f > bestFreq)) {
                best = w;
                bestD = d;
                bestFreq = f;
            }
        }
        if (best && bestD <= max) {
            changed = true;
            return best;
        }
        return t;
    });
    return changed ? out.join(' ') : null;
}
/** Vocabulary words starting with `prefix`, most common first (type-ahead). */
async function completeWord(prefix, limit = 4) {
    if (prefix.length < 2)
        return [];
    const words = await getVocabulary();
    const hits = [];
    for (const [w, f] of words)
        if (w.startsWith(prefix) && w !== prefix)
            hits.push([w, f]);
    return hits.sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}
//# sourceMappingURL=search.js.map
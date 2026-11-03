/**
 * cvPdf — builds real, vector A4 PDF files for the CV and Cover Letter builders.
 *
 * Why this exists: the builders used to open a browser print dialog (CV) or save
 * an .html file (cover letter). Both are replaced by genuine PDF generation —
 * the output is always a `.pdf` file with selectable text, never an HTML page.
 *
 * jsPDF is loaded with a dynamic import so it is only fetched when the person
 * actually downloads, and never runs during server-side rendering.
 *
 * Only call these functions AFTER the server has validated the payment token.
 */
import type { jsPDF as JsPDF } from 'jspdf';

// ── Public types (structurally compatible with the builder pages' own types) ──
export interface CvPdfTheme {
  accent: string;
  headerBg: string;      // hex, or 'transparent'
  headerText: string;
  subText: string;
  sectionLine: string;
  font: string;          // CSS font-family string
}
export interface CvPdfData {
  name: string; title: string; email: string; phone: string;
  location: string; website: string; linkedin: string;
  profilePicture: string;
  summary: string;
  work: { id: string; company: string; role: string; period: string; location: string; description: string }[];
  education: { id: string; institution: string; degree: string; fieldOfStudy: string; year: string; grade?: string }[];
  certifications: { id: string; name: string; issuer: string; year: string; credentialId?: string }[];
  skills: { id: string; name: string; level: string }[];
  languages: { id: string; language: string; proficiency: string }[];
  references: { id: string; name: string; title: string; company: string; email: string; phone: string }[];
}
export interface CoverLetterPdfData {
  name: string; email: string; phone: string; location: string;
  hiringManager: string; company: string; role: string;
  opening: string; body: string; closing: string;
}

// ── Constants ────────────────────────────────────────────────────────────────
const W = 210;
const H = 297;
const DARK = '#1f2937';
const MUTED = '#6b7280';
const WHITE = '#ffffff';

type Doc = JsPDF;

// ── Colour helpers ───────────────────────────────────────────────────────────
function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Mix a colour toward white. t=0 → colour, t=1 → white. */
function tint(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  const m = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}
const fill = (d: Doc, hex: string) => { const [r, g, b] = rgb(hex); d.setFillColor(r, g, b); };
const stroke = (d: Doc, hex: string) => { const [r, g, b] = rgb(hex); d.setDrawColor(r, g, b); };
const ink = (d: Doc, hex: string) => { CUR_COLOR = hex; const [r, g, b] = rgb(hex); d.setTextColor(r, g, b); };

function opacity(d: Doc, a: number) {
  d.setGState(new (d as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: a }) as never);
}

// ── Unicode support ──────────────────────────────────────────────────────────
// The built-in PDF fonts only cover Latin-1. When a document contains anything
// beyond that (Cyrillic, Greek, Vietnamese, Chinese, kana ...) we lazily load
// an embedded Noto font from /fonts/pdf/ and use it for the whole document, so
// the typography stays consistent. Documents that are plain Latin never load
// a font and stay tiny.
//   NotoSans   : Latin, Latin Extended, Vietnamese, Greek, Cyrillic  (~160 KB per style)
//   NotoSansSC : all of the above + Simplified/Traditional Chinese + kana (~3 MB per style)
// Right-to-left / shaped scripts (Arabic, Hebrew, Indic, Thai) and emoji are not
// covered and are dropped rather than printed as empty boxes.
const FONT_BASE = '/fonts/pdf/';
const UNI_ALLOWED_CLASS =
  '\\n\\u0020-\\u007E\\u00A0-\\u024F\\u0370-\\u03FF\\u0400-\\u052F\\u1E00-\\u1EFF' +
  '\\u2010-\\u2027\\u2030-\\u205E\\u20A0-\\u20BF\\u2100-\\u214F\\u2190-\\u21FF\\u2212\\u2460-\\u24FF' +
  '\\u3000-\\u30FF\\u4E00-\\u9FFF\\uFF00-\\uFFEF';
const UNI_STRIP = new RegExp(`[^${UNI_ALLOWED_CLASS}]`, 'g');
const NON_WINANSI = /[^\n\x20-\x7E\xA0-\xFF\u2018\u2019\u201A\u201C\u201D\u201E\u2013\u2014\u2212\u2026\u2022]/;
const CJK_RE = /[\u3000-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF]/;

let UNI: { family: string; italic: boolean } | null = null;
const fontCache = new Map<string, string>();

const fontBufCache = new Map<string, ArrayBuffer>();
async function fetchFontBuf(file: string): Promise<ArrayBuffer> {
  const hit = fontBufCache.get(file);
  if (hit) return hit;
  const base = (globalThis as { __PDF_FONT_BASE__?: string }).__PDF_FONT_BASE__ ?? FONT_BASE;
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`font ${file}: ${res.status}`);
  const buf = await res.arrayBuffer();
  fontBufCache.set(file, buf);
  return buf;
}
async function fetchFontB64(file: string): Promise<string> {
  const hit = fontCache.get(file);
  if (hit) return hit;
  const bytes = new Uint8Array(await fetchFontBuf(file));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  const b64 = btoa(bin);
  fontCache.set(file, b64);
  return b64;
}

/** Decide whether this document needs an embedded font and register it. Never throws. */
async function initUnicode(doc: Doc, rawText: string) {
  UNI = null;
  const kept = rawText.replace(UNI_STRIP, '');
  if (!NON_WINANSI.test(kept)) return;
  const cjk = CJK_RE.test(kept);
  const family = cjk ? 'NotoSansSC' : 'NotoSans';
  const styles: [string, 'normal' | 'bold' | 'italic'][] = cjk
    ? [['Regular', 'normal'], ['Bold', 'bold']]
    : [['Regular', 'normal'], ['Bold', 'bold'], ['Italic', 'italic']];
  try {
    for (const [file, style] of styles) {
      const name = `${family}-${file}.ttf`;
      doc.addFileToVFS(name, await fetchFontB64(name));
      doc.addFont(name, family, style, undefined, 'Identity-H');
    }
    UNI = { family, italic: !cjk };
  } catch (e) {
    console.warn('[cvPdf] Unicode font unavailable, falling back to Latin-only output', e);
    UNI = null;
  }
}

/** setFont that transparently swaps in the embedded family when Unicode mode is active. */
function setF(d: Doc, fam: string, style: string) {
  CUR_STYLE = style === 'bold' || style === 'bolditalic' ? 'bold' : style === 'italic' ? 'italic' : 'normal';
  if (UNI) {
    const st = style === 'bolditalic' ? 'bold' : style === 'italic' && !UNI.italic ? 'normal' : style;
    d.setFont(UNI.family, st);
  } else {
    d.setFont(fam, style);
  }
}

// ── Complex scripts: Arabic, Hebrew, Devanagari (Hindi), Thai ──────────────────
// jsPDF cannot shape or reorder text, so runs containing these scripts are drawn
// with the browser's own text engine (canvas: bidi, joining, vowel marks) at 300 dpi
// and placed in the PDF as transparent images. Everything else stays real,
// selectable PDF text. Fonts load from /fonts/pdf/ only when such text is present.
const HEB = '\\u0590-\\u05FF\\uFB1D-\\uFB4F';
const ARA = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const DEV = '\\u0900-\\u097F';
const THA = '\\u0E00-\\u0E7F';
const CX_CLASS = `${HEB}${ARA}${DEV}${THA}\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069`;
const COMPLEX_RE = new RegExp(`[${HEB}${ARA}${DEV}${THA}]`);
const RTL_CHAR = new RegExp(`[${HEB}${ARA}]`);
const STRONG_CHAR = new RegExp(`[A-Za-z\\u00C0-\\u024F\\u0370-\\u052F\\u3040-\\u9FFF${HEB}${ARA}${DEV}${THA}]`);
const THAI_RE = /[\u0E00-\u0E7F]/;
const COMBINING_RE = /[\u0300-\u036F\u0591-\u05C7\u064B-\u065F\u0670\u0900-\u0903\u093A-\u094F\u0951-\u0957\u0962\u0963\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u200C\u200D]/;
const PX_PER_MM = 300 / 25.4;
const PX_PER_PT = 300 / 72;

let CUR_COLOR = '#000000';
let CUR_STYLE: 'normal' | 'bold' | 'italic' = 'normal';

interface CxCtx {
  font: string; fillStyle: string; textBaseline: string; textAlign: string; direction: string;
  measureText(t: string): { width: number; fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number };
  fillText(t: string, x: number, y: number): void;
}
interface CxCanvas { width: number; height: number; getContext(k: '2d'): CxCtx; toDataURL(t?: string): string }
interface CxEngine {
  createCanvas(w: number, h: number): CxCanvas;
  registerFont(family: string, style: 'normal' | 'bold' | 'italic', data: ArrayBuffer): Promise<void>;
}
interface CxState { eng: CxEngine; families: string[]; mctx: CxCtx }
let CX: CxState | null = null;
const cxRegistered = new Set<string>();

function browserEngine(): CxEngine | null {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return null;
  return {
    createCanvas: (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c as unknown as CxCanvas;
    },
    registerFont: async (family, style, data) => {
      const ff = new FontFace(family, data, { style: style === 'italic' ? 'italic' : 'normal', weight: style === 'bold' ? '700' : '400' });
      await ff.load();
      document.fonts.add(ff);
    },
  };
}

const CX_SCRIPTS: { name: string; re: RegExp; family: string; file: string }[] = [
  { name: 'arabic',     re: new RegExp(`[${ARA}]`), family: 'PdfArabic', file: 'NotoSansArabic' },
  { name: 'hebrew',     re: new RegExp(`[${HEB}]`), family: 'PdfHebrew', file: 'NotoSansHebrew' },
  { name: 'devanagari', re: new RegExp(`[${DEV}]`), family: 'PdfDeva',   file: 'NotoSansDevanagari' },
  { name: 'thai',       re: new RegExp(`[${THA}]`), family: 'PdfThai',   file: 'NotoSansThai' },
];

async function initComplex(raw: string) {
  CX = null;
  if (!COMPLEX_RE.test(raw)) return;
  const eng = (globalThis as { __PDF_CX__?: CxEngine }).__PDF_CX__ ?? browserEngine();
  if (!eng) return; // no canvas available (SSR) -> complex text is dropped by clean()
  try {
    const reg = async (family: string, style: 'normal' | 'bold' | 'italic', file: string) => {
      const key = `${family}/${style}`;
      if (cxRegistered.has(key)) return;
      await eng.registerFont(family, style, await fetchFontBuf(file));
      cxRegistered.add(key);
    };
    const families = ['PdfLatin'];
    await reg('PdfLatin', 'normal', 'NotoSans-Regular.ttf');
    await reg('PdfLatin', 'bold', 'NotoSans-Bold.ttf');
    await reg('PdfLatin', 'italic', 'NotoSans-Italic.ttf');
    for (const sc of CX_SCRIPTS) {
      if (!sc.re.test(raw)) continue;
      await reg(sc.family, 'normal', `${sc.file}-Regular.ttf`);
      await reg(sc.family, 'bold', `${sc.file}-Bold.ttf`);
      families.push(sc.family);
    }
    CX = { eng, families, mctx: eng.createCanvas(8, 8).getContext('2d') };
  } catch (e) {
    console.warn('[cvPdf] Complex-script fonts unavailable, those characters will be omitted', e);
    CX = null;
  }
}

function cxFont(px: number, style: 'normal' | 'bold' | 'italic'): string {
  // Slanted Arabic/Hebrew/Indic/Thai is typographically wrong, so italics are never applied here.
  if (style === 'italic') style = 'normal';
  const fams = CX!.families.map(f => `"${f}"`).join(', ');
  return `${style === 'bold' ? '700' : '400'} ${px}px ${fams}, sans-serif`;
}

/** True when the first strongly-directional letter is Hebrew/Arabic. */
function isRTL(text: string): boolean {
  const m = text.match(STRONG_CHAR);
  return !!m && RTL_CHAR.test(m[0]);
}

function wordSegmenter(): { segment(s: string): Iterable<{ segment: string }> } | null {
  const S = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return S ? new S('th', { granularity: 'word' }) : null;
}

interface PutOpts { align?: 'left' | 'right' | 'center'; charSpace?: number; rtlRight?: number }

/** Text width in mm for the document's current font/size (canvas-measured for complex scripts). */
function tw(d: Doc, text: string): number {
  if (CX && COMPLEX_RE.test(text)) {
    CX.mctx.font = cxFont(d.getFontSize() * PX_PER_PT, CUR_STYLE);
    return CX.mctx.measureText(text).width / PX_PER_MM;
  }
  return d.getTextWidth(text);
}

/** Drop-in replacement for doc.text(): complex-script runs become images, the rest stays real text. */
function put(d: Doc, text: string, x: number, y: number, opts?: PutOpts) {
  if (!CX || !COMPLEX_RE.test(text)) {
    const { rtlRight, ...rest } = opts ?? {};
    void rtlRight;
    d.text(text, x, y, rest);
    return;
  }
  const rtl = isRTL(text);
  const px = d.getFontSize() * PX_PER_PT;
  const m = CX.mctx;
  m.font = cxFont(px, CUR_STYLE);
  const met = m.measureText(text);
  const asc = met.fontBoundingBoxAscent ?? px * 0.95;
  const desc = met.fontBoundingBoxDescent ?? px * 0.35;
  const padX = Math.ceil(px * 0.15) + 2;
  const padY = Math.ceil(px * 0.2);
  const wpx = Math.ceil(met.width) + padX * 2;
  const hpx = Math.ceil(asc + desc) + padY * 2;
  const cv = CX.eng.createCanvas(wpx, hpx);
  const c = cv.getContext('2d');
  c.font = m.font;
  c.fillStyle = CUR_COLOR;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.direction = rtl ? 'rtl' : 'ltr';
  c.fillText(text, padX, padY + asc);
  const textW = met.width / PX_PER_MM;
  let left = x;
  if (opts?.align === 'right') left = x - textW;
  else if (opts?.align === 'center') left = x - textW / 2;
  else if (opts?.rtlRight !== undefined && rtl) left = opts.rtlRight - textW;
  d.addImage(cv.toDataURL('image/png'), 'PNG', left - padX / PX_PER_MM, y - (padY + asc) / PX_PER_MM, wpx / PX_PER_MM, hpx / PX_PER_MM);
}

const stripCache = new Map<string, RegExp>();
function stripRe(uni: boolean): RegExp {
  const key = `${uni}-${!!CX}`;
  let r = stripCache.get(key);
  if (!r) {
    r = new RegExp(`[^${uni ? UNI_ALLOWED_CLASS : '\\n\\x20-\\x7E\\xA0-\\xFF'}${CX ? CX_CLASS : ''}]`, 'g');
    stripCache.set(key, r);
  }
  return r;
}

// ── Text helpers ─────────────────────────────────────────────────────────────
function clean(s: string | undefined | null): string {
  let t = (s ?? '')
    .replace(/[\u2022\u25CF\u25AA\u25E6]/g, '-')
    .replace(/\t/g, ' ')
    .replace(/\r\n?/g, '\n');
  if (UNI) {
    // Embedded font: keep real typography, drop only what the font can't draw (emoji, RTL scripts...)
    t = t.replace(stripRe(true), '');
  } else {
    // Built-in fonts only cover Latin-1: normalise typography and drop the rest
    t = t
      .replace(/[\u2018\u2019\u201A]/g, "'")
      .replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(stripRe(false), '');
  }
  return t.trim();
}

function pdfFont(css: string): 'times' | 'helvetica' {
  return /georgia|times|serif/i.test(css) && !/sans/i.test(css) ? 'times' : 'helvetica';
}

/** Word-wrap with hard-breaking of over-long tokens. Thai (no spaces) is split with Intl.Segmenter. */
function wrap(d: Doc, text: string, width: number): string[] {
  const out: string[] = [];
  const seg = wordSegmenter();
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    const units: { t: string; sp: boolean }[] = [];
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (seg && THAI_RE.test(word)) {
        let first = true;
        for (const sg of seg.segment(word)) { units.push({ t: sg.segment, sp: first && units.length > 0 }); first = false; }
      } else {
        units.push({ t: word, sp: units.length > 0 });
      }
    }
    let line = '';
    for (const u of units) {
      let w = u.t;
      while (tw(d, w) > width) {
        let n = w.length;
        while (n > 1 && tw(d, w.slice(0, n)) > width) n--;
        while (n > 1 && COMBINING_RE.test(w[n] ?? '')) n--; // never strand a combining mark / vowel sign
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const test = line + (u.sp && line ? ' ' : '') + w;
      if (tw(d, test) <= width) line = test;
      else { if (line) out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/** Shrink font size until a single line fits `width`. */
function fitSize(d: Doc, text: string, width: number, start: number, min: number): number {
  let s = start;
  d.setFontSize(s);
  while (s > min && tw(d, text) > width) { s -= 0.5; d.setFontSize(s); }
  return s;
}

// ── Vector shapes ────────────────────────────────────────────────────────────
function diamond(d: Doc, cx: number, cy: number, r: number, hex: string) {
  fill(d, hex);
  d.lines([[r, r], [-r, r], [-r, -r], [r, -r]], cx, cy - r, [1, 1], 'F', true);
}

function withClipRect(d: Doc, x: number, y: number, w: number, h: number, fn: () => void) {
  d.saveGraphicsState();
  d.rect(x, y, w, h, null as never);
  d.clip();
  d.discardPath();
  fn();
  d.restoreGraphicsState();
}

/** Decorative translucent circles used on the header bands. */
function decoCircles(d: Doc, x: number, y: number, w: number, h: number, hex: string) {
  withClipRect(d, x, y, w, h, () => {
    fill(d, hex);
    opacity(d, 0.1); d.circle(x + w - 12, y + 6, 34, 'F');
    opacity(d, 0.08); d.circle(x + w - 52, y + h + 6, 22, 'F');
    opacity(d, 0.12); d.circle(x + 8, y - 4, 14, 'F');
    opacity(d, 1);
  });
}

type IconKind = 'mail' | 'phone' | 'pin' | 'globe' | 'in';
function icon(d: Doc, kind: IconKind, cx: number, cy: number, bg: string, fg = WHITE, r = 2.2) {
  fill(d, bg); d.circle(cx, cy, r, 'F');
  stroke(d, fg); fill(d, fg); d.setLineWidth(0.22);
  switch (kind) {
    case 'mail':
      d.rect(cx - 1.25, cy - 0.85, 2.5, 1.7, 'S');
      d.lines([[1.25, 0.9], [1.25, -0.9]], cx - 1.25, cy - 0.85, [1, 1], 'S');
      break;
    case 'phone':
      d.roundedRect(cx - 0.75, cy - 1.3, 1.5, 2.6, 0.3, 0.3, 'S');
      d.circle(cx, cy + 0.85, 0.15, 'F');
      break;
    case 'pin':
      d.circle(cx, cy - 0.45, 0.9, 'F');
      d.triangle(cx - 0.8, cy - 0.05, cx + 0.8, cy - 0.05, cx, cy + 1.35, 'F');
      fill(d, bg); d.circle(cx, cy - 0.45, 0.32, 'F');
      break;
    case 'globe':
      d.circle(cx, cy, 1.2, 'S');
      d.ellipse(cx, cy, 0.5, 1.2, 'S');
      d.line(cx - 1.2, cy, cx + 1.2, cy);
      break;
    case 'in':
      setF(d, 'helvetica', 'bold'); d.setFontSize(5.2); ink(d, fg);
      put(d, 'in', cx, cy + 0.65, { align: 'center' });
      break;
  }
}

// ── Image prep (square, centre-cropped; also converts WebP etc. to JPEG) ──────
async function prepPhoto(dataUrl: string): Promise<{ data: string; fmt: 'JPEG' | 'PNG' } | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return null;
  const fallbackFmt = /image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG';
  if (typeof document === 'undefined') {
    return /image\/(png|jpe?g)/i.test(dataUrl) ? { data: dataUrl, fmt: fallbackFmt } : null;
  }
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('img'));
      i.src = dataUrl;
    });
    const size = 480;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return { data: c.toDataURL('image/jpeg', 0.92), fmt: 'JPEG' };
  } catch {
    return null;
  }
}

// ── Output helpers ───────────────────────────────────────────────────────────
/** Saves a PDF blob as a downloaded file (never opens an HTML page). */
export function savePdfBlob(blob: Blob, fileName: string) {
  const pdf = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdf);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function newDoc(title: string, author: string): Promise<Doc> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const ascii = (v: string) => (v || '').replace(/[^\x20-\x7E]/g, '').trim();
  doc.setProperties({ title: ascii(title) || 'Document', author: ascii(author), creator: 'Document Builder' });
  return doc;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CV
// ═════════════════════════════════════════════════════════════════════════════
const SKILL_FRACTION: Record<string, number> = { Beginner: 0.3, Intermediate: 0.55, Advanced: 0.8, Expert: 1 };
const LANG_DOTS: Record<string, number> = { Basic: 2, Conversational: 3, Fluent: 4, Native: 5 };

interface Col { x: number; w: number; page: number; y: number }

export async function generateCvPdf(cv: CvPdfData, theme: CvPdfTheme): Promise<Blob> {
  const doc = await newDoc(`${cv.name || 'Resume'} - CV`, cv.name);
  const photo = await prepPhoto(cv.profilePicture);
  const cvRaw = JSON.stringify({ ...cv, profilePicture: '' });
  await initUnicode(doc, cvRaw);
  await initComplex(cvRaw);

  const font = pdfFont(theme.font);
  const flat = theme.headerBg === 'transparent';
  const accent = theme.accent;
  const bandColor = flat ? WHITE : theme.headerBg;
  const bandH = 50;
  const SB = 66;                       // sidebar width
  const sbTint = tint(accent, 0.92);
  const sbEdge = tint(accent, 0.7);
  const bottom = H - 17;

  const side: Col = { x: 11, w: SB - 19, page: 1, y: bandH + 10 };
  const main: Col = { x: SB + 9, w: W - SB - 9 - 13, page: 1, y: bandH + 10 };

  // ── page chrome ──
  const sidebarBg = (top: number) => {
    fill(doc, sbTint); doc.rect(0, top, SB, H - top, 'F');
    fill(doc, sbEdge); doc.rect(SB - 0.5, top, 0.5, H - top, 'F');
  };

  // Page 1 header band
  const drawBand = () => {
    if (flat) {
      fill(doc, accent); doc.rect(0, 0, W, 6, 'F');
      fill(doc, tint(accent, 0.55)); doc.rect(0, 6, W, 1, 'F');
    } else {
      fill(doc, bandColor); doc.rect(0, 0, W, bandH, 'F');
      decoCircles(doc, 0, 0, W, bandH, WHITE);
      fill(doc, tint(accent, 0.55)); opacity(doc, 0.55); doc.rect(0, bandH - 1.4, W, 1.4, 'F'); opacity(doc, 1);
    }
    if (flat) {
      // elegant double rule under a white header
      fill(doc, accent); doc.rect(0, bandH - 1.2, W, 1.2, 'F');
      fill(doc, tint(accent, 0.6)); doc.rect(0, bandH - 3, W, 0.35, 'F');
    }

    // Photo (circular, ringed)
    const hasPhoto = !!photo;
    const photoD = 32;
    const px = 14;
    const py = (bandH - photoD) / 2 + (flat ? 1.5 : 0);
    if (hasPhoto && photo) {
      stroke(doc, flat ? accent : WHITE); doc.setLineWidth(1.1);
      doc.circle(px + photoD / 2, py + photoD / 2, photoD / 2 + 0.9, 'S');
      doc.saveGraphicsState();
      doc.circle(px + photoD / 2, py + photoD / 2, photoD / 2, null as never);
      doc.clip(); doc.discardPath();
      try { doc.addImage(photo.data, photo.fmt, px, py, photoD, photoD); } catch { /* ignore bad image */ }
      doc.restoreGraphicsState();
    }

    const tx = hasPhoto ? px + photoD + 9 : 16;
    const tWidth = W - tx - 14;
    const name = clean(cv.name) || 'Your Name';
    setF(doc, font, 'bold'); ink(doc, theme.headerText);
    const size = fitSize(doc, name, tWidth, 27, 15);
    doc.setFontSize(size);
    put(doc, name, tx, flat ? 25 : 23.5);

    const title = clean(cv.title).toUpperCase();
    if (title) {
      setF(doc, 'helvetica', 'normal'); ink(doc, theme.subText);
      const ts = fitSize(doc, title, tWidth - 8, 10.5, 7);
      doc.setFontSize(ts);
      put(doc, title, tx, flat ? 33 : 32, { charSpace: 0.9 });
    }
    // ornament: short rule + diamond
    stroke(doc, flat ? accent : theme.subText); doc.setLineWidth(0.5);
    doc.line(tx, flat ? 38 : 37.5, tx + 22, flat ? 38 : 37.5);
    diamond(doc, tx + 25.5, flat ? 38 : 37.5, 1.1, flat ? accent : theme.subText);
  };

  drawBand();
  sidebarBg(bandH);

  const ensure = (col: Col, h: number) => {
    if (col.y + h <= bottom) return;
    col.page += 1;
    while (doc.getNumberOfPages() < col.page) {
      doc.addPage();
      sidebarBg(0);
    }
    col.y = 14;
  };
  const activateColumnPage = (col: Col) => doc.setPage(col.page);

  // ── Sidebar blocks ─────────────────────────────────────────────────────────
  const sideHeading = (label: string) => {
    ensure(side, 14); activateColumnPage(side);
    setF(doc, 'helvetica', 'bold'); doc.setFontSize(8.5); ink(doc, accent);
    put(doc, label.toUpperCase(), side.x, side.y, { charSpace: 0.9 });
    fill(doc, accent); doc.rect(side.x, side.y + 2, 11, 0.9, 'F');
    fill(doc, tint(accent, 0.55)); doc.rect(side.x + 12.5, side.y + 2.25, side.w - 12.5, 0.35, 'F');
    side.y += 9;
  };

  // Contact
  const contacts: { kind: IconKind; text: string }[] = [];
  if (cv.email)    contacts.push({ kind: 'mail',  text: clean(cv.email) });
  if (cv.phone)    contacts.push({ kind: 'phone', text: clean(cv.phone) });
  if (cv.location) contacts.push({ kind: 'pin',   text: clean(cv.location) });
  if (cv.website)  contacts.push({ kind: 'globe', text: clean(cv.website) });
  if (cv.linkedin) contacts.push({ kind: 'in',    text: clean(cv.linkedin) });
  if (contacts.length) {
    sideHeading('Contact');
    for (const c of contacts) {
      setF(doc, 'helvetica', 'normal');
      const cSize = /\s/.test(c.text) ? 8.3 : fitSize(doc, c.text, side.w - 8, 8.3, 6.4);
      doc.setFontSize(cSize);
      const lines = wrap(doc, c.text, side.w - 8);
      const h = Math.max(6, lines.length * 3.9 + 2);
      ensure(side, h); activateColumnPage(side);
      icon(doc, c.kind, side.x + 2.2, side.y - 0.6, accent);
      setF(doc, 'helvetica', 'normal'); doc.setFontSize(cSize); ink(doc, DARK);
      lines.forEach((ln, i) => put(doc, ln, side.x + 7, side.y + i * 3.9));
      side.y += h;
    }
    side.y += 4;
  }

  // Skills with level bars
  const skills = cv.skills.filter(s => s.name.trim());
  if (skills.length) {
    sideHeading('Skills');
    for (const s of skills) {
      ensure(side, 10); activateColumnPage(side);
      setF(doc, 'helvetica', 'bold'); doc.setFontSize(8.5); ink(doc, DARK);
      const nm = wrap(doc, clean(s.name), side.w);
      nm.forEach((ln, i) => put(doc, ln, side.x, side.y + i * 3.9));
      const by = side.y + (nm.length - 1) * 3.9 + 2.3;
      const frac = SKILL_FRACTION[s.level] ?? 0.5;
      fill(doc, tint(accent, 0.78)); doc.roundedRect(side.x, by, side.w, 1.8, 0.9, 0.9, 'F');
      fill(doc, accent); doc.roundedRect(side.x, by, Math.max(2, side.w * frac), 1.8, 0.9, 0.9, 'F');
      side.y = by + 6.2;
    }
    side.y += 2;
  }

  // Languages with proficiency dots
  const langs = cv.languages.filter(l => l.language.trim());
  if (langs.length) {
    sideHeading('Languages');
    for (const l of langs) {
      ensure(side, 8); activateColumnPage(side);
      setF(doc, 'helvetica', 'bold'); doc.setFontSize(8.5); ink(doc, DARK);
      put(doc, clean(l.language), side.x, side.y);
      const filled = LANG_DOTS[l.proficiency] ?? 3;
      for (let i = 0; i < 5; i++) {
        const cx = side.x + side.w - 18 + i * 4.2 + 1.2;
        if (i < filled) { fill(doc, accent); doc.circle(cx, side.y - 1, 1.15, 'F'); }
        else { fill(doc, tint(accent, 0.72)); doc.circle(cx, side.y - 1, 1.15, 'F'); }
      }
      setF(doc, 'helvetica', 'italic'); doc.setFontSize(7.5); ink(doc, MUTED);
      put(doc, clean(l.proficiency), side.x, side.y + 3.6);
      side.y += 8.6;
    }
  }

  // ── Main column ────────────────────────────────────────────────────────────
  const mainHeading = (label: string) => {
    ensure(main, 36); activateColumnPage(main);
    diamond(doc, main.x + 1.6, main.y - 1.1, 1.7, accent);
    setF(doc, 'helvetica', 'bold'); doc.setFontSize(10); ink(doc, accent);
    put(doc, label.toUpperCase(), main.x + 6.2, main.y, { charSpace: 1 });
    const tWidth = tw(doc, label.toUpperCase()) + label.length * 1.0;
    stroke(doc, theme.sectionLine === theme.accent ? tint(accent, 0.55) : theme.sectionLine);
    doc.setLineWidth(0.35);
    doc.line(main.x + 8.5 + tWidth, main.y - 1.2, main.x + main.w - 2.2, main.y - 1.2);
    fill(doc, accent); doc.circle(main.x + main.w - 1.2, main.y - 1.2, 1, 'F');
    main.y += 8;
  };

  const writeParagraph = (text: string, x: number, w: number, size: number, color: string, leading: number, style: 'normal' | 'italic' = 'normal') => {
    const lines = text.split('\n');
    for (const raw of lines) {
      const bullet = /^\s*[-*]\s+/.test(raw);
      const body = raw.replace(/^\s*[-*]\s+/, '');
      if (!body.trim()) { main.y += leading * 0.5; continue; }
      setF(doc, font, style); doc.setFontSize(size);
      const wrapped = wrap(doc, body, bullet ? w - 4 : w);
      wrapped.forEach((ln, i) => {
        ensure(main, leading); activateColumnPage(main);
        setF(doc, font, style); doc.setFontSize(size); ink(doc, color);
        const rtl = isRTL(ln);
        if (bullet && i === 0) { fill(doc, accent); doc.circle(rtl ? x + w - 1 : x + 1, main.y - 1, 0.55, 'F'); }
        put(doc, ln, bullet ? x + 4 : x, main.y, { rtlRight: bullet ? x + w - 4 : x + w });
        main.y += leading;
      });
    }
  };

  /** Period "pill" on the right of an entry header. */
  const pill = (text: string, yBaseline: number) => {
    const t = clean(text);
    if (!t) return 0;
    setF(doc, 'helvetica', 'bold'); doc.setFontSize(7.6);
    const pw = tw(doc, t) + 5;
    const px = main.x + main.w - pw;
    fill(doc, tint(accent, 0.88)); doc.roundedRect(px, yBaseline - 3.7, pw, 5.2, 2.6, 2.6, 'F');
    ink(doc, accent); put(doc, t, px + 2.5, yBaseline);
    return pw;
  };

  const timelineEntry = (
    title: string, sub: string, period: string, desc: string, isLast = false,
  ) => {
    ensure(main, 18); activateColumnPage(main);
    const startPage = main.page;
    const startY = main.y;
    const tx = main.x + 7;
    const tWidth = main.w - 7;
    const pw = pill(period, main.y);
    setF(doc, font, 'bold'); doc.setFontSize(10.8); ink(doc, DARK);
    const titleLines = wrap(doc, clean(title), tWidth - (pw ? pw + 3 : 0));
    titleLines.forEach((ln, i) => put(doc, ln, tx, main.y + i * 4.8));
    // dot on the timeline
    fill(doc, accent); doc.circle(main.x + 1.6, startY - 1.2, 1.7, 'F');
    fill(doc, WHITE); doc.circle(main.x + 1.6, startY - 1.2, 0.65, 'F');
    main.y += (titleLines.length - 1) * 4.8 + 4.6;
    if (sub) {
      setF(doc, font, 'italic'); doc.setFontSize(9.3); ink(doc, MUTED);
      const sl = wrap(doc, clean(sub), tWidth);
      sl.forEach(ln => { put(doc, ln, tx, main.y); main.y += 4.3; });
    }
    if (desc) { main.y += 0.8; writeParagraph(desc, tx, tWidth, 9.3, '#374151', 4.4); }
    main.y += 3.2;
    // timeline stem (only drawn when the entry stayed on one page)
    if (!isLast && main.page === startPage) {
      activateColumnPage(main);
      stroke(doc, tint(accent, 0.6)); doc.setLineWidth(0.45);
      doc.line(main.x + 1.6, startY + 0.8, main.x + 1.6, main.y - 3.0);
    }
  };

  // Summary — in a soft accent-edged panel
  const summary = clean(cv.summary);
  if (summary) {
    mainHeading('Profile');
    setF(doc, font, 'normal'); doc.setFontSize(9.8);
    const lines = wrap(doc, summary, main.w - 9);
    const h = lines.length * 4.8 + 6;
    if (h < bottom - 14) {
      ensure(main, h); activateColumnPage(main);
      fill(doc, tint(accent, 0.94)); doc.roundedRect(main.x, main.y - 3.5, main.w, h, 1.5, 1.5, 'F');
      fill(doc, accent); doc.roundedRect(main.x, main.y - 3.5, 1.4, h, 0.7, 0.7, 'F');
      setF(doc, font, 'normal'); doc.setFontSize(9.8); ink(doc, '#374151');
      lines.forEach((ln, i) => put(doc, ln, main.x + 5.5, main.y + 0.8 + i * 4.8, { rtlRight: main.x + main.w - 4 }));
      main.y += h + 2;
    } else {
      writeParagraph(summary, main.x, main.w, 9.8, '#374151', 4.8);
      main.y += 2;
    }
  }

  const work = cv.work.filter(w => w.company.trim() || w.role.trim());
  if (work.length) {
    mainHeading('Work Experience');
    for (const [wi, w] of work.entries()) {
      const sub = [clean(w.company), clean(w.location)].filter(Boolean).join('  |  ');
      timelineEntry(clean(w.role) || clean(w.company), w.role ? sub : clean(w.location), w.period, clean(w.description), wi === work.length - 1);
    }
    main.y += 1;
  }

  const edu = cv.education.filter(e => e.institution.trim() || e.degree.trim());
  if (edu.length) {
    mainHeading('Education');
    for (const [ei, e] of edu.entries()) {
      const title = [clean(e.degree), clean(e.fieldOfStudy)].filter(Boolean).join(' - ');
      const sub = [clean(e.institution), clean(e.grade)].filter(Boolean).join('  |  ');
      timelineEntry(title || clean(e.institution), title ? sub : '', e.year, '', ei === edu.length - 1);
    }
    main.y += 1;
  }

  const certs = cv.certifications.filter(c => c.name.trim());
  if (certs.length) {
    mainHeading('Certifications & Awards');
    for (const c of certs) {
      ensure(main, 13); activateColumnPage(main);
      const pw = pill(c.year, main.y);
      diamond(doc, main.x + 1.6, main.y - 1.2, 1.4, accent);
      setF(doc, font, 'bold'); doc.setFontSize(10); ink(doc, DARK);
      const tl = wrap(doc, clean(c.name), main.w - 7 - (pw ? pw + 3 : 0));
      tl.forEach((ln, i) => put(doc, ln, main.x + 7, main.y + i * 4.6));
      main.y += (tl.length - 1) * 4.6 + 4.4;
      const sub = [clean(c.issuer), c.credentialId ? `ID: ${clean(c.credentialId)}` : ''].filter(Boolean).join('  |  ');
      if (sub) {
        setF(doc, font, 'italic'); doc.setFontSize(9); ink(doc, MUTED);
        wrap(doc, sub, main.w - 7).forEach(ln => { put(doc, ln, main.x + 7, main.y); main.y += 4.2; });
      }
      main.y += 2.6;
    }
    main.y += 1;
  }

  const refs = cv.references.filter(r => r.name.trim());
  if (refs.length) {
    mainHeading('References');
    const gap = 5;
    const cw = (main.w - gap) / 2;
    for (let i = 0; i < refs.length; i += 2) {
      const pair = refs.slice(i, i + 2);
      const cardLines = pair.map(r => {
        setF(doc, font, 'normal'); doc.setFontSize(8.8);
        const l: string[] = [];
        const role = [clean(r.title), clean(r.company)].filter(Boolean).join(' | ');
        if (role) l.push(...wrap(doc, role, cw - 8));
        if (r.email) l.push(...wrap(doc, clean(r.email), cw - 8));
        if (r.phone) l.push(clean(r.phone));
        return l;
      });
      const h = 9 + Math.max(...cardLines.map(l => l.length)) * 4 + 3;
      ensure(main, h + 2); activateColumnPage(main);
      pair.forEach((r, k) => {
        const cx = main.x + k * (cw + gap);
        const top = main.y - 4;
        fill(doc, tint(accent, 0.94)); doc.roundedRect(cx, top, cw, h, 1.8, 1.8, 'F');
        fill(doc, accent); doc.roundedRect(cx, top, cw, 1.3, 0.6, 0.6, 'F');
        setF(doc, font, 'bold'); doc.setFontSize(9.8); ink(doc, DARK);
        put(doc, clean(r.name), cx + 4, top + 7);
        setF(doc, font, 'normal'); doc.setFontSize(8.8); ink(doc, MUTED);
        cardLines[k].forEach((ln, j) => put(doc, ln, cx + 4, top + 11.6 + j * 4));
      });
      main.y += h + 3;
    }
  }

  // ── Footer on every page ────────────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    fill(doc, accent); doc.rect(0, H - 4, W, 4, 'F');
    fill(doc, tint(accent, 0.55)); doc.rect(0, H - 4.7, W, 0.45, 'F');
    setF(doc, 'helvetica', 'normal'); doc.setFontSize(7.5); ink(doc, MUTED);
    put(doc, clean(cv.name), main.x, H - 8.5);
    put(doc, `Page ${p} of ${total}`, W - 13, H - 8.5, { align: 'right' });
  }

  return doc.output('blob');
}

// ═════════════════════════════════════════════════════════════════════════════
//  COVER LETTER
// ═════════════════════════════════════════════════════════════════════════════
export async function generateCoverLetterPdf(cl: CoverLetterPdfData, accent = '#9f1239'): Promise<Blob> {
  const doc = await newDoc(`${cl.name || 'Cover Letter'} - Cover Letter`, cl.name);
  const clRaw = JSON.stringify(cl);
  await initUnicode(doc, clRaw);
  await initComplex(clRaw);
  const font = 'times';
  const L = 20;
  const R = W - 20;
  const TW = R - L;
  const bottom = H - 24;
  const bandH = 38;
  const stripH = 11;

  const name = clean(cl.name) || 'Your Name';
  const role = clean(cl.role);
  const company = clean(cl.company);
  const manager = clean(cl.hiringManager);

  const footer = () => {
    fill(doc, accent); doc.rect(0, H - 6, W, 6, 'F');
    withClipRect(doc, 0, H - 6, W, 6, () => {
      fill(doc, WHITE); opacity(doc, 0.12); doc.circle(W - 14, H, 14, 'F'); doc.circle(24, H + 2, 10, 'F'); opacity(doc, 1);
    });
    fill(doc, tint(accent, 0.55)); doc.rect(0, H - 6.7, W, 0.5, 'F');
    // diamond ornament + hairline above footer
    stroke(doc, tint(accent, 0.6)); doc.setLineWidth(0.3);
    doc.line(L, H - 14, W / 2 - 6, H - 14); doc.line(W / 2 + 6, H - 14, R, H - 14);
    diamond(doc, W / 2, H - 14, 1.5, accent);
  };

  // ── Page 1 letterhead ──
  fill(doc, accent); doc.rect(0, 0, W, bandH, 'F');
  decoCircles(doc, 0, 0, W, bandH, WHITE);
  fill(doc, tint(accent, 0.55)); opacity(doc, 0.6); doc.rect(0, bandH - 1.3, W, 1.3, 'F'); opacity(doc, 1);

  setF(doc, font, 'bold'); ink(doc, WHITE);
  const ns = fitSize(doc, name, TW, 28, 16);
  doc.setFontSize(ns);
  put(doc, name, L, 20);
  if (role) {
    setF(doc, 'helvetica', 'normal'); doc.setFontSize(8.8); ink(doc, tint(accent, 0.72));
    put(doc, `APPLICATION FOR ${role.toUpperCase()}`, L, 28.5, { charSpace: 1.1 });
  }

  // contact strip
  fill(doc, tint(accent, 0.92)); doc.rect(0, bandH, W, stripH, 'F');
  const items: { kind: IconKind; text: string }[] = [];
  if (cl.email)    items.push({ kind: 'mail',  text: clean(cl.email) });
  if (cl.phone)    items.push({ kind: 'phone', text: clean(cl.phone) });
  if (cl.location) items.push({ kind: 'pin',   text: clean(cl.location) });
  if (items.length) {
    let size = 8.6;
    const measure = () => {
      setF(doc, 'helvetica', 'normal'); doc.setFontSize(size);
      return items.reduce((a, it) => a + 7 + tw(doc, it.text) + 7, 0) - 7;
    };
    while (size > 6.5 && measure() > TW) size -= 0.3;
    setF(doc, 'helvetica', 'normal'); doc.setFontSize(size);
    let x = L;
    const cy = bandH + stripH / 2;
    for (const it of items) {
      icon(doc, it.kind, x + 2.2, cy, accent);
      setF(doc, 'helvetica', 'normal'); doc.setFontSize(size); ink(doc, DARK);
      put(doc, it.text, x + 6.2, cy + 1);
      x += 7 + tw(doc, it.text) + 7;
    }
  }
  footer();

  let page = 1;
  let y = bandH + stripH + 14;

  const newPage = () => {
    doc.addPage(); page += 1;
    fill(doc, accent); doc.rect(0, 0, W, 9, 'F');
    withClipRect(doc, 0, 0, W, 9, () => { fill(doc, WHITE); opacity(doc, 0.1); doc.circle(W - 16, 0, 14, 'F'); opacity(doc, 1); });
    setF(doc, font, 'bold'); doc.setFontSize(9.5); ink(doc, WHITE);
    put(doc, name, L, 6);
    footer();
    y = 22;
  };
  const ensure = (h: number) => { if (y + h > bottom) newPage(); };

  const para = (text: string, size = 11, leading = 5.6, color = '#1f2937', style: 'normal' | 'italic' | 'bold' = 'normal') => {
    setF(doc, font, style); doc.setFontSize(size);
    for (const ln of wrap(doc, text, TW)) {
      ensure(leading);
      setF(doc, font, style); doc.setFontSize(size); ink(doc, color);
      put(doc, ln, L, y, { rtlRight: R });
      y += leading;
    }
  };

  // Date
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  setF(doc, 'helvetica', 'normal'); doc.setFontSize(9.5); ink(doc, MUTED);
  put(doc, today.toUpperCase(), L, y, { charSpace: 0.8 });
  y += 10;

  // Recipient
  if (manager || company) {
    setF(doc, font, 'bold'); doc.setFontSize(11.5); ink(doc, DARK);
    if (manager) { put(doc, manager, L, y); y += 5.6; }
    setF(doc, font, 'normal'); ink(doc, '#374151');
    if (company) { put(doc, company, L, y); y += 5.6; }
    y += 5;
  }

  // Subject line with accent bar
  if (role || company) {
    const subj = `Re: Application for ${role || 'the open position'}${company ? ` at ${company}` : ''}`;
    setF(doc, font, 'bold'); doc.setFontSize(11.5);
    const sl = wrap(doc, subj, TW - 8);
    const h = sl.length * 5.6 + 4;
    ensure(h + 4);
    fill(doc, tint(accent, 0.93)); doc.roundedRect(L, y - 5, TW, h, 1.2, 1.2, 'F');
    fill(doc, accent); doc.roundedRect(L, y - 5, 1.6, h, 0.8, 0.8, 'F');
    setF(doc, font, 'bold'); doc.setFontSize(11.5); ink(doc, accent);
    sl.forEach((ln, i) => put(doc, ln, L + 6, y + i * 5.6));
    y += h + 5;
  }

  // Salutation + body
  para(`Dear ${manager || 'Hiring Manager'},`, 11.5, 6, DARK, 'bold');
  y += 3;
  const opening = clean(cl.opening) || `I am writing to express my interest in the ${role || '[Role]'} position at ${company || '[Company]'}.`;
  const body = clean(cl.body);
  const closing = clean(cl.closing) || 'I would welcome the opportunity to discuss how my background and skills align with your needs. Thank you for your time and consideration.';
  for (const block of [opening, ...(body ? [body] : []), closing]) {
    for (const p of block.split(/\n{2,}/)) {
      if (!p.trim()) continue;
      para(p.replace(/\n/g, ' '), 11, 5.7);
      y += 3.6;
    }
  }

  // Signature
  ensure(36);
  y += 4;
  para('Sincerely,', 11, 6, DARK);
  y += 6;
  setF(doc, font, 'italic'); ink(doc, accent);
  const sigSize = fitSize(doc, name, 80, 24, 14);
  doc.setFontSize(sigSize);
  put(doc, name, L, y);
  y += 3;
  stroke(doc, accent); doc.setLineWidth(0.6);
  doc.line(L, y, L + 26, y);
  stroke(doc, tint(accent, 0.55)); doc.setLineWidth(0.3);
  doc.line(L + 28, y, L + 56, y);
  diamond(doc, L + 58.5, y, 0.9, accent);
  y += 6;
  setF(doc, font, 'bold'); doc.setFontSize(11); ink(doc, DARK);
  put(doc, name, L, y);

  return doc.output('blob');
}

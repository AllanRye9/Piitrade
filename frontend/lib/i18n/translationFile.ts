// Reading and writing translation files for Admin → Translations: CSV, TSV (what you get when you copy cells
// out of Excel / Google Sheets), and Markdown tables. Pure functions, no browser APIs, fully unit-tested.
//
// Layout (wide):   English | lg | sw | ach          ← first column is the English source text; the other
//                  Login   | Yingira | Ingia |       column headers are language codes (or names like "Swahili")
// Layout (long):   key | locale | value             ← one row per translation
// An empty cell means "no translation" (the site then uses the built-in one, or English).

import { LOCALE_ALIASES } from './locales';

export interface ParsedEntry { key: string; locale: string; value: string }
export interface ParseResult {
  format: 'csv' | 'tsv' | 'markdown' | 'unknown';
  entries: ParsedEntry[];
  /** Cells that were blank (only turned into entries when `blanksRemove` is set). */
  blanks: number;
  warnings: string[];
  /** Fatal: nothing usable was found. */
  error?: string;
}
export interface ParseOptions {
  /** A blank translation cell removes the saved override instead of being ignored. */
  blanksRemove?: boolean;
}

export const MAX_KEY_CHARS = 500;
export const MAX_VALUE_CHARS = 2000;

// ─── low-level splitters ───────────────────────────────────────────────────────

/** RFC 4180 style: quotes, doubled quotes, delimiters and line breaks inside quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawAny = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') { quoted = true; sawAny = true; continue; }
    if (c === delimiter) { row.push(cell); cell = ''; sawAny = true; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (sawAny || row.length > 1 || row[0] !== '') rows.push(row);
      row = []; sawAny = false;
      continue;
    }
    cell += c; sawAny = true;
  }
  if (sawAny || cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Splits a Markdown table row on unescaped pipes; `\|` is a literal pipe. */
function splitMarkdownRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && (s[i + 1] === '|' || s[i + 1] === '\\')) { cell += s[i + 1]; i++; }
    else if (s[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += s[i];
  }
  cells.push(cell.trim());
  return cells.map((c) => c.replace(/<br\s*\/?>/gi, '\n'));
}

const isMarkdownDivider = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));

function detectDelimiter(firstLine: string): { delimiter: string; format: 'csv' | 'tsv' } {
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const tabs = count('\t');
  const commas = count(',');
  const semis = count(';');
  if (tabs > 0 && tabs >= commas && tabs >= semis) return { delimiter: '\t', format: 'tsv' };
  if (semis > commas) return { delimiter: ';', format: 'csv' }; // European Excel exports
  return { delimiter: ',', format: 'csv' };
}

// ─── parse ─────────────────────────────────────────────────────────────────────

export function parseTranslationText(input: string, opts: ParseOptions = {}): ParseResult {
  // A leading HTML comment (the exported Markdown template starts with one) is not part of the table.
  const text = input.replace(/^\uFEFF/, '').replace(/^\s*(<!--[\s\S]*?-->\s*)+/, '');
  const fail = (error: string, format: ParseResult['format'] = 'unknown'): ParseResult => ({ format, entries: [], blanks: 0, warnings: [], error });
  if (!text.trim()) return fail('The file is empty.');

  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  let format: ParseResult['format'];
  let rows: string[][];
  if (firstLine.trim().startsWith('|')) {
    format = 'markdown';
    rows = text.split(/\r?\n/).filter((l) => l.trim().startsWith('|')).map(splitMarkdownRow).filter((c) => !isMarkdownDivider(c));
  } else {
    const d = detectDelimiter(firstLine);
    format = d.format;
    rows = parseDelimited(text, d.delimiter);
  }
  if (rows.length < 2) return fail('Add a header row and at least one translation row.', format);

  const warnings: string[] = [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[`*_]/g, ''));
  const keyCol = header.findIndex((h) => ['key', 'english', 'en', 'source', 'text', 'string'].includes(h));
  const localeCol = header.indexOf('locale') >= 0 ? header.indexOf('locale') : header.indexOf('language');
  const valueCol = ['value', 'translation'].map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const entries: ParsedEntry[] = [];
  let blanks = 0;
  const seen = new Map<string, number>();

  const add = (rowNo: number, key: string, locale: string, rawValue: string) => {
    const k = key.replace(/\s+/g, ' ').trim();
    const v = rawValue.trim();
    if (!k) return;
    if (k.length > MAX_KEY_CHARS) { warnings.push(`Row ${rowNo}: the English text is longer than ${MAX_KEY_CHARS} characters — skipped.`); return; }
    if (v.length > MAX_VALUE_CHARS) { warnings.push(`Row ${rowNo}: the ${locale} translation is longer than ${MAX_VALUE_CHARS} characters — skipped.`); return; }
    if (!v) { blanks++; if (!opts.blanksRemove) return; }
    const id = `${locale}\u0000${k}`;
    if (seen.has(id)) {
      warnings.push(`"${k.slice(0, 40)}" (${locale}) appears on rows ${seen.get(id)} and ${rowNo}; the later one is used.`);
      const at = entries.findIndex((e) => e.locale === locale && e.key === k);
      if (at >= 0) entries.splice(at, 1);
    }
    seen.set(id, rowNo);
    entries.push({ key: k, locale, value: v });
  };

  if (localeCol >= 0 && valueCol >= 0) {
    // long layout
    const kc = keyCol >= 0 ? keyCol : 0;
    rows.slice(1).forEach((r, i) => {
      const raw = (r[localeCol] ?? '').trim().toLowerCase();
      const locale = LOCALE_ALIASES[raw];
      if (!locale) { if (raw) warnings.push(`Row ${i + 2}: unknown language "${raw.slice(0, 20)}" — skipped.`); return; }
      add(i + 2, r[kc] ?? '', locale, r[valueCol] ?? '');
    });
  } else {
    // wide layout
    const kc = keyCol >= 0 ? keyCol : 0;
    const cols: { index: number; locale: string }[] = [];
    header.forEach((h, i) => {
      if (i === kc) return;
      const locale = LOCALE_ALIASES[h];
      if (locale) cols.push({ index: i, locale });
      else if (h) warnings.push(`Column "${rows[0][i].trim().slice(0, 30)}" is not a known language — ignored.`);
    });
    if (!cols.length) return { format, entries: [], blanks: 0, warnings, error: 'No language columns found. Use headers like: English, lg, sw, ach (or Luganda, Swahili, Acoli).' };
    rows.slice(1).forEach((r, i) => {
      if (r.every((c) => !c.trim())) return;
      cols.forEach((c) => add(i + 2, r[kc] ?? '', c.locale, r[c.index] ?? ''));
    });
  }

  if (!entries.length) return { format, entries, blanks, warnings, error: blanks ? 'Every translation cell is empty — nothing to save.' : 'No translations found in this file.' };
  return { format, entries, blanks, warnings };
}

// ─── export ────────────────────────────────────────────────────────────────────

export interface ExportRow { key: string; values: Record<string, string> }

const csvCell = (v: string, delimiter: string) => (/["\r\n]/.test(v) || v.includes(delimiter) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV that Excel opens correctly (UTF-8 BOM, so Luganda / Acoli letters survive). */
export function toCsv(rows: ExportRow[], locales: string[]): string {
  const lines = [['English', ...locales].map((c) => csvCell(c, ',')).join(',')];
  for (const r of rows) lines.push([r.key, ...locales.map((l) => r.values[l] ?? '')].map((c) => csvCell(c, ',')).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const mdCell = (v: string) => v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function toMarkdown(rows: ExportRow[], locales: string[]): string {
  const head = `| English | ${locales.join(' | ')} |`;
  const divider = `|${' --- |'.repeat(locales.length + 1)}`;
  const body = rows.map((r) => `| ${mdCell(r.key)} | ${locales.map((l) => mdCell(r.values[l] ?? '')).join(' | ')} |`);
  return [
    '<!-- Piitrade translations. Fill in the language columns and upload this file at Admin → Translations.',
    '     Leave a cell empty to use the built-in translation (or English). Keep the English column exactly as it is. -->',
    '',
    head, divider, ...body, '',
  ].join('\n');
}

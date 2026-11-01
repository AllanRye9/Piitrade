/**
 * backupService.ts — full-database backup (export) and restore (import) for the admin panel.
 *
 * Why it reads the Postgres catalog instead of the Prisma model list: Prisma 7's runtime metadata
 * has no primary/foreign-key information, and going through the catalog means every table is
 * covered automatically — a table added by a future migration is backed up with no code change.
 *
 * File format ("piitrade-backup" v1) is newline-delimited JSON, optionally gzipped:
 *   line 1   {"type":"header", format, version, createdAt, migration, tables:[{name,rowCount,columns}], deferred}
 *   then     {"type":"rows","table":"User","rows":[{...},{...}]}     (up to BATCH_ROWS rows per line)
 *   last     {"type":"end","tables":N,"rows":R}                       (proves the file is complete)
 * Rows are Postgres's own JSON (row_to_json) and are loaded with json_populate_recordset, so every
 * column type (enums, arrays, jsonb, timestamps, numerics…) round-trips exactly. Because it is
 * line-based, neither export nor restore ever holds the whole database in memory.
 *
 * Only database rows are included. Uploaded images/videos/documents live in object storage (S3 /
 * the CDN) and are referenced by URL from the rows — back that bucket up with your storage provider.
 */
import fs from 'fs';
import zlib from 'zlib';
import { PassThrough, pipeline, Transform, type Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { planTableOrder, type FkEdge } from './plan';

type Db = Prisma.TransactionClient;

export const BACKUP_FORMAT = 'piitrade-backup';
export const BACKUP_VERSION = 1;
const BATCH_ROWS = 500;
const MAX_LINE_CHARS = 256 * 1024 * 1024;
/** Zip-bomb guard: a restore refuses to read more than this many bytes after decompression. */
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024 * 1024;
const TX_OPTIONS = { maxWait: 15_000, timeout: 60 * 60 * 1000 } as const;

/** The file is not a usable backup (wrong format, truncated, incompatible layout…). Surfaces as HTTP 400. */
export class BackupFileError extends Error {}
/** Another backup or restore is already running. Surfaces as HTTP 409. */
export class BackupBusyError extends Error {}

// ─── One job at a time ─────────────────────────────────────────────────────────

let busy: string | null = null;
export function backupBusy() { return busy; }
/** Shared with the media backup so a database job and a media job never run at the same time. */
export function acquireJob(kind: string) {
  if (busy) throw new BackupBusyError(`A ${busy} is already running. Wait for it to finish.`);
  busy = kind;
}
export function releaseJob() { busy = null; }
const acquire = acquireJob;
const release = releaseJob;

// ─── Catalog introspection ─────────────────────────────────────────────────────

export interface ColumnInfo { name: string; type: string; nullable: boolean; generated: boolean }
export interface DbSchema {
  tables: string[];
  columns: Record<string, ColumnInfo[]>;
  pk: Record<string, string[]>;
  fks: FkEdge[];
}

/** Identifiers only ever come from the catalog or are validated against it, but quote them anyway. */
export function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const TABLE_FILTER = `n.nspname = current_schema() AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'`;

export async function introspect(db: Db | typeof prisma): Promise<DbSchema> {
  const tableRows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${TABLE_FILTER} ORDER BY c.relname`,
  );
  const colRows = await db.$queryRawUnsafe<{ t: string; name: string; type: string; nullable: boolean; generated: boolean }[]>(
    `SELECT c.relname::text AS t, a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable, (a.attgenerated <> '') AS generated
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${TABLE_FILTER} AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`,
  );
  const pkRows = await db.$queryRawUnsafe<{ t: string; cols: string }[]>(
    `SELECT c.relname::text AS t, string_agg(a.attname::text, ',' ORDER BY k.ord) AS cols
       FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE i.indisprimary AND ${TABLE_FILTER}
      GROUP BY c.relname`,
  );
  const fkRows = await db.$queryRawUnsafe<{ child: string; parent: string; cols: string }[]>(
    `SELECT cl.relname::text AS child, ref.relname::text AS parent, string_agg(a.attname::text, ',' ORDER BY k.ord) AS cols
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_class ref ON ref.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
      WHERE con.contype = 'f' AND n.nspname = current_schema()
      GROUP BY con.oid, cl.relname, ref.relname`,
  );

  const columns: Record<string, ColumnInfo[]> = {};
  for (const r of colRows) (columns[r.t] ??= []).push({ name: r.name, type: r.type, nullable: r.nullable === true, generated: r.generated === true });
  const pk: Record<string, string[]> = {};
  for (const r of pkRows) pk[r.t] = String(r.cols).split(',');
  return {
    tables: tableRows.map((r) => r.name),
    columns,
    pk,
    fks: fkRows.map((r) => ({ child: r.child, parent: r.parent, columns: String(r.cols).split(',') })),
  };
}

export function planFor(schema: DbSchema) {
  return planTableOrder(schema.tables, schema.fks, (t, c) => schema.columns[t]?.find((x) => x.name === c)?.nullable === true);
}

async function appliedMigration(db: Db | typeof prisma): Promise<string | null> {
  // Checked first because a failing query would abort the surrounding transaction.
  const exists = await db.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass('_prisma_migrations') IS NOT NULL AS ok`);
  if (!exists[0]?.ok) return null;
  const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1`,
  );
  return rows[0]?.migration_name ?? null;
}

export async function tableRowCounts(db: Db | typeof prisma, tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)}`);
    out[t] = r[0]?.n ?? 0;
  }
  return out;
}

export async function getBackupInfo() {
  const schema = await introspect(prisma);
  const counts = await tableRowCounts(prisma, schema.tables);
  return {
    migration: await appliedMigration(prisma),
    tables: schema.tables.map((name) => ({ name, rows: counts[name] })),
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

// ─── Export ────────────────────────────────────────────────────────────────────

export interface ExportOptions {
  createdBy: string | null;
  /** Return true when the client went away; the export then stops. */
  isAborted?: () => boolean;
}

/** Streams a consistent snapshot of every table, one line at a time, into `write`. */
export async function exportBackup(write: (line: string) => Promise<void>, opts: ExportOptions): Promise<{ tables: number; rows: number }> {
  acquire('backup');
  try {
    return await prisma.$transaction(
      async (tx) => {
        const schema = await introspect(tx);
        const plan = planFor(schema);
        const counts = await tableRowCounts(tx, plan.order);
        const header = {
          type: 'header',
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          app: 'piitrade',
          createdAt: new Date().toISOString(),
          createdBy: opts.createdBy,
          migration: await appliedMigration(tx),
          deferred: plan.deferred,
          tables: plan.order.map((name) => ({ name, rowCount: counts[name], columns: schema.columns[name].map((c) => c.name) })),
        };
        await write(JSON.stringify(header) + '\n');

        let totalRows = 0;
        for (const table of plan.order) {
          const pk = schema.pk[table] ?? [];
          const keyset = pk.length === 1;
          const keyCol = keyset ? pk[0] : null;
          const keyType = keyCol ? schema.columns[table].find((c) => c.name === keyCol)!.type : '';
          let last: string | null = null;
          let offset = 0;
          for (;;) {
            if (opts.isAborted?.()) throw new Error('Backup cancelled: the client disconnected.');
            let batch: { j: string; k?: string }[];
            if (keyCol) {
              const where = last === null ? '' : `WHERE t.${q(keyCol)} > $1::${keyType}`;
              const sql = `SELECT row_to_json(t)::text AS j, t.${q(keyCol)}::text AS k FROM ${q(table)} t ${where} ORDER BY t.${q(keyCol)} LIMIT ${BATCH_ROWS}`;
              batch = last === null ? await tx.$queryRawUnsafe(sql) : await tx.$queryRawUnsafe(sql, last);
            } else {
              // No single-column key to page by: ctid is stable inside this snapshot.
              batch = await tx.$queryRawUnsafe(`SELECT row_to_json(t)::text AS j FROM ${q(table)} t ORDER BY t.ctid LIMIT ${BATCH_ROWS} OFFSET ${offset}`);
              offset += batch.length;
            }
            if (!batch.length) break;
            let line = `{"type":"rows","table":${JSON.stringify(table)},"rows":[${batch.map((r) => r.j).join(',')}]}`;
            // Raw newlines can only be insignificant whitespace in valid JSON (strings escape them), so this is safe.
            if (line.includes('\n')) line = line.replace(/\r?\n/g, ' ');
            await write(line + '\n');
            totalRows += batch.length;
            if (keyCol) last = batch[batch.length - 1].k ?? null;
            if (batch.length < BATCH_ROWS) break;
          }
        }
        await write(JSON.stringify({ type: 'end', tables: plan.order.length, rows: totalRows }) + '\n');
        return { tables: plan.order.length, rows: totalRows };
      },
      { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } finally {
    release();
  }
}

// ─── Restore ───────────────────────────────────────────────────────────────────

export type RestoreMode = 'merge' | 'replace';

export interface RestoreTableReport {
  name: string;
  rowsInFile: number;
  rowsNow: number;
  inserted: number;
  skipped: number;
}
export interface RestoreReport {
  mode: RestoreMode;
  dryRun: boolean;
  backupCreatedAt: string | null;
  backupMigration: string | null;
  currentMigration: string | null;
  tables: RestoreTableReport[];
  totals: { rowsInFile: number; inserted: number; skipped: number };
  warnings: string[];
}

interface Header {
  createdAt: string | null;
  migration: string | null;
  tables: { name: string; rowCount: number; columns: string[] }[];
  deferred: Record<string, string[]>;
}

function parseHeader(line: string): Header {
  let h: any;
  try { h = JSON.parse(line); } catch { throw new BackupFileError('This is not a Piitrade backup file (the first line is not valid JSON).'); }
  if (!h || h.type !== 'header' || h.format !== BACKUP_FORMAT) throw new BackupFileError('This is not a Piitrade backup file.');
  if (h.version !== BACKUP_VERSION) throw new BackupFileError(`Unsupported backup version ${String(h.version)} (this server reads version ${BACKUP_VERSION}).`);
  if (!Array.isArray(h.tables) || !h.tables.every((t: any) => t && typeof t.name === 'string' && Number.isInteger(t.rowCount) && Array.isArray(t.columns) && t.columns.every((c: unknown) => typeof c === 'string'))) {
    throw new BackupFileError('The backup header is damaged.');
  }
  const deferred: Record<string, string[]> = {};
  if (h.deferred && typeof h.deferred === 'object') {
    for (const [k, v] of Object.entries(h.deferred)) if (Array.isArray(v)) deferred[k] = v.filter((c): c is string => typeof c === 'string');
  }
  return {
    createdAt: typeof h.createdAt === 'string' ? h.createdAt : null,
    migration: typeof h.migration === 'string' ? h.migration : null,
    tables: h.tables,
    deferred,
  };
}

/** Splits a (possibly gzipped) file into lines without ever holding more than one line in memory. */
export async function* readBackupLines(filePath: string): AsyncGenerator<string> {
  const fd = fs.openSync(filePath, 'r');
  let gz = false;
  try {
    const magic = Buffer.alloc(2);
    fs.readSync(fd, magic, 0, 2, 0);
    gz = magic[0] === 0x1f && magic[1] === 0x8b;
  } finally {
    fs.closeSync(fd);
  }
  const out = new PassThrough();
  const source = fs.createReadStream(filePath);
  if (gz) {
    let seen = 0;
    const cap = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        if (seen > MAX_UNCOMPRESSED_BYTES) cb(new BackupFileError('The backup expands to an unreasonable size and was rejected.'));
        else cb(null, chunk);
      },
    });
    pipeline(source, zlib.createGunzip(), cap, out, () => undefined);
  } else {
    pipeline(source, out, () => undefined);
  }

  const decoder = new StringDecoder('utf8');
  let buf = '';
  try {
    for await (const chunk of out as Readable) {
      buf += decoder.write(chunk as Buffer);
      let start = 0;
      for (let i = buf.indexOf('\n', start); i >= 0; i = buf.indexOf('\n', start)) {
        const line = buf.slice(start, i);
        start = i + 1;
        if (line.trim()) yield line;
      }
      buf = buf.slice(start);
      if (buf.length > MAX_LINE_CHARS) throw new BackupFileError('The backup contains a line that is too long to be valid.');
    }
  } catch (err) {
    if (err instanceof BackupFileError) throw err;
    const code = (err as { code?: string }).code;
    if (typeof code === 'string' && code.startsWith('Z_')) throw new BackupFileError('The backup file is corrupted (it could not be decompressed).');
    throw err;
  } finally {
    // Also runs when the consumer stops early (validation failure), so no file handle is left open.
    source.destroy();
    out.destroy();
  }
  buf += decoder.end();
  if (buf.trim()) yield buf;
}

function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of keys) o[k] = row[k] ?? null;
  return o;
}

export interface RestoreOptions { mode: RestoreMode; dryRun: boolean }

async function runRestore(db: Db | typeof prisma, filePath: string, opts: RestoreOptions): Promise<RestoreReport> {
  const lines = readBackupLines(filePath);
  try {
    return await runRestoreLines(db, lines, opts);
  } finally {
    await lines.return(undefined); // releases the file handle if validation stopped early
  }
}

async function runRestoreLines(db: Db | typeof prisma, lines: AsyncGenerator<string>, opts: RestoreOptions): Promise<RestoreReport> {
  const apply = !opts.dryRun;
  const first = await lines.next();
  if (first.done) throw new BackupFileError('The backup file is empty.');
  const header = parseHeader(first.value);

  const schema = await introspect(db);
  const warnings: string[] = [];
  const dbTables = new Set(schema.tables);
  const fileNames = header.tables.map((t) => t.name);
  const fileTable = new Map(header.tables.map((t) => [t.name, t]));

  const unknown = fileNames.filter((n) => !dbTables.has(n));
  if (unknown.length) warnings.push(`Skipped tables that no longer exist in this database: ${unknown.join(', ')}.`);
  const missing = schema.tables.filter((n) => !fileTable.has(n));
  if (missing.length) {
    if (opts.mode === 'replace') {
      throw new BackupFileError(`"Replace" needs a complete backup, but this file has no data for: ${missing.join(', ')}. Use "Merge" or a full backup.`);
    }
    warnings.push(`The backup has no data for: ${missing.join(', ')} (left untouched).`);
  }

  // Parents must come before children in the file; the exporter wrote it in that order.
  const pos = new Map(fileNames.map((n, i) => [n, i]));
  for (const fk of schema.fks) {
    if (fk.child === fk.parent) continue;
    const pc = pos.get(fk.child);
    const pp = pos.get(fk.parent);
    if (pc === undefined || pp === undefined) continue;
    const deferredCols = header.deferred[fk.child] ?? [];
    if (fk.columns.every((c) => deferredCols.includes(c))) continue;
    if (pp > pc) {
      throw new BackupFileError(`This backup was made with a different database layout ("${fk.child}" now depends on "${fk.parent}"). Restore it with the app version that created it.`);
    }
  }

  // Which columns we can load, per table.
  const usable: Record<string, string[]> = {};
  const deferred: Record<string, string[]> = {};
  for (const t of header.tables) {
    if (!dbTables.has(t.name)) continue;
    const dbCols = schema.columns[t.name];
    const dbLoadable = new Set(dbCols.filter((c) => !c.generated).map((c) => c.name));
    usable[t.name] = t.columns.filter((c) => dbLoadable.has(c));
    const dropped = t.columns.filter((c) => !dbCols.some((d) => d.name === c));
    if (dropped.length) warnings.push(`${t.name}: ignored columns that no longer exist (${dropped.join(', ')}).`);
    const pk = schema.pk[t.name] ?? [];
    if (pk.some((c) => !usable[t.name].includes(c))) throw new BackupFileError(`Table "${t.name}" in the backup lacks its key column(s) (${pk.join(', ')}).`);
    const d = (header.deferred[t.name] ?? []).filter((c) => usable[t.name].includes(c));
    for (const c of d) {
      if (!dbCols.find((x) => x.name === c)?.nullable) throw new BackupFileError(`Cannot restore "${t.name}.${c}": the backup relies on this column being nullable, but it no longer is.`);
    }
    if (d.length) deferred[t.name] = d;
  }

  const before = await tableRowCounts(db, schema.tables);
  const currentMigration = await appliedMigration(db);
  if (header.migration && header.migration !== currentMigration) {
    warnings.push(`The backup was taken at database version "${header.migration}" but this server is at "${currentMigration}".`);
  }

  if (apply && opts.mode === 'replace') {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${schema.tables.map(q).join(', ')}`);
  }

  const rowsInFile: Record<string, number> = {};
  const inserted: Record<string, number> = {};
  const patches: Record<string, Record<string, unknown>[]> = {};
  let ended = false;
  let lastIdx = -1;
  let lineNo = 1;

  for await (const line of lines) {
    lineNo++;
    if (ended) throw new BackupFileError(`Unexpected data after the end marker (line ${lineNo}).`);
    let obj: any;
    try { obj = JSON.parse(line); } catch { throw new BackupFileError(`The backup is damaged: line ${lineNo} is not valid JSON.`); }
    if (obj?.type === 'end') { ended = true; continue; }
    if (obj?.type !== 'rows') continue; // unknown line types from newer versions are ignored
    const table: string = obj.table;
    const rows: Record<string, unknown>[] = obj.rows;
    if (typeof table !== 'string' || !Array.isArray(rows) || !fileTable.has(table)) throw new BackupFileError(`The backup is damaged: line ${lineNo} refers to an undeclared table.`);
    const idx = pos.get(table)!;
    if (idx < lastIdx) throw new BackupFileError(`The backup is damaged: data for "${table}" is out of order (line ${lineNo}).`);
    lastIdx = idx;
    rowsInFile[table] = (rowsInFile[table] ?? 0) + rows.length;
    if (!dbTables.has(table) || !rows.length) continue;

    if (apply) {
      const defCols = deferred[table] ?? [];
      const cols = usable[table].filter((c) => !defCols.includes(c));
      const colList = cols.map(q).join(', ');
      const conflict = opts.mode === 'merge' ? ' ON CONFLICT DO NOTHING' : '';
      const sql = `INSERT INTO ${q(table)} (${colList}) SELECT ${colList} FROM json_populate_recordset(NULL::${q(table)}, $1::json)${conflict}`;
      const n = await db.$executeRawUnsafe(sql, JSON.stringify(rows));
      inserted[table] = (inserted[table] ?? 0) + n;
      if (defCols.length) {
        const keep = [...(schema.pk[table] ?? []), ...defCols];
        for (const r of rows) if (defCols.some((c) => r[c] !== null && r[c] !== undefined)) (patches[table] ??= []).push(pick(r, keep));
      }
    }
  }

  if (!ended) throw new BackupFileError('The backup file is incomplete (it ends before the end marker). Nothing was changed.');
  for (const t of header.tables) {
    if ((rowsInFile[t.name] ?? 0) !== t.rowCount) {
      throw new BackupFileError(`The backup is incomplete: "${t.name}" should have ${t.rowCount} rows but contains ${rowsInFile[t.name] ?? 0}. Nothing was changed.`);
    }
  }

  if (apply) {
    // Second pass: fill the foreign keys that were loaded as NULL (self-references / loops). Only NULLs are filled.
    for (const [table, list] of Object.entries(patches)) {
      const defCols = deferred[table];
      const pk = schema.pk[table];
      const set = defCols.map((c) => `${q(c)} = COALESCE(t.${q(c)}, s.${q(c)})`).join(', ');
      const on = pk.map((c) => `t.${q(c)} = s.${q(c)}`).join(' AND ');
      const sql = `UPDATE ${q(table)} AS t SET ${set} FROM json_populate_recordset(NULL::${q(table)}, $1::json) AS s WHERE ${on}`;
      for (let i = 0; i < list.length; i += BATCH_ROWS) await db.$executeRawUnsafe(sql, JSON.stringify(list.slice(i, i + BATCH_ROWS)));
    }
    await resetSequences(db);
  }

  const tables: RestoreTableReport[] = header.tables
    .filter((t) => dbTables.has(t.name))
    .map((t) => {
      const inFile = rowsInFile[t.name] ?? 0;
      const ins = inserted[t.name] ?? 0;
      return { name: t.name, rowsInFile: inFile, rowsNow: before[t.name] ?? 0, inserted: ins, skipped: apply ? inFile - ins : 0 };
    });
  const totals = tables.reduce((a, t) => ({ rowsInFile: a.rowsInFile + t.rowsInFile, inserted: a.inserted + t.inserted, skipped: a.skipped + t.skipped }), { rowsInFile: 0, inserted: 0, skipped: 0 });
  return {
    mode: opts.mode,
    dryRun: opts.dryRun,
    backupCreatedAt: header.createdAt,
    backupMigration: header.migration,
    currentMigration,
    tables,
    totals,
    warnings,
  };
}

/** Auto-increment counters must continue after the highest restored id, or new rows would collide. */
async function resetSequences(db: Db | typeof prisma) {
  const cols = await db.$queryRawUnsafe<{ t: string; col: string; seq: string | null }[]>(
    `SELECT c.relname::text AS t, a.attname::text AS col, pg_get_serial_sequence(format('%I', c.relname), a.attname) AS seq
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${TABLE_FILTER} AND a.attnum > 0 AND NOT a.attisdropped`,
  );
  for (const c of cols) {
    if (!c.seq) continue;
    await db.$executeRawUnsafe(
      `SELECT setval($1::regclass, COALESCE(m.mx, 1), m.mx IS NOT NULL) FROM (SELECT MAX(${q(c.col)}) AS mx FROM ${q(c.t)}) m`,
      c.seq,
    );
  }
}

/**
 * Restores `filePath`. A dry run validates the whole file and reports what it would do without
 * touching anything. A real restore runs in ONE transaction: any problem — a corrupt line, a
 * constraint violation, a truncated file — rolls everything back, so the site is never left half-restored.
 */
export async function restoreBackup(filePath: string, opts: RestoreOptions): Promise<RestoreReport> {
  acquire('restore');
  try {
    if (opts.dryRun) return await runRestore(prisma, filePath, opts);
    const report = await prisma.$transaction((tx) => runRestore(tx, filePath, opts), TX_OPTIONS);
    logger.info(`Backup restored (${opts.mode}): ${report.totals.inserted} rows inserted across ${report.tables.length} tables`);
    return report;
  } finally {
    release();
  }
}

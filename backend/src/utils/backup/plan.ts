/**
 * plan.ts — decides the order tables must be loaded in so foreign keys are never violated.
 *
 * Pure (no database): the caller passes the foreign keys it read from the Postgres catalog.
 * A table's parents must be loaded before it. Where tables reference each other in a loop (or a
 * table references itself, like Category.parentId) the loop is broken by "deferring" a nullable
 * foreign-key column: it is loaded as NULL first and filled in once every row exists.
 */

export interface FkEdge {
  child: string;
  parent: string;
  columns: string[];
}

export interface TablePlan {
  /** Parents before children. */
  order: string[];
  /** table -> foreign-key columns that are loaded as NULL first and patched afterwards. */
  deferred: Record<string, string[]>;
}

export function planTableOrder(
  tables: string[],
  fks: FkEdge[],
  isNullable: (table: string, column: string) => boolean,
): TablePlan {
  const known = new Set(tables);
  const deferred: Record<string, Set<string>> = {};
  const defer = (table: string, columns: string[]) => {
    const set = (deferred[table] ??= new Set());
    for (const c of columns) set.add(c);
  };

  // Edges between two different known tables are ordering constraints; self references are always deferred.
  let edges: FkEdge[] = [];
  for (const fk of fks) {
    if (!known.has(fk.child) || !known.has(fk.parent)) continue;
    if (fk.child === fk.parent) {
      if (!fk.columns.every((c) => isNullable(fk.child, c))) {
        throw new Error(`Table "${fk.child}" has a required self-reference (${fk.columns.join(', ')}); it cannot be restored.`);
      }
      defer(fk.child, fk.columns);
      continue;
    }
    edges.push(fk);
  }
  edges.sort((a, b) => a.child.localeCompare(b.child) || a.parent.localeCompare(b.parent) || a.columns.join().localeCompare(b.columns.join()));

  const placed = new Set<string>();
  const order: string[] = [];
  let remaining = [...tables].sort();

  while (remaining.length) {
    const ready = remaining.filter((t) => edges.every((e) => e.child !== t || placed.has(e.parent)));
    if (ready.length) {
      for (const t of ready) { placed.add(t); order.push(t); }
      remaining = remaining.filter((t) => !placed.has(t));
      continue;
    }
    // Stuck on a loop: defer one nullable foreign key between the tables still waiting.
    const rem = new Set(remaining);
    const breakable = edges.find((e) => rem.has(e.child) && rem.has(e.parent) && e.columns.every((c) => isNullable(e.child, c)));
    if (!breakable) {
      throw new Error(`Cannot order tables: required circular references between ${remaining.join(', ')}.`);
    }
    defer(breakable.child, breakable.columns);
    edges = edges.filter((e) => e !== breakable);
  }

  const out: Record<string, string[]> = {};
  for (const [t, cols] of Object.entries(deferred)) out[t] = [...cols].sort();
  return { order, deferred: out };
}

/**
 * Pure helpers for the header's "priority+" tab strip: render tabs in rank order and move whatever
 * does not fit into a final "More" menu. Kept free of DOM/React so it is unit-testable.
 */

/**
 * How many tabs fit?
 * @param tabWidths   width of each tab, in rank order
 * @param available   width of the row
 * @param moreWidth   width of the "More" button (only reserved when something overflows)
 * @param fixedWidth  width of always-visible leading items (the "All" link)
 * @returns number of tabs to render; equals tabWidths.length when everything fits.
 */
export function computeFit(tabWidths: number[], available: number, moreWidth: number, fixedWidth = 0): number {
  const total = fixedWidth + tabWidths.reduce((s, w) => s + w, 0);
  if (total <= available) return tabWidths.length;
  let used = fixedWidth + moreWidth;
  let n = 0;
  for (const w of tabWidths) {
    if (used + w > available) break;
    used += w;
    n++;
  }
  return n;
}

/**
 * Split tab indexes into visible / overflow. If the active tab would be hidden it takes the last
 * visible slot, so the visitor always sees where they are.
 */
export function splitTabs(total: number, fit: number, activeIdx: number): { visible: number[]; overflow: number[] } {
  const all = Array.from({ length: total }, (_, i) => i);
  const count = Math.max(0, Math.min(fit, total));
  if (count >= total) return { visible: all, overflow: [] };
  if (activeIdx >= count && activeIdx < total && count > 0) {
    return {
      visible: [...all.slice(0, count - 1), activeIdx],
      overflow: all.slice(count - 1).filter((i) => i !== activeIdx),
    };
  }
  return { visible: all.slice(0, count), overflow: all.slice(count) };
}

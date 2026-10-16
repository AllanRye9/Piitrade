/**
 * Compact listing count that never overstates the real number
 * (it truncates instead of rounding): 842 · 1,234 · 12.4K · 1.2M
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const truncTenth = (x: number) => String(Math.floor(x * 10) / 10);
  if (n >= 1_000_000) return `${truncTenth(n / 1_000_000)}M`;
  if (n >= 10_000) return `${truncTenth(n / 1_000)}K`;
  return Math.floor(n).toLocaleString('en-US');
}

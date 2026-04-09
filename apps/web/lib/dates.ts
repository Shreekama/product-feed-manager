/**
 * SQLite stores dates as "YYYY-MM-DD HH:MM:SS" (space separator, no timezone).
 * `new Date("2026-04-09 07:37:18")` returns Invalid Date in browsers.
 * This helper normalises to ISO 8601 before parsing.
 */
export function parseDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  const normalized = val.includes('T') ? val : val.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

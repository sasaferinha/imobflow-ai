// Invalid values must remain invalid instead of silently changing the catalog
// to zero rooms/parking spaces or a null area after JSON serialization.
export function propertyNumber(value: unknown, integer = false): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  if (integer && (!Number.isInteger(parsed) || parsed > 2147483647)) return undefined;
  return parsed;
}

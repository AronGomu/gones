export function formatRatingDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return '';
  return value > 0 ? `+${value}` : `${value}`;
}

export function formatRatingValue(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}`;
}

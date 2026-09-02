/**
 * Renders every page when fewer than five exist; otherwise always renders five numbered items.
 * First/last stay visible while `'gap'` marks each elided run.
 */
export function paginationPageWindow(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const current = Math.min(Math.max(page, 1), totalPages);
  if (current <= 3) return [1, 2, 3, 4, 'gap', totalPages];
  if (current >= totalPages - 2) {
    return [1, 'gap', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'gap', current - 1, current, current + 1, 'gap', totalPages];
}

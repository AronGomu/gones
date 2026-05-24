export function logBoundaryError(boundary: string, error: unknown, context: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', boundary, context, message: error instanceof Error ? error.message : String(error) }));
}

/**
 * Logs that an operation failed, with the error type only. Never pass or log profile
 * values or page content: error messages can contain data, so they are not logged.
 */
export function logFailure(operation: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`ApplyOnce: ${operation} failed (${kind})`);
}

/**
 * Logs that an operation failed, with the error type only. Never pass or log profile
 * values or page content: error messages can contain data, so they are not logged, and
 * neither are stacks or error objects. Even the error's name is logged only when it is a
 * plain identifier (a custom error could put data there); anything else becomes "Error".
 */
export function logFailure(operation: string, error: unknown): void {
  const kind = error instanceof Error ? safeName(error.name) : typeof error;
  console.error(`ApplyOnce: ${operation} failed (${kind})`);
}

function safeName(name: unknown): string {
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error';
}

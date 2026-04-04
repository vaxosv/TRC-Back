export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseIntOrThrow(value: string, fieldName: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${fieldName}: must be an integer`);
  }
  return parsed;
}

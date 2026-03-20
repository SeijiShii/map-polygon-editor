let counter = 0;

/**
 * Generate a unique ID.
 */
export function generateId(): string {
  counter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${counter.toString(36)}-${random}`;
}

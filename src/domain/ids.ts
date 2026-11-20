/** Random identifiers for persisted entities. Uses the Web Crypto API (available in browsers and Node 19+). */
export function newId(prefix = ''): string {
  const id = globalThis.crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function nowTimestamp(): string {
  return new Date().toISOString();
}

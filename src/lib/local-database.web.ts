/**
 * The product's durable offline outbox is a native mobile capability.
 * Keeping a web adapter prevents the browser preview from bundling Expo SQLite's WASM worker.
 */
export async function getLocalDatabase(): Promise<null> {
  return null;
}

export async function initializeLocalDatabase(): Promise<void> {
  return Promise.resolve();
}

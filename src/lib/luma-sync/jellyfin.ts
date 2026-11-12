const connectionID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const reference = new RegExp(`^(?:luma\\.jellyfin\\.${connectionID}|luma-jellyfin://${connectionID}/manifest\\.json)$`);

/** An opaque reference to Luma's in-app bridge; it contains no server URL or credentials. */
export function isJellyfinCatalogReference(value: string): boolean {
  return value === value.trim() && reference.test(value);
}

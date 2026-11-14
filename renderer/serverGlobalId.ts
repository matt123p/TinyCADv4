// Each headless XML operation starts a fresh, deterministic set of item IDs.
let id = 0;
let identity = 0;
export function get_global_id() {
  return ++id;
}
export function resetServerIds() {
  id = 0;
  identity = 0;
}

// Document/sheet identities are transient in the standalone XML renderer.
// Keep their sequence separate from item IDs and independent of host crypto.
export function newServerIdentity() {
  return `tinycad-headless-${++identity}`;
}

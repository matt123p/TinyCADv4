// Each headless XML operation starts a fresh, deterministic set of item IDs.
let id = 0;
export function get_global_id() {
  return ++id;
}
export function resetServerIds() {
  id = 0;
}

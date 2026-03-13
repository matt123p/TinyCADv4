//
// The global unqiue id
//

// The global ID, used to track all objects through
// the undo/redo list and other selections

let global_id = 0;
export function get_global_id() {
  ++global_id;
  return global_id;
}

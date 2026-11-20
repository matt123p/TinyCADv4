export const PROJECT_FILE_EXTENSION = '.tcproject';
export const MAX_PROJECT_FILE_BYTES = 256 * 1024 * 1024;

export function isProjectFile(name) {
  return (
    typeof name === 'string' &&
    name.toLowerCase().endsWith(PROJECT_FILE_EXTENSION)
  );
}

export function projectFileTitle(name) {
  return isProjectFile(name)
    ? name.slice(0, -PROJECT_FILE_EXTENSION.length)
    : name;
}

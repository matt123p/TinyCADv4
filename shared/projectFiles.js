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

export function validProjectName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 240 &&
    !/[\/\\<>:"|?*\x00-\x1f]|[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  );
}

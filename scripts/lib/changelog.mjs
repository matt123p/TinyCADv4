/** Dependency-free: the GitHub release job does not install application packages. */
export function extractReleaseNotes(changelog, version) {
  const entries = [];
  let current = null;
  let fence = null;
  for (const line of changelog.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
    } else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { marker: marker[1][0], length: marker[1].length };
    } else {
      const heading = /^##[ \t]+(\S+)(?:[ \t].*)?$/.exec(line);
      if (heading) {
        current = heading[1] === `v${version}` ? [] : null;
        if (current) entries.push(current);
        continue;
      }
    }
    if (current) current.push(line);
  }
  if (entries.length !== 1)
    throw new Error(
      `${
        entries.length ? 'Duplicate' : 'Missing'
      } changelog entry for v${version}`,
    );
  const notes = entries[0].join('\n').trim();
  if (
    !notes ||
    !notes.split('\n').some((line) => line.trim() && !/^#{1,6}\s/.test(line))
  ) {
    throw new Error(`Empty changelog entry for v${version}`);
  }
  return notes;
}

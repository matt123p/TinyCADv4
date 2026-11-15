// Only display citations actually returned by the provider. Preserve native history separately.
export function citedText(part: any): string {
  let text = part.text || part.refusal || '';
  const citations = (part.annotations || []).filter(
    (annotation: any) =>
      annotation.type === 'url_citation' &&
      /^https?:\/\//i.test(annotation.url) &&
      Number.isInteger(annotation.start_index) &&
      Number.isInteger(annotation.end_index) &&
      annotation.start_index >= 0 &&
      annotation.end_index >= annotation.start_index &&
      annotation.end_index <= text.length,
  );
  const numbered = citations.map((annotation: any, index: number) => ({
    ...annotation,
    number: index + 1,
  }));
  for (const citation of numbered.sort(
    (a: any, b: any) => b.end_index - a.end_index,
  )) {
    const url = citation.url.replace(/[\s()<>\\]/g, (character: string) =>
      encodeURIComponent(character),
    );
    const marker = text.slice(citation.start_index, citation.end_index);
    const start = marker.startsWith('')
      ? citation.start_index
      : citation.end_index;
    text =
      text.slice(0, start) +
      ` [${citation.number}](${url})` +
      text.slice(citation.end_index);
  }
  return text;
}

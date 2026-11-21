import type { dsnBomEntry } from '../model/dsnBomEntry';

const field = (text: string) => '"' + text.replaceAll('"', '""') + '"';

export function bomCsv(rows: readonly dsnBomEntry[]): string {
  return (
    'Reference,Quantity,Name\r\n' +
    rows
      .map(({ References, Quantity, Name }) =>
        [field(References.join(',')), Quantity, field(Name)].join(','),
      )
      .join('\r\n')
  );
}

import React, { useMemo, useState } from 'react';
import { Button, Select } from '@fluentui/react-components';
import Papa from 'papaparse';

const separators = [
  { value: ',', label: 'Comma (,)' },
  { value: ';', label: 'Semicolon (;)' },
  { value: '|', label: 'Pipe (|)' },
  { value: '\t', label: 'Tab' },
  { value: '^', label: 'Caret (^)' },
  { value: ':', label: 'Colon (:)' },
  { value: '\x1e', label: 'Record separator' },
  { value: '\x1f', label: 'Unit separator' },
];
const delimitersToGuess = separators.map(({ value }) => value);
const previewRows = 50_000;
const maxPreviewLength = 8 * 1024 * 1024;
const pageSize = 100;

function parseTable(text: string, separator: string) {
  const directive = /^sep=([^\n])\n/i.exec(text);
  const declared = directive && delimitersToGuess.includes(directive[1]);
  const source = declared ? text.slice(directive[0].length) : text;
  let delimiter = separator || (declared ? directive[1] : '');
  let detected = true;
  if (!delimiter) {
    // Blank records should not influence file format detection.
    const sample = Papa.parse<string[]>(source, {
      delimitersToGuess,
      skipEmptyLines: true,
      preview: 10,
    });
    delimiter = sample.meta.delimiter;
    detected = !sample.errors.some(
      ({ code }) => code === 'UndetectableDelimiter',
    );
  }
  const { data, errors, meta } = Papa.parse<string[]>(source, {
    delimiter,
    preview: previewRows + 1,
  });
  if (
    !meta.truncated &&
    source.endsWith('\n') &&
    data.at(-1)?.length === 1 &&
    data.at(-1)[0] === ''
  )
    data.pop();
  return {
    rows: data.slice(0, previewRows),
    delimiter,
    detected,
    invalidQuotes: errors.some(({ type }) => type === 'Quotes'),
    limited: meta.truncated || data.length > previewRows,
  };
}

export default function ProjectDelimitedTable({
  text,
  name,
}: {
  text: string;
  name: string;
}) {
  const [separator, setSeparator] = useState('');
  const [page, setPage] = useState(0);
  const result = useMemo(
    () =>
      text.length <= maxPreviewLength ? parseTable(text, separator) : undefined,
    [text, separator],
  );

  if (!result)
    return (
      <p>
        This file is too large for table preview. Open Source to see the text.
      </p>
    );
  if (!result.rows.length) return <p>This file has no rows.</p>;

  const automatic =
    !separator && result.detected
      ? separators.find(({ value }) => value === result.delimiter)?.label
      : undefined;
  const start = page * pageSize;
  const end = Math.min(start + pageSize, result.rows.length);

  return (
    <div className="project-table-preview">
      <div className="project-preview-actions project-table-controls">
        <label>
          Separator{' '}
          <Select
            value={separator}
            onChange={(_, { value }) => {
              setSeparator(value);
              setPage(0);
            }}
          >
            <option value="">
              {automatic ? `Auto (${automatic})` : 'Auto'}
            </option>
            {separators.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        {result.rows.length > pageSize && (
          <>
            <Button
              size="small"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span aria-live="polite">
              Rows {start + 1}–{end} of {result.rows.length}
            </span>
            <Button
              size="small"
              disabled={end === result.rows.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </>
        )}
      </div>
      {!result.detected && (
        <p>No separator detected. Choose one to split the text into columns.</p>
      )}
      {result.invalidQuotes && (
        <p>Some fields have invalid quotes. Check the source for details.</p>
      )}
      {result.limited && (
        <p>Showing the first {previewRows.toLocaleString()} rows.</p>
      )}
      <div
        className="project-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Delimited data"
      >
        <table aria-label={name}>
          <tbody>
            {result.rows.slice(start, end).map((row, index) => (
              <tr key={start + index}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

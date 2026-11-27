import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';
import ProjectDelimitedTable from './ProjectDelimitedTable';
import type { ProjectDocument } from '../../io/useProjectDocuments';

const ProjectPdfViewer = React.lazy(() => import('./ProjectPdfViewer'));

function ProjectImage({
  bytes,
  mime,
  name,
}: {
  bytes: Uint8Array;
  mime: string;
  name: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    const target = URL.createObjectURL(
      new Blob([new Uint8Array(bytes).buffer], { type: mime }),
    );
    setUrl(target);
    setError(false);
    return () => URL.revokeObjectURL(target);
  }, [bytes, mime]);
  if (error) return <p role="alert">Unable to display this image.</p>;
  return url && <img src={url} alt={name} onError={() => setError(true)} />;
}

type TextDocument = Extract<ProjectDocument, { kind: 'text' }>;

function ProjectTextDocument({
  file,
  onEdit,
}: {
  file: TextDocument;
  onEdit(value: string): void;
}) {
  const [view, setView] = useState<'source' | 'edit' | 'preview'>('source');
  const text =
    file.preview === 'markdown' && view === 'preview' ? file.value : undefined;
  const highlighted = useMemo(() => {
    if (
      view !== 'source' ||
      file.value.length > 200_000 ||
      !file.language ||
      !hljs.getLanguage(file.language)
    )
      return undefined;
    return hljs.highlight(file.value, {
      language: file.language,
      ignoreIllegals: true,
    }).value;
  }, [file.language, file.value, view]);
  const html = useMemo(
    () =>
      text === undefined
        ? ''
        : DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }), {
            USE_PROFILES: { html: true },
            FORBID_TAGS: [
              'form',
              'input',
              'button',
              'style',
              'video',
              'audio',
              'textarea',
              'select',
              'img',
            ],
            FORBID_ATTR: [
              'style',
              'src',
              'href',
              'srcset',
              'id',
              'name',
              'poster',
            ],
          }),
    [text],
  );

  return (
    <>
      <div
        className="project-preview-actions"
        role="group"
        aria-label="Text view"
      >
        <Button
          size="small"
          aria-pressed={view === 'source'}
          onClick={() => setView('source')}
        >
          Source
        </Button>
        <Button
          size="small"
          aria-pressed={view === 'edit'}
          onClick={() => setView('edit')}
        >
          Edit Source
        </Button>
        {file.preview && (
          <Button
            size="small"
            aria-pressed={view === 'preview'}
            onClick={() => setView('preview')}
          >
            {file.preview === 'markdown' ? 'Preview Markdown' : 'View as Table'}
          </Button>
        )}
      </div>
      {view === 'source' && (
        <pre
          className="project-source-preview"
          aria-label={`Source of ${file.name}`}
          tabIndex={0}
        >
          {highlighted === undefined ? (
            <code className="hljs">{file.value}</code>
          ) : (
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          )}
        </pre>
      )}
      {view === 'edit' && (
        <textarea
          aria-label={`Edit ${file.name}`}
          spellCheck={false}
          value={file.value}
          onChange={(event) => onEdit(event.target.value)}
        />
      )}
      {view === 'preview' &&
        (file.preview === 'markdown' ? (
          <article
            className="project-markdown-preview"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <ProjectDelimitedTable text={file.value} name={file.name} />
        ))}
    </>
  );
}

export default function ProjectDocumentEditor({
  file,
  active,
  onEdit,
}: {
  file: ProjectDocument;
  active: boolean;
  onEdit(value: string): void;
}) {
  return (
    <section
      hidden={!active}
      className="project-document-editor"
      role="tabpanel"
      aria-label={file.name}
    >
      {file.kind === 'text' ? (
        <ProjectTextDocument file={file} onEdit={onEdit} />
      ) : (
        active && (
          <div className="project-asset-preview">
            {file.kind === 'image' ? (
              <ProjectImage
                bytes={file.bytes}
                name={file.name}
                mime={file.mime}
              />
            ) : (
              <React.Suspense fallback={<p role="status">Opening PDF…</p>}>
                <ProjectPdfViewer bytes={file.bytes} name={file.name} />
              </React.Suspense>
            )}
          </div>
        )
      )}
    </section>
  );
}

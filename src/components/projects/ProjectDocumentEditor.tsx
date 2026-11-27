import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@fluentui/react-components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
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

export default function ProjectDocumentEditor({
  file,
  active,
  onEdit,
}: {
  file: ProjectDocument;
  active: boolean;
  onEdit(value: string): void;
}) {
  const [preview, setPreview] = useState(false);
  const text =
    file.kind === 'text' && file.markdown && preview ? file.value : undefined;
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
    <section
      hidden={!active}
      className="project-document-editor"
      role="tabpanel"
      aria-label={file.name}
    >
      {file.kind === 'text' ? (
        <>
          {file.markdown && (
            <div className="project-preview-actions">
              <Button
                size="small"
                aria-pressed={preview}
                onClick={() => setPreview(!preview)}
              >
                {preview ? 'Edit Markdown' : 'Preview Markdown'}
              </Button>
            </div>
          )}
          <textarea
            hidden={preview}
            aria-label={`Edit ${file.name}`}
            spellCheck={false}
            value={file.value}
            onChange={(event) => onEdit(event.target.value)}
          />
          {preview && (
            <article
              className="project-markdown-preview"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </>
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

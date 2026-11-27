import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import DOMPurify from 'dompurify';
import { Button, Slider } from '@fluentui/react-components';
import { ZoomInRegular, ZoomOutRegular } from '@fluentui/react-icons';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';
import type { ProjectDocument } from '../../io/useProjectDocuments';
import { SheetTabLabel, SheetTabStrip } from '../toolbar/sheetTabStrip';
import ProjectDelimitedTable, {
  delimitedFormat,
} from './ProjectDelimitedTable';
import {
  TextHistoryCommand,
  useProjectTextHistory,
} from './useProjectTextHistory';

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
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  }>();
  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  }>();
  const [zoom, setZoom] = useState<number>();
  const viewport = useRef<HTMLDivElement>(null);
  const fit =
    imageSize && viewportSize
      ? Math.min(
          1,
          viewportSize.width / imageSize.width,
          viewportSize.height / imageSize.height,
        )
      : 1;
  const scale = zoom === undefined ? fit : zoom / 100;
  const percent = Math.max(1, Math.round(scale * 100));
  const changeZoom = (value: number) =>
    setZoom(Math.max(1, Math.min(400, value)));

  useEffect(() => {
    const target = URL.createObjectURL(
      new Blob([new Uint8Array(bytes).buffer], { type: mime }),
    );
    setUrl(target);
    setError(false);
    setImageSize(undefined);
    return () => URL.revokeObjectURL(target);
  }, [bytes, mime]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setViewportSize({ width, height });
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const view = viewport.current;
    view.scrollLeft = (view.scrollWidth - view.clientWidth) / 2;
    view.scrollTop = (view.scrollHeight - view.clientHeight) / 2;
  }, [scale, imageSize, viewportSize]);

  return (
    <>
      <div
        className="project-image-viewport"
        ref={viewport}
        tabIndex={0}
        aria-label="Image viewport"
      >
        {error && <p role="alert">Unable to display this image.</p>}
        {!error && url && (
          <img
            src={url}
            alt={name}
            onLoad={({ currentTarget }) =>
              setImageSize({
                width: currentTarget.naturalWidth,
                height: currentTarget.naturalHeight,
              })
            }
            onError={() => {
              setError(true);
              setImageSize(undefined);
            }}
            style={
              imageSize && {
                width: imageSize.width * scale,
                height: imageSize.height * scale,
              }
            }
          />
        )}
      </div>
      <div className="project-image-zoom" role="group" aria-label="Image zoom">
        <Button
          size="small"
          appearance="subtle"
          icon={<ZoomOutRegular />}
          title="Zoom out"
          aria-label="Zoom out"
          disabled={!imageSize || percent <= 1}
          onClick={() =>
            changeZoom(Math.min(percent - 1, Math.round(percent / 1.25)))
          }
        />
        <Slider
          size="small"
          min={1}
          max={400}
          value={percent}
          aria-label="Zoom percentage"
          aria-valuetext={`${percent}%`}
          disabled={!imageSize}
          onChange={(_, { value }) => changeZoom(value)}
        />
        <Button
          size="small"
          appearance="subtle"
          icon={<ZoomInRegular />}
          title="Zoom in"
          aria-label="Zoom in"
          disabled={!imageSize || percent >= 400}
          onClick={() =>
            changeZoom(Math.max(percent + 1, Math.round(percent * 1.25)))
          }
        />
        <span className="project-image-zoom-value">{percent}%</span>
        <Button
          size="small"
          appearance="subtle"
          disabled={!imageSize || zoom === undefined}
          onClick={() => setZoom(undefined)}
        >
          Fit
        </Button>
      </div>
    </>
  );
}

type TextDocument = Extract<ProjectDocument, { kind: 'text' }>;
type DocumentView = 'source' | 'preview';
export type ProjectTextEditor = {
  run(command: TextHistoryCommand): void;
  canUndo: boolean;
  canRedo: boolean;
};

function highlightDelimitedText(text: string, name: string) {
  const { delimiter } = delimitedFormat(text, name);
  const separator = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = new RegExp(`"(?:[^"]|"")*(?:"|$)|${separator}`, 'g');
  const parts: React.ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    parts.push(text.slice(end, match.index));
    parts.push(
      <span
        className={match[0] === delimiter ? 'hljs-punctuation' : 'hljs-string'}
        key={match.index}
      >
        {match[0]}
      </span>,
    );
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return parts;
}

function ProjectTextDocument({
  file,
  active,
  editorRef,
  onEdit,
}: {
  file: TextDocument;
  active: boolean;
  editorRef(editor: ProjectTextEditor | null): void;
  onEdit(value: string): void;
}) {
  const markdown = file.preview === 'markdown';
  const [view, setView] = useState<DocumentView>(
    markdown ? 'preview' : 'source',
  );
  const id = useId();
  const mirror = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const initialValue = useRef(file.value);
  const history = useProjectTextHistory(onEdit);
  const runHistory = useRef<ProjectTextEditor['run']>(null);
  runHistory.current = (command) => {
    textarea.current.focus();
    history.run(command, textarea.current);
  };
  const preview = Boolean(file.preview) && view === 'preview';
  const text = active && markdown && preview ? file.value : undefined;
  const tabLabels = markdown
    ? { preview: 'Preview', source: 'Source' }
    : { source: 'Text', preview: 'Table' };
  const tabViews: DocumentView[] = markdown
    ? ['preview', 'source']
    : ['source', 'preview'];

  function handleViewKey(
    event: React.KeyboardEvent<HTMLDivElement>,
    index: number,
  ) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setView(tabViews[index]);
      return;
    }

    let next: number;
    switch (event.key) {
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabViews.length - 1;
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1;
        next = (index + step + tabViews.length) % tabViews.length;
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    event.currentTarget.parentElement
      .querySelectorAll<HTMLElement>('[role="tab"]')
      [next].focus();
    setView(tabViews[next]);
  }

  useLayoutEffect(() => {
    if (!active || preview) return;
    editorRef({
      run: (command) => runHistory.current(command),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
    return () => editorRef(null);
  }, [active, preview, editorRef, history.canUndo, history.canRedo]);

  useLayoutEffect(() => {
    if (textarea.current.value !== file.value) {
      textarea.current.value = file.value;
      history.reset();
    }
  }, [file.value]);

  useLayoutEffect(() => {
    const editor = textarea.current;
    const beforeInput = (event: InputEvent) => history.capture(event, editor);
    editor.addEventListener('beforeinput', beforeInput);
    return () => editor.removeEventListener('beforeinput', beforeInput);
  });

  const highlighted = useMemo(() => {
    if (!active || preview || file.value.length > 200_000) return;
    if (file.language === 'csv')
      return highlightDelimitedText(file.value, file.name);
    if (!file.language || !hljs.getLanguage(file.language)) return;
    return {
      __html: hljs.highlight(file.value, {
        language: file.language,
        ignoreIllegals: true,
      }).value,
    };
  }, [active, preview, file.language, file.name, file.value]);
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
      <div className="project-text-content">
        <div
          className="project-text-editor"
          data-highlighted={highlighted !== undefined}
          hidden={preview}
          id={file.preview ? `${id}-source` : undefined}
          role={file.preview ? 'tabpanel' : undefined}
          aria-labelledby={file.preview ? `${id}-source-tab` : undefined}
        >
          <pre aria-hidden="true" hidden={highlighted === undefined}>
            <code
              ref={mirror}
              className="hljs"
              dangerouslySetInnerHTML={
                Array.isArray(highlighted) ? undefined : highlighted
              }
            >
              {Array.isArray(highlighted) ? highlighted : undefined}
            </code>
          </pre>
          <textarea
            ref={textarea}
            data-project-text-editor
            aria-label={`Edit ${file.name}`}
            wrap="off"
            spellCheck={false}
            defaultValue={initialValue.current}
            onScroll={({ currentTarget }) => {
              const { scrollLeft, scrollTop } = currentTarget;
              mirror.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
            }}
            onKeyDown={(event) => {
              if (
                (!event.ctrlKey && !event.metaKey) ||
                event.altKey ||
                event.nativeEvent.isComposing
              )
                return;
              const key = event.key.toLowerCase();
              if (key !== 'z' && key !== 'y') return;
              event.preventDefault();
              history.run(
                key === 'y' || event.shiftKey ? 'redo' : 'undo',
                event.currentTarget,
              );
            }}
            onInput={(event) =>
              history.record(
                event.nativeEvent as InputEvent,
                event.currentTarget,
                file.value,
              )
            }
          />
        </div>
        {markdown && (
          <article
            className="project-markdown-preview"
            id={`${id}-preview`}
            role="tabpanel"
            aria-labelledby={`${id}-preview-tab`}
            hidden={!preview}
            tabIndex={0}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {file.preview === 'table' && (
          <div
            className="project-table-panel"
            id={`${id}-preview`}
            role="tabpanel"
            aria-labelledby={`${id}-preview-tab`}
            hidden={!preview}
          >
            <ProjectDelimitedTable
              active={active && preview}
              text={file.value}
              name={file.name}
            />
          </div>
        )}
      </div>
      {file.preview && (
        <SheetTabStrip
          tabListLabel={markdown ? 'Markdown view' : 'Delimited file view'}
        >
          {tabViews.map((value, index) => (
            <SheetTabLabel
              key={value}
              label={tabLabels[value]}
              selected={view === value}
              id={`${id}-${value}-tab`}
              role="tab"
              tabIndex={view === value ? 0 : -1}
              aria-selected={view === value}
              aria-controls={`${id}-${value}`}
              onClick={() => setView(value)}
              onKeyDown={(event) => handleViewKey(event, index)}
            />
          ))}
        </SheetTabStrip>
      )}
    </>
  );
}

export default function ProjectDocumentEditor({
  file,
  active,
  editorRef,
  onEdit,
  onPdfPageChange,
}: {
  file: ProjectDocument;
  active: boolean;
  editorRef(editor: ProjectTextEditor | null): void;
  onEdit(value: string): void;
  onPdfPageChange?(page: number): void;
}) {
  return (
    <section
      hidden={!active}
      className={`project-document-editor project-${file.kind}-document`}
      aria-label={file.name}
    >
      {file.kind === 'text' ? (
        <ProjectTextDocument
          file={file}
          active={active}
          editorRef={editorRef}
          onEdit={onEdit}
        />
      ) : file.kind === 'image' ? (
        <ProjectImage bytes={file.bytes} name={file.name} mime={file.mime} />
      ) : (
        active && (
          <div className="project-asset-preview">
            <React.Suspense fallback={<p role="status">Opening PDF…</p>}>
              <ProjectPdfViewer bytes={file.bytes} name={file.name} onPageChange={onPdfPageChange} />
            </React.Suspense>
          </div>
        )
      )}
    </section>
  );
}

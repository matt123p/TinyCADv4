import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, SearchBox, Spinner } from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DocumentRegular,
  ErrorCircleRegular,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { decodeDrawing } from '../../io/dsnCodec';
import {
  hierarchyBrowserModel,
  searchHierarchy,
  type HierarchyDesign,
  type HierarchyNode,
} from '../../io/projectHierarchyBrowser';
import {
  hierarchyDragType,
  projectFilesChanged,
  type HierarchyScan,
} from '../../io/projectStorage';
import { projectRequest } from '../../io/projects';
import { updateFactory } from '../../manipulators/updateFactory';
import type { dsnDrawing } from '../../model/dsnDrawing';
import type { docDrawing } from '../../state/undo/undo';
import { TDrawing } from '../svg/Drawing';

function Preview({ drawing }: { drawing: dsnDrawing }) {
  const sheet = drawing.sheets[0];
  const bounds = sheet.items.reduce((box, item) => {
    const itemBox = updateFactory(item)?.getBoundingRect();
    if (!itemBox) return box;
    return box
      ? {
          x1: Math.min(box.x1, itemBox.x1),
          y1: Math.min(box.y1, itemBox.y1),
          x2: Math.max(box.x2, itemBox.x2),
          y2: Math.max(box.y2, itemBox.y2),
        }
      : itemBox;
  }, undefined as ReturnType<ReturnType<typeof updateFactory>['getBoundingRect']> | undefined);
  if (!bounds) return null;
  const width = Math.max(1, bounds.x2 - bounds.x1);
  const height = Math.max(1, bounds.y2 - bounds.y1);
  const size = Math.max(160, Math.max(width, height) * 1.16);
  return (
    <svg
      aria-hidden="true"
      viewBox={`${bounds.x1 + (width - size) / 2} ${bounds.y1 + (height - size) / 2} ${size} ${size}`}
    >
      <TDrawing
        dx={0}
        dy={0}
        dr={0}
        part={0}
        show_power={false}
        editLibrary={false}
        heterogeneous={false}
        scale_x={1}
        scale_y={1}
        parent={null}
        items={sheet.items}
        selection={[]}
        selected_handle={-1}
        options={sheet.options}
        hover={false}
        hover_obj={null}
        selected={false}
        add={null}
      />
    </svg>
  );
}

interface Props {
  project: string;
  state: docDrawing;
  showActive: boolean;
  canInsert: boolean;
  open(design: HierarchyDesign): Promise<void>;
  insert(id: string): Promise<void>;
  report(error: unknown): void;
}

export default function ProjectHierarchyBrowser({
  project,
  state,
  showActive,
  canInsert,
  open,
  insert,
  report,
}: Props) {
  const { t } = useTranslation();
  const [scan, setScan] = useState<HierarchyScan>();
  const [scanError, setScanError] = useState('');
  const refresh = useRef<() => void>();
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string>();
  const [candidate, setCandidate] = useState<string>();
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{
    id: string;
    drawing?: dsnDrawing;
    error?: string;
  }>();
  const { tree, active, candidates, limited, placementCycles } = useMemo(
    () => hierarchyBrowserModel(project, scan, state, showActive),
    [
      project,
      scan,
      state.schematicTabs,
      state.altStore.file,
      state.docStore.present.drawing,
      showActive,
    ],
  );
  const searching = !!query.trim();
  const results = useMemo(
    () => searchHierarchy(tree, candidates, query),
    [tree, candidates, query],
  );
  const design = results.candidates.find(({ key }) => key === candidate);
  const wouldCreateCycle = !!design && placementCycles.has(design.key);
  const canPlace = canInsert && !!design?.id && !wouldCreateCycle;
  const previewDrawing =
    design?.drawing ??
    (preview?.id === design?.id ? preview?.drawing : undefined);
  let firstActive: string | undefined;
  let selectedActive: string | undefined;
  function findActive(nodes: HierarchyNode[]) {
    for (const node of nodes) {
      if (!node.cycle && node.design?.key === active.key) {
        firstActive ??= node.key;
        if (selected === node.key) selectedActive = node.key;
      }
      findActive(node.children);
    }
  }
  if (active) findActive(results.tree);
  const activeInstance = selectedActive ?? firstActive;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let current = true;
    let running = false;
    let queued = false;
    function requestScan() {
      queued = true;
      if (running) return;
      running = true;
      setLoading(true);
      setScanError('');
      void (async () => {
        while (current && queued) {
          queued = false;
          try {
            const result = await projectRequest({
              operation: 'scan-project-hierarchy',
              project,
            });
            if (current) {
              setScan(result);
              setScanError('');
            }
          } catch (error) {
            if (current) setScanError(String(error));
          }
        }
        running = false;
        if (current) setLoading(false);
      })();
    }
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(requestScan, 350);
    };
    refresh.current = requestScan;
    requestScan();
    const unsubscribe = window.electronAPI.onProjectFoldersChanged(changed);
    window.addEventListener('focus', changed);
    window.addEventListener(projectFilesChanged, changed);
    return () => {
      current = false;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', changed);
      window.removeEventListener(projectFilesChanged, changed);
    };
  }, [project]);

  const previewId = design?.id;
  useEffect(() => {
    if (!previewId || design?.drawing) return;
    let current = true;
    setPreview(undefined);
    void projectRequest({
      operation: 'read-hierarchical-drawing',
      project,
      filename: previewId,
    })
      .then(({ data }) => decodeDrawing(data))
      .then((drawing) => {
        if (current) setPreview({ id: previewId, drawing });
      })
      .catch((error) => {
        if (current) setPreview({ id: previewId, error: String(error) });
      });
    return () => {
      current = false;
    };
  }, [project, previewId, design?.drawing, scan]);

  function toggle(key: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function rows(nodes: HierarchyNode[]) {
    return (
      <ul>
        {nodes.map((node) => (
          <li key={node.key}>
            <div className="project-hierarchy-row">
              {node.children.length > 0 && !searching ? (
                <Button
                  appearance="subtle"
                  size="small"
                  icon={
                    collapsed.has(node.key) ? (
                      <ChevronRightRegular />
                    ) : (
                      <ChevronDownRegular />
                    )
                  }
                  aria-label={t('projectHierarchy.toggle', {
                    file: node.filename,
                  })}
                  aria-expanded={!collapsed.has(node.key)}
                  onClick={() => toggle(node.key)}
                />
              ) : (
                <span className="project-hierarchy-indent" />
              )}
              {node.cycle ? (
                <div className="project-hierarchy-cycle">
                  <ErrorCircleRegular aria-hidden="true" />
                  <div>
                    <strong>
                      {node.filename}
                      {node.reference && ` (${node.reference})`}
                    </strong>
                    <div>
                      {t('projectHierarchy.cycle', { file: node.design.path })}
                    </div>
                  </div>
                </div>
              ) : (
                <Button
                  appearance="subtle"
                  size="small"
                  disabled={!node.design}
                  title={node.design?.path ?? t('projectHierarchy.unavailable')}
                  aria-current={
                    activeInstance === node.key ? 'location' : undefined
                  }
                  onClick={() => {
                    setSelected(node.key);
                    void open(node.design).catch(report);
                  }}
                >
                  {node.filename || t('projectHierarchy.unavailable')}
                  {node.reference && ` (${node.reference})`}
                </Button>
              )}
            </div>
            {!node.cycle && (node.error || node.issue) && (
              <div className="project-hierarchy-cycle project-hierarchy-link-error" role="note">
                <ErrorCircleRegular aria-hidden="true" />
                <span>{node.error || t(`projectHierarchy.${node.issue}`)}</span>
              </div>
            )}
            {node.children.length > 0 &&
              (searching || !collapsed.has(node.key)) &&
              rows(node.children)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      className="project-hierarchy-browser"
      aria-label={t('projectHierarchy.title')}
    >
      <div className="side-panel-header project-hierarchy-heading">
        <strong>{t('projectHierarchy.title')}</strong>
        <Button
          icon={<ArrowClockwiseRegular />}
          appearance="subtle"
          size="small"
          aria-label={t('projectHierarchy.refresh')}
          title={t('projectHierarchy.refresh')}
          disabled={loading}
          onClick={() => refresh.current?.()}
        />
      </div>
      <div className="project-hierarchy-search">
        <SearchBox
          size="small"
          aria-label={t('projectHierarchy.search')}
          placeholder={t('projectHierarchy.search')}
          dismiss={{ 'aria-label': t('projectHierarchy.clearSearch') }}
          value={query}
          onChange={(_, { value }) => setQuery(value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
            }
          }}
        />
      </div>
      <div className="project-hierarchy-tree">
        {loading && !scan && (
          <Spinner size="tiny" label={t('projectHierarchy.scanning')} />
        )}
        {scanError && <p role="alert">{scanError}</p>}
        {(scan?.limited || limited) && (
          <p role="status">{t('projectHierarchy.limited')}</p>
        )}
        {!!scan?.unreadable && (
          <p role="status">{t('projectHierarchy.unreadable')}</p>
        )}
        {scan?.cacheUnavailable && (
          <p role="status">{t('projectHierarchy.cacheUnavailable')}</p>
        )}
        {results.tree.length
          ? rows(results.tree)
          : !loading &&
            !scanError && (
              <p>
                {t(
                  tree.length
                    ? 'projectHierarchy.noMatches'
                    : active
                    ? 'projectHierarchy.noLinks'
                    : 'projectHierarchy.selectDrawing',
                )}
              </p>
            )}
      </div>
      <section
        className="project-child-designs"
        aria-label={t('projectHierarchy.available')}
      >
        <h3>{t('projectHierarchy.available')}</h3>
        <div className="project-child-design-list">
          <ul>
            {results.candidates.map((entry) => (
              <li key={entry.key}>
                <button
                  className="project-child-design"
                  type="button"
                  title={entry.path}
                  aria-pressed={entry.key === candidate}
                  onClick={() => setCandidate(entry.key)}
                >
                  <DocumentRegular aria-hidden="true" />
                  <span>{entry.filename}</span>
                </button>
              </li>
            ))}
          </ul>
          {!results.candidates.length && !loading && (
            <p role={searching ? 'status' : undefined}>
              {t(
                candidates.length
                  ? 'projectHierarchy.noMatches'
                  : 'projectHierarchy.noCandidates',
              )}
            </p>
          )}
        </div>
        {design && (
          <div className="project-hierarchy-preview">
            {previewDrawing?.sheets[0]?.hierarchicalSymbol ? (
              <button
                type="button"
                draggable={canPlace}
                disabled={!canPlace}
                title={canPlace ? t('library.dragToAdd') : undefined}
                aria-label={t('projectHierarchy.place', {
                  file: design.filename,
                })}
                onClick={() => void insert(design.id).catch(report)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(
                    hierarchyDragType,
                    JSON.stringify({ project, id: design.id }),
                  );
                }}
              >
                <Preview drawing={previewDrawing} />
              </button>
            ) : (
              preview?.error && <p role="alert">{preview.error}</p>
            )}
          </div>
        )}
        {design && (wouldCreateCycle || !design.id) && (
          <p className="project-hierarchy-placement-note">
            {t(
              wouldCreateCycle
                ? 'projectHierarchy.cyclePlacement'
                : 'projectHierarchy.saveToPlace',
            )}
          </p>
        )}
      </section>
    </section>
  );
}

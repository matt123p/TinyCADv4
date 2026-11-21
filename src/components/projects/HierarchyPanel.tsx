import React, { useEffect, useState } from 'react';
import { Button, Select } from '@fluentui/react-components';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { fileOpenProject } from '../../io/files';
import {
  affectedPorts,
  childInterface,
  hierarchyDefinition,
  isChildPlacement,
  refreshPlacement,
} from '../../io/hierarchyDrawing';
import {
  findChildUsages,
  linkedBoardSource,
  readProjectSchematic,
  resolveChild,
} from '../../io/projectHierarchy';
import {
  addProjectSchematic,
  projectFilesChanged,
  readProject,
} from '../../io/projects';
import type { HierarchyFrame } from '../../io/projectStorage';
import { DocActionTypes } from '../../state/actions/docActions';
import { actionSheetSelect } from '../../state/dispatcher/AppDispatcher';
import { activeSheet } from '../../state/stores/docStoreReducer';
import type { docDrawing } from '../../state/undo/undo';
import { BoardPortDialog, SystemConnectionsDialog } from './ProjectSystemDialog';
import type { BoardInterface, SystemConnections } from './ProjectSystemDialog';
import { boardInstanceArtwork, boardInstancePorts, readBoardInterface, reviewProjectSystem } from '../../io/projectSystem';

type Project = Awaited<ReturnType<typeof readProject>>;
type Usages = Awaited<ReturnType<typeof findChildUsages>>;
type Review = {
  placement: string;
  source: NonNullable<ReturnType<typeof activeSheet>>;
  definition: ReturnType<typeof hierarchyDefinition>;
  link: Parameters<typeof refreshPlacement>[1];
  ports: string[];
};

const emptyTrail: readonly HierarchyFrame[] = [];

export default function HierarchyPanel() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const project = useSelector(
    (state: docDrawing) => state.altStore.file.project,
  );
  const saving = useSelector(
    (state: docDrawing) => state.altStore.saveInProgress,
  );
  const drawing = useSelector(
    (state: docDrawing) => state.docStore.present.drawing,
  );
  const sheet = useSelector((state: docDrawing) =>
    activeSheet(state.docStore.present),
  );
  const selectedId = useSelector((state: docDrawing) => {
    const ids = state.docStore.present.view._selected_array;
    return ids.length === 1 ? ids[0] : undefined;
  });
  const editingLibrary = useSelector(
    (state: docDrawing) => !!state.docStore.present.editLibrary,
  );
  const placement =
    selectedId === undefined
      ? undefined
      : sheet?.items.find((item) => item._id === selectedId);
  const child =
    placement && isChildPlacement(placement) ? placement : undefined;
  const boardInstance = child?.hierarchy.boardInstance;
  const systemDrawing = drawing.sheets.some((sheet) =>
    sheet.items.some((item) => isChildPlacement(item) && item.hierarchy.boardInstance),
  );
  const trail = project?.hierarchyTrail ?? emptyTrail;
  const [summary, setSummary] = useState<Project>();
  const [locatorError, setLocatorError] = useState('');
  const [interfaceNotice, setInterfaceNotice] = useState('');
  const [unregistered, setUnregistered] = useState(false);
  const [error, setError] = useState('');
  const [repair, setRepair] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [review, setReview] = useState<Review>();
  const [uses, setUses] = useState<Usages>();
  const [portMapping, setPortMapping] = useState<{
    child: typeof child;
    sheet: typeof sheet;
    board: BoardInterface;
  }>();
  const [systemReview, setSystemReview] = useState<{ drawing: typeof drawing; connections: SystemConnections }>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setError('');
    setLocatorError('');
    setInterfaceNotice('');
    setUnregistered(false);
    setReview(undefined);
    setRepair(false);
    setReplacement('');
    setSummary(undefined);
    if (!project || !child) return;
    let current = true;
    (async () => {
      const loaded = await readProject(project.id, project.rootId);
      if (!current) return;
      setSummary(loaded);
      const resolved = await resolveChild(loaded, project, child.hierarchy);
      if (current) setUnregistered(!resolved.entry);
      if (
        current &&
        (resolved.path.toLowerCase() === project.documentPath.toLowerCase() ||
          trail.some((frame) => frame.entryId === resolved.entry?.id))
      )
        throw new Error(t('hierarchy.cycle'));
      try {
        const art = boardInstance
          ? await boardInstanceArtwork(resolved.drawing, linkedBoardSource(loaded, boardInstance.boardId).board)
          : await childInterface(resolved.drawing, resolved.path.split('/').pop());
        if (current && child._symbol.uid !== art.uid)
          setInterfaceNotice(t('hierarchy.interfaceChanged'));
      } catch (reason) {
        if (current) setInterfaceNotice(String(reason));
      }
    })().catch((reason) => {
      if (current) setLocatorError(String(reason));
    });
    return () => {
      current = false;
    };
  }, [project, child, boardInstance, refresh, trail, t]);

  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener(projectFilesChanged, reload);
    return () => window.removeEventListener(projectFilesChanged, reload);
  }, []);

  useEffect(() => {
    setUses(undefined);
  }, [project, drawing]);

  const interfaceIndex = drawing.sheets.findIndex(
    (item) => item.hierarchicalSymbol,
  );
  if (!project || editingLibrary || !sheet) return null;
  const blocked = saving || busy;
  const parent = trail.at(-1);

  const run = async (operation: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await operation();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const open = (
    entryId: string,
    hierarchyTrail: readonly HierarchyFrame[],
    openSheetId?: string,
    openUnitId?: string,
  ) => {
    dispatch(
      fileOpenProject({
        type: 'file-open-project',
        location: {
          id: project.id,
          name: project.name,
          rootId: project.rootId,
          folderId: project.folderId,
          entryId,
          hierarchyTrail,
          openSheetId,
          openUnitId,
        },
      }) as any,
    );
  };

  const frame = (): HierarchyFrame => ({
    entryId: project.entryId,
    sheetId: sheet.id,
    placementId: child.unitId,
    reference:
      child.text.find((item) => item.description === 'Ref')?.value || 'H?',
    name: project.documentPath,
  });

  const enterChild = () =>
    run(async () => {
      const loaded = await readProject(project.id, project.rootId);
      const resolved = await resolveChild(loaded, project, child.hierarchy);
      if (
        resolved.path.toLowerCase() === project.documentPath.toLowerCase() ||
        trail.some((item) => item.entryId === resolved.entry?.id)
      )
        throw new Error(t('hierarchy.cycle'));
      if (!resolved.entry && !unregistered) {
        setUnregistered(true);
        return;
      }
      const entry =
        resolved.entry ??
        (await addProjectSchematic(project, resolved.path, undefined, true));
      const target = resolved.entry
        ? resolved.drawing
        : await readProjectSchematic(
            await readProject(project.id, project.rootId),
            entry,
          );
      const circuit = target.sheets.find(
        (item) => !item.hierarchicalSymbol && item.kind !== 'simulation',
      );
      if (!child.hierarchy.documentId) {
        dispatch({
          type: DocActionTypes.RefreshChild,
          source: sheet,
          placement: child,
          link: { path: entry.path, documentId: entry.id, cached: true },
        });
      }
      open(entry.id, [...trail, frame()], circuit?.id);
    });

  const applyReview = (next: Review) => {
    if (child.unitId !== next.placement || sheet !== next.source) return;
    dispatch({
      type: DocActionTypes.RefreshChild,
      source: sheet,
      placement: child,
      definition: next.definition,
      link: next.link,
    });
    setReview(undefined);
    setRepair(false);
  };

  const reviewChild = (entryId?: string) =>
    run(async () => {
      const loaded = await readProject(project.id, project.rootId);
      const boardLink = boardInstance && linkedBoardSource(loaded, boardInstance.boardId);
      const resolved = entryId || boardLink
        ? await (async () => {
            const entry = boardLink?.source ?? loaded.settings.entries.find(
              (item) => item.kind === 'schematic' && item.id === entryId,
            );
            if (!entry) throw new Error(t('hierarchy.noChild'));
            return {
              path: entry.path,
              entry,
              drawing: await readProjectSchematic(loaded, entry),
            };
          })()
        : await resolveChild(loaded, project, child.hierarchy);
      if (
        resolved.path.toLowerCase() === project.documentPath.toLowerCase() ||
        trail.some((item) => item.entryId === resolved.entry?.id)
      )
        throw new Error(t('hierarchy.cycle'));
      // Keep the v3 locator for an existing file until it is registered in the project.
      const link: Review['link'] = resolved.entry
        ? {
            path: resolved.entry.path,
            documentId: resolved.entry.id,
            cached: true,
          }
        : child.hierarchy;
      const art = boardLink
        ? await boardInstanceArtwork(resolved.drawing, boardLink.board)
        : await childInterface(resolved.drawing, resolved.path.split('/').pop());
      const definition = hierarchyDefinition(sheet, art);
      if (boardInstance) {
        const pins = new Set(boardInstancePorts({ ...child, _symbol: definition }).map(({ id }) => id));
        link.boardInstance = {
          ...boardInstance,
          ports: link.documentId === child.hierarchy.documentId
            ? boardInstance.ports.filter(({ portId }) => pins.has(portId))
            : [],
        };
      }
      const next = refreshPlacement(child, link, definition);
      const candidate = {
        placement: child.unitId,
        source: sheet,
        definition,
        link,
        ports: affectedPorts(sheet, child, next),
      };
      if (candidate.ports.length) setReview(candidate);
      else applyReview(candidate);
    });

  return (
    <section className="hierarchy-panel" aria-label={t('hierarchy.title')}>
      <div className="hierarchy-actions">
        {parent && (
          <>
            <span
              title={[
                ...trail.map((item) => item.name),
                project.documentPath,
              ].join(' / ')}
            >
              {trail.map((item) => item.reference).join(' / ')} ·{' '}
              {project.documentPath}
            </span>
            <Button
              size="small"
              appearance="subtle"
              disabled={blocked}
              onClick={() =>
                open(
                  parent.entryId,
                  trail.slice(0, -1),
                  parent.sheetId,
                  parent.placementId,
                )
              }
            >
              {t('hierarchy.parent')}
            </Button>
          </>
        )}
        {interfaceIndex < 0 ? (
          <Button
            size="small"
            appearance="subtle"
            disabled={blocked || sheet.kind === 'simulation'}
            onClick={() => dispatch({ type: DocActionTypes.AddHierarchySheet })}
          >
            {t('hierarchy.addInterface')}
          </Button>
        ) : (
          !sheet.hierarchicalSymbol && (
            <Button
              size="small"
              appearance="subtle"
              onClick={() => dispatch(actionSheetSelect(interfaceIndex))}
            >
              {t('hierarchy.editInterface')}
            </Button>
          )
        )}
        <Button
          size="small"
          appearance="subtle"
          disabled={blocked}
          onClick={() => {
            void run(async () => {
              setUses(
                uses
                  ? undefined
                  : await findChildUsages(
                      await readProject(project.id, project.rootId),
                      project.documentPath,
                      project.entryId,
                      drawing,
                    ),
              );
            });
          }}
        >
          {t('hierarchy.whereUsed')}
        </Button>
        {systemDrawing && (
          <Button size="small" appearance="subtle" disabled={blocked} onClick={(): void => void run(async () => {
            const loaded = await readProject(project.id, project.rootId);
            const connections = await reviewProjectSystem(loaded, drawing);
            setSystemReview({ drawing, connections });
          })}>
            Review system connections…
          </Button>
        )}
        {child && (
          <>
            <span title={child.hierarchy.path}>
              {boardInstance
                ? summary?.settings.entries.find(({ id }) => id === boardInstance.boardId)?.path ?? 'Board instance'
                : child.hierarchy.path.split(/[/\\]/).pop()}
            </span>
            <Button
              size="small"
              appearance="subtle"
              disabled={blocked}
              onClick={enterChild}
            >
              {boardInstance ? 'Open board source' : t(
                unregistered
                  ? 'hierarchy.registerAndOpen'
                  : 'hierarchy.openChild',
              )}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              disabled={blocked}
              onClick={() => {
                void reviewChild();
              }}
            >
              {boardInstance ? 'Reload board interface' : t('hierarchy.reloadChild')}
            </Button>
            {boardInstance ? (
              <Button size="small" appearance="subtle" disabled={blocked || !!locatorError || !!interfaceNotice}
                onClick={(): void => void run(async () => {
                  const loaded = await readProject(project.id, project.rootId);
                  const board = await readBoardInterface(loaded, boardInstance.boardId);
                  if (board.source.id !== child.hierarchy.documentId)
                    throw new Error('Reload the board interface before mapping its ports.');
                  setPortMapping({ child, sheet, board });
                })}
              >
                Map board ports…
              </Button>
            ) : (
            <Button
              size="small"
              appearance="subtle"
              disabled={blocked || !summary}
              onClick={() => setRepair(!repair)}
            >
              {t('hierarchy.relink')}
            </Button>
            )}
          </>
        )}
      </div>
      {child && (locatorError || interfaceNotice) && (
        <div role="status">{locatorError || interfaceNotice}</div>
      )}
      {error && <div role="alert">{error}</div>}
      {child && boardInstance && portMapping?.child === child && portMapping.sheet === sheet && (
        <BoardPortDialog
          item={child}
          board={portMapping.board}
          onClose={() => setPortMapping(undefined)}
          onApply={(ports) => {
            dispatch({
              type: DocActionTypes.RefreshChild,
              source: sheet,
              placement: child,
              link: { ...child.hierarchy, boardInstance: { ...boardInstance, ports } },
            });
            setPortMapping(undefined);
          }}
        />
      )}
      {systemReview?.drawing === drawing && (
        <SystemConnectionsDialog connections={systemReview.connections} onClose={() => setSystemReview(undefined)} />
      )}
      {child && repair && summary && (
        <div className="hierarchy-actions">
          <Select
            size="small"
            aria-label={t('hierarchy.chooseChild')}
            value={replacement}
            onChange={(_, data) => setReplacement(data.value)}
          >
            <option value="">{t('hierarchy.chooseChild')}</option>
            {summary.settings.entries
              .filter(
                (entry) =>
                  entry.kind === 'schematic' &&
                  entry.id !== project.entryId &&
                  !trail.some((frame) => frame.entryId === entry.id) &&
                  summary.files.has(entry.path),
              )
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.path}
                </option>
              ))}
          </Select>
          <Button
            size="small"
            disabled={!replacement || blocked}
            onClick={() => {
              void reviewChild(replacement);
            }}
          >
            {t('hierarchy.useChild')}
          </Button>
          <Button
            size="small"
            appearance="subtle"
            disabled={blocked}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t('projects.refresh')}
          </Button>
        </div>
      )}
      {review &&
        review.placement === child?.unitId &&
        review.source === sheet && (
          <div className="hierarchy-actions" role="alert">
            <span>
              {t('hierarchy.changedPorts', { ports: review.ports.join(', ') })}
            </span>
            <Button
              size="small"
              disabled={blocked}
              onClick={() => applyReview(review)}
            >
              {t('hierarchy.apply')}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => setReview(undefined)}
            >
              {t('common.cancel')}
            </Button>
          </div>
        )}
      {uses && (
        <ul className="hierarchy-usages">
          {!uses.uses.length && <li>{t('hierarchy.noUses')}</li>}
          {uses.unread.length > 0 && (
            <li role="status">
              {t('hierarchy.unread', { paths: uses.unread.join(', ') })}
            </li>
          )}
          {uses.uses.map((use) => (
            <li key={use.entryId + ':' + use.placementId}>
              <Button
                size="small"
                appearance="subtle"
                disabled={blocked}
                onClick={() =>
                  open(use.entryId, [], use.sheetId, use.placementId)
                }
              >
                {use.path} · {use.sheetName} · {use.reference}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

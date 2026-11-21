import React, { useEffect, useRef, useState } from 'react';
import { useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { encodeDrawing } from '../../io/dsnCodec';
import {
  deleteRecoveryDraft,
  projectRecoveryKey,
  writeRecoveryDraft,
} from '../../io/projectRecovery';
import { linkedSchematicSnapshot, schematicTabDirty } from '../../state/schematicTabs';
import type { SchematicSnapshot } from '../../state/schematicTabs';
import type { docDrawing } from '../../state/undo/undo';

export default function ProjectAutosave() {
  const { t } = useTranslation();
  const store = useStore<docDrawing>();
  const file = useSelector((state: docDrawing) => state.altStore.file.project);
  const account = useSelector(
    (state: docDrawing) => state.altStore.user?.id || '',
  );
  const savedVersion = useSelector(
    (state: docDrawing) => state.altStore.savedVersion,
  );
  const drawingVersion = useSelector(
    (state: docDrawing) => state.docStore.present.drawingVersion,
  );
  const saving = useSelector(
    (state: docDrawing) => state.altStore.saveInProgress,
  );
  const inactive = useSelector((state: docDrawing) => state.schematicTabs?.inactive);
  const recovered = useRef(new WeakSet<SchematicSnapshot>());
  const [status, setStatus] = useState<{ time?: number; failed?: boolean }>();
  const lastWritten = useRef<{ key: string; token: string; version: string }>();
  const dirty = drawingVersion !== savedVersion;

  useEffect(() => {
    setStatus(undefined);
    if (!file || saving) return;
    const key = projectRecoveryKey(account, file);
    if (!dirty) {
      const written = lastWritten.current;
      if (written?.key === key && written.version === file.version) {
        void deleteRecoveryDraft(key, written.token).catch(() => {});
      }
      lastWritten.current = undefined;
      return;
    }
    let current = true;
    const time = Date.now();
    const drawing = store.getState().docStore.present.drawing;
    const matchesEditor = () =>
      current &&
      store.getState().altStore.file.project === file &&
      store.getState().docStore.present.drawingVersion === drawingVersion;
    const id = window.setTimeout(async () => {
      try {
        const data = await encodeDrawing(drawing);
        if (!matchesEditor()) return;
        const token = crypto.randomUUID();
        const written = await writeRecoveryDraft({
          key,
          token,
          sourceVersion: file.version,
          time,
          data,
        });
        if (written)
          lastWritten.current = { key, token, version: file.version };
        if (written && matchesEditor()) setStatus({ time: Date.now() });
        if (!written && matchesEditor()) setStatus({ failed: true });
        const latest = store.getState();
        const latestFile = latest.altStore.file.project;
        if (
          written &&
          latestFile?.id === file.id &&
          latestFile?.entryId === file.entryId &&
          latest.docStore.present.drawingVersion ===
            latest.altStore.savedVersion
        ) {
          await deleteRecoveryDraft(key, token);
        }
      } catch {
        if (matchesEditor()) setStatus({ failed: true });
      }
    }, 750);
    return () => {
      current = false;
      window.clearTimeout(id);
    };
  }, [account, dirty, drawingVersion, file, saving, store]);

  useEffect(() => {
    if (saving) return;
    const timers: number[] = [];
    for (const [tabKey, tab] of Object.entries(inactive ?? {})) {
      const location = tab.file.project;
      if (!location || !schematicTabDirty(tab) || recovered.current.has(tab)) continue;
      const key = projectRecoveryKey(account, location);
      const time = Date.now();
      timers.push(window.setTimeout(async () => {
        try {
          const data = await encodeDrawing(tab.history.present.drawing, undefined, tabKey);
          const current = store.getState();
          if (current.altStore.saveInProgress || current.schematicTabs?.inactive[tabKey] !== tab) return;
          const token = crypto.randomUUID();
          if (!await writeRecoveryDraft({ key, token, sourceVersion: location.version, time, data })) return;
          recovered.current.add(tab);
          const latest = linkedSchematicSnapshot(store.getState(), location.id, location.entryId);
          if (!latest || !schematicTabDirty(latest)) await deleteRecoveryDraft(key, token);
        } catch {
          // Keep the in-memory edit available for a normal Save.
        }
      }, 750));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [account, inactive, saving, store]);

  if (!dirty || saving) return null;
  return (
    <div className="project-autosave" role="status">
      {t(
        status?.failed
          ? 'projects.autosaveFailure'
          : status?.time
          ? 'projects.autosaveReady'
          : 'projects.autosavePending',
        {
          time: status?.time
            ? new Date(status.time).toLocaleTimeString()
            : undefined,
        },
      )}
    </div>
  );
}

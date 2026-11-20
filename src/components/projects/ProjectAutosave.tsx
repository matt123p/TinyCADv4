import React, { useEffect, useRef, useState } from 'react';
import { useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { encodeDrawing } from '../../io/dsnCodec';
import {
  deleteRecoveryDraft,
  projectRecoveryKey,
  writeRecoveryDraft,
} from '../../io/projectRecovery';
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
        if (
          written &&
          store.getState().altStore.file.project === file &&
          store.getState().docStore.present.drawingVersion ===
            store.getState().altStore.savedVersion
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

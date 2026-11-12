import React, { useEffect, useId, useRef, useState } from 'react';
import { useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Field, Radio, RadioGroup, Spinner,
} from '@fluentui/react-components';
import { docDrawing } from '../../state/undo/undo';
import { activeSheet } from '../../state/stores/docStoreReducer';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { DocActionTypes } from '../../state/actions/docActions';
import { LayoutChange, LayoutOptions } from '../../layout/types';

export default function AutoLayoutDialog() {
  const { t } = useTranslation();
  const descriptionId = useId();
  const store = useStore<docDrawing>();
  const sheet = useSelector((state: docDrawing) => activeSheet(state.docStore.present));
  const selectedIds = useSelector((state: docDrawing) => state.docStore.present.view._selected_array);
  const hasSelection = sheet?.items.some((item) =>
    selectedIds.includes(item._id) &&
    ['symbol', 'wire', 'label', 'power', 'noconnect', 'junction'].includes(item.NodeName),
  );
  const [scope, setScope] = useState(hasSelection ? 'selected' : 'whole');
  const [disturbance, setDisturbance] = useState<LayoutOptions['disturbance']>('medium');
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const close = () => {
    worker.current?.terminate();
    worker.current = null;
    store.dispatch(actionCancelDialog());
  };
  const go = () => {
    if (running || !sheet || (scope === 'selected' && !hasSelection)) return;
    const source = sheet;
    setMessage('');
    setRunning(true);
    try {
      // Reuse the worker entry point, with an independent instance for cancellation.
      const job = new Worker(new URL('../../web-worker/main.ts', import.meta.url), { type: 'module' });
      worker.current = job;
      const fail = () => {
        job.terminate();
        worker.current = null;
        setRunning(false);
        setMessage(t('autoLayout.failed'));
      };
      job.onerror = fail;
      job.onmessage = (event: MessageEvent<{
        ok: boolean; data?: { changes: LayoutChange[]; connectivityPreserved: boolean };
      }>) => {
        const result = event.data.data;
        if (!event.data.ok || !result?.connectivityPreserved || !result.changes) {
          fail();
          return;
        }
        job.terminate();
        worker.current = null;
        setRunning(false);
        const current = store.getState().docStore.present;
        if (activeSheet(current) !== source || current.editSymbol || current.editLibrary) {
          setMessage(t('autoLayout.sheetChanged'));
          return;
        }
        if (!result.changes.length) {
          setMessage(t('autoLayout.noChanges'));
          return;
        }
        store.dispatch({ type: DocActionTypes.ApplyAutoLayout, source, changes: result.changes });
        close();
      };
      job.postMessage({
        id: 0,
        command: 'auto-layout',
        payload: {
          sheet: source,
          options: { disturbance, ...(scope === 'selected' ? { selectedIds } : {}) },
        },
      });
    } catch {
      worker.current?.terminate();
      worker.current = null;
      setRunning(false);
      setMessage(t('autoLayout.failed'));
    }
  };

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) close(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('autoLayout.title')}</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p>{t('autoLayout.explanation')}</p>
              <Field label={t('autoLayout.scope')}>
                <RadioGroup aria-label={t('autoLayout.scope')} value={scope} disabled={running}
                  onChange={(_, data) => setScope(data.value)}>
                  <Radio value="whole" label={t('autoLayout.wholeSheet')} />
                  <Radio value="selected" label={t('autoLayout.selectedItems')} disabled={!hasSelection} />
                </RadioGroup>
              </Field>
              <Field label={t('autoLayout.disturbance')}>
                <RadioGroup aria-label={t('autoLayout.disturbance')} value={disturbance} disabled={running}
                  onChange={(_, data) => setDisturbance(data.value as LayoutOptions['disturbance'])}>
                  {[
                    { value: 'high', label: t('autoLayout.high'), description: t('autoLayout.highDescription') },
                    { value: 'medium', label: t('autoLayout.medium'), description: t('autoLayout.mediumDescription') },
                    { value: 'low', label: t('autoLayout.low'), description: t('autoLayout.lowDescription') },
                  ].map((level) => (
                    <div key={level.value}>
                      <Radio value={level.value} label={level.label}
                        aria-describedby={`${descriptionId}-${level.value}`} />
                      <div id={`${descriptionId}-${level.value}`}
                        style={{ marginLeft: 36, marginTop: -4, marginBottom: 8, fontSize: 12, lineHeight: '18px' }}>
                        {level.description}
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </Field>
              <p>{t('autoLayout.undoNote')}</p>
              {running && <Spinner size="small" label={t('autoLayout.running')} />}
              {message && <p role="status">{message}</p>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={running || !sheet || (scope === 'selected' && !hasSelection)} onClick={go}>
              {t('autoLayout.go')}
            </Button>
            <Button appearance="secondary" onClick={close}>{t('common.cancel')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

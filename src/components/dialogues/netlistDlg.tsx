import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  Dropdown,
  Option,
  Spinner,
} from '@fluentui/react-components';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { saveNetlist } from '../../io/files';
import { useDesignExportDestination } from '../controls/useDesignExportDestination';

const formats = [
  'PADS-PCB',
  'PADS-PCB-WITH-VALUE',
  'Eagle SCR',
  'Protel',
  'gEDA PCB',
] as const;
type Format = (typeof formats)[number];

export default function NetlistDialog() {
  const { t } = useTranslation();
  const dispatch = useDispatch<any>();
  const [format, setFormat] = useState<Format>();
  const [busy, setBusy] = useState(false);
  const destination = useDesignExportDestination(format);
  const close = () => dispatch(actionCancelDialog());

  async function save(chooseLocation: boolean) {
    if (busy || !format) return;
    setBusy(true);
    try {
      if (await dispatch(saveNetlist(format, chooseLocation))) close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && !busy && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('dialogues.netlist.title')}</DialogTitle>
          <DialogContent>
            <Dropdown
              disabled={busy}
              placeholder={t('dialogues.netlist.selectOutputFormat')}
              value={format ?? ''}
              selectedOptions={format ? [format] : []}
              onOptionSelect={(_, data) =>
                setFormat(data.optionValue as Format)
              }
            >
              {formats.map((value) => (
                <Option key={value}>{value}</Option>
              ))}
            </Dropdown>
          </DialogContent>
          <DialogActions>
            {busy && <Spinner size="tiny" />}
            {destination && (
              <Button
                appearance="primary"
                title={destination}
                disabled={busy}
                onClick={() => {
                  void save(false);
                }}
              >
                {t('toolbar.save')}
              </Button>
            )}
            <Button
              appearance={destination ? 'secondary' : 'primary'}
              disabled={busy || !format}
              onClick={() => {
                void save(true);
              }}
            >
              {process.env.TARGET_SYSTEM === 'filesystem'
                ? 'Download'
                : t('toolbar.saveAs')}
            </Button>
            <Button disabled={busy} onClick={close}>
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

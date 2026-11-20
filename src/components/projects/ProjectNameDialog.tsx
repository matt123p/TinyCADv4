import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  initialName?: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

export function ProjectNameDialog({
  title,
  initialName = '',
  onCancel,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initialName);
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open) onCancel();
      }}
    >
      <DialogSurface>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
        >
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
              <Field label={t('projects.name')}>
                <Input
                  value={name}
                  onChange={(_, data) => setName(data.value)}
                  autoFocus
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                type="submit"
                disabled={!name.trim()}
              >
                {t('common.ok')}
              </Button>
              <Button onClick={onCancel}>{t('common.cancel')}</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

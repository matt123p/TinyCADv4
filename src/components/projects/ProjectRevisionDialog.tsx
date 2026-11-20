import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import type {
  RevisionChange,
  RevisionInventory,
} from '../../pcb/projectRevisions';

export interface ProjectRevisionComparison {
  before: RevisionInventory;
  after: RevisionInventory;
  changes: RevisionChange[];
}

export function ProjectRevisionDialog({
  comparison,
  onClose,
}: {
  comparison: ProjectRevisionComparison;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { before, after, changes } = comparison;
  return (
    <Dialog
      open
      onOpenChange={(_, { open }) => {
        if (!open) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('projects.compareRevisions')}</DialogTitle>
          <DialogContent>
            <dl style={{ overflowWrap: 'anywhere' }}>
              <dt>{t('projects.baseRevision')}</dt>
              <dd>
                {before.title} · {before.revisionId}
              </dd>
              <dt>{t('projects.selectedRevision')}</dt>
              <dd>
                {after.title} · {after.revisionId}
              </dd>
              {after.parentRevisionId && (
                <>
                  <dt>{t('projects.parentRevision')}</dt>
                  <dd>{after.parentRevisionId}</dd>
                </>
              )}
            </dl>
            {!changes.length ? (
              <p>{t('projects.noEntryChanges')}</p>
            ) : (
              <ul style={{ overflowWrap: 'anywhere' }}>
                {changes.map(({ kind, before, after }) => (
                  <li key={after || before}>
                    {t(`projects.revisionChange.${kind}`, {
                      path: after || before,
                    })}
                    {before && after && before !== after && ` (${before})`}
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('common.close')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

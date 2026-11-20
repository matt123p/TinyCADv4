import React from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { projectFileTitle } from '../../../shared/projectFiles';
import { saveProjectDrawing } from '../../io/projects';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import type { docDrawing } from '../../state/undo/undo';
import { ProjectNameDialog } from './ProjectNameDialog';

export default function ProjectSaveAsDialog({
  omitResults,
}: {
  omitResults?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const store = useStore<docDrawing>();
  const project = useSelector(
    (state: docDrawing) => state.altStore.file.project,
  );
  if (!project) return null;
  const close = () => dispatch(actionCancelDialog());
  return (
    <ProjectNameDialog
      title={t(omitResults ? 'projects.saveWithoutResults' : 'projects.saveAs')}
      initialName={
        projectFileTitle(project.name) +
        (omitResults ? '-without-results' : '-copy')
      }
      onCancel={close}
      onSubmit={(name) => {
        close();
        void saveProjectDrawing(dispatch, store.getState, {
          name,
          folderId: project.folderId,
          omitResults,
        });
      }}
    />
  );
}

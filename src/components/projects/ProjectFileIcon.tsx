import React from 'react';
import {
  BoardRegular, DocumentCode16Regular, DocumentPdfRegular, DocumentRegular,
  DocumentSettingsRegular, DocumentTableRegular, DocumentTextRegular,
  FolderOpenRegular, FolderRegular, ImageRegular, LibraryRegular, PlugConnectedRegular,
} from '@fluentui/react-icons';
import { isBoardFile, isDrawingFile } from '../../../shared/drawingFiles';
import { isProjectFile } from '../../../shared/projectFiles';
import { projectDocumentKind } from '../../io/projectDocumentKind';

export function ProjectFileIcon({ name, folder, expanded }: {
  name: string;
  folder?: boolean;
  expanded?: boolean;
}) {
  const type = projectDocumentKind(name);
  const icon = folder ? (expanded ? FolderOpenRegular : FolderRegular)
    : isDrawingFile(name) ? PlugConnectedRegular
    : isBoardFile(name) ? BoardRegular
    : isProjectFile(name) ? DocumentSettingsRegular
    : /\.(tclib|tplib|tcfootprint\.json)$/i.test(name) ? LibraryRegular
    : type?.kind === 'image' ? ImageRegular
    : type?.kind === 'pdf' ? DocumentPdfRegular
    : /\.(csv|tsv)$/i.test(name) ? DocumentTableRegular
    : /\.(xml|json)$/i.test(name) ? DocumentCode16Regular
    : type?.kind === 'text' ? DocumentTextRegular
    : DocumentRegular;
  const Icon = icon;
  return <Icon aria-hidden="true" />;
}

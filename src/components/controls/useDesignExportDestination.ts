import { useEffect, useState } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import {
  designExportChanged,
  designExportDestination,
  designExportSource,
} from '../../io/designExports';
import type { DesignExportFormat } from '../../io/designExports';
import { projectFilesChanged } from '../../io/projectStorage';

export function useDesignExportDestination(format?: DesignExportFormat) {
  const source = useSelector(designExportSource, shallowEqual);
  const key = JSON.stringify([
    source.project,
    source.account,
    source.drawingId,
    source.draftId,
    source.name,
    format,
  ]);
  const [result, setResult] = useState<{ key: string; path: string | null }>();
  useEffect(() => {
    if (!format) return;
    let active = true;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void designExportDestination({ ...source, format })
        .catch((): null => null)
        .then((path) => {
          if (active && current === revision) setResult({ key, path });
        });
    };
    refresh();
    window.addEventListener(designExportChanged, refresh);
    window.addEventListener(projectFilesChanged, refresh);
    return () => {
      active = false;
      window.removeEventListener(designExportChanged, refresh);
      window.removeEventListener(projectFilesChanged, refresh);
    };
  }, [key]);
  return result?.key === key ? result.path : null;
}

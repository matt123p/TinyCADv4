import React from 'react';

export function LibraryDragPreview({ dataType, getData, enabled = true, effectAllowed, ...props }: {
  dataType: string;
  getData: () => string;
  enabled?: boolean;
  effectAllowed?: DataTransfer['effectAllowed'];
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart'>) {
  return <div {...props} data-library-preview="" draggable={enabled} onDragStart={(event) => {
    event.dataTransfer.setData(dataType, getData());
    if (effectAllowed) event.dataTransfer.effectAllowed = effectAllowed;
  }} />;
}

import React from 'react';
import { PersistentDataGrid } from '../controls/PersistentDataGrid';

export function NetlistGrid<T>(props: React.ComponentProps<typeof PersistentDataGrid<T>>) {
  return <PersistentDataGrid<T> {...props} defaultSortColumn="net" />;
}

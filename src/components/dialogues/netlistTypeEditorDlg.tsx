import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  SpinButton,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Search24Regular } from '@fluentui/react-icons';
import { ColorResult, SketchPicker } from 'react-color';
import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import {
  DEFAULT_NETLIST_TYPE_NAME,
  NetlistTypeDefinition,
  NetlistTypes,
  createDefaultNetlistType,
  dsnDrawing,
  ensureNetlistTypes,
} from '../../model/dsnDrawing';
import { DocItemTypes, dsnJunction, dsnLabel, dsnPower, dsnWire } from '../../model/dsnItem';
import { defaultSheetOption } from '../../io/ioXml';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import {
  actionCancelDialog,
  actionUpdateColoursAllSheets,
  actionUpdateNetlistTypes,
} from '../../state/dispatcher/AppDispatcher';
import { docDrawing } from '../../state/undo/undo';
import {
  EditablePropertyTable,
  PropertyItem,
} from '../controls/EditablePropertyTable';
import { updateLabel } from '../../manipulators/updateLabel';
import { updatePower } from '../../manipulators/updatePower';
import Wire from '../svg/Wire';
import Power from '../svg/Power';
import Label from '../svg/Label';
import Junction from '../svg/Junction';
import { useTranslation } from 'react-i18next';

interface NetlistTypeEditorDialogProps {
  dispatch: Dispatch<any>;
  drawing: dsnDrawing;
}

interface TypeRow {
  id: string;
  originalName: string;
  name: string;
  overrideWireColor: boolean;
  wireColor: string;
  overrideLabelColor: boolean;
  labelColor: string;
  overridePowerColor: boolean;
  powerColor: string;
  wireThickness: string;
  attributes: { [key: string]: string };
}

interface AttributeEditRow {
  id: string;
  name: string;
  value: string;
}

type ColourField = 'wire' | 'label' | 'power';

const emptyNetlist: NetlistData = {
  nets: {},
  nodes: {},
  eprops: {},
  labels: {},
  symbols: [],
};

const previewWireData: dsnWire = {
  NodeName: DocItemTypes.Wire,
  _id: -1,
  d_points: [[0, 0], [250, 0]],
  _magnetic: null as any,
};

const previewWireToLabelData: dsnWire = {
  NodeName: DocItemTypes.Wire,
  _id: -5,
  d_points: [[108, 0], [250, 0]],
  _magnetic: null as any,
};

const previewPowerJunctionData: dsnJunction = {
  NodeName: DocItemTypes.Junction,
  _id: -6,
  point: [246, 56],
};

function createPreviewPower(item: dsnPower): dsnPower {
  return new updatePower(item).post_construction() as dsnPower;
}

function createPreviewLabel(item: dsnLabel): dsnLabel {
  return new updateLabel(item).post_construction() as dsnLabel;
}

const previewPowerData: dsnPower = (() => {
  const item: dsnPower = {
    NodeName: DocItemTypes.Power,
    _id: -2,
    point: [246, 56],
    rotation: 0,
    text: 'power',
    textData: null as any,
    font_name: 'Arial',
    font_size: 10,
    font_bold: false,
    font_italic: false,
    font_colour: '#000000',
    which: 1,
    _magnetic: null as any,
    _no_show: false,
  };
  return createPreviewPower(item);
})();

const previewLabelData: dsnLabel = (() => {
  const item: dsnLabel = {
    NodeName: DocItemTypes.Label,
    _id: -3,
    point: [128, 116],
    rotation: 0,
    text: 'label',
    textData: null as any,
    font_name: 'Arial',
    font_size: 10,
    font_bold: false,
    font_italic: false,
    font_colour: '#000000',
    which: 1,
  };
  return createPreviewLabel(item);
})();

const previewLabelDefaultData: dsnLabel = (() => {
  const item: dsnLabel = {
    NodeName: DocItemTypes.Label,
    _id: -4,
    point: [92, 56],
    rotation: 0,
    text: 'label',
    textData: null as any,
    font_name: 'Arial',
    font_size: 10,
    font_bold: false,
    font_italic: false,
    font_colour: '#000000',
    which: 0,
  };
  return createPreviewLabel(item);
})();

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    height: '70vh',
    minHeight: '420px',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  leftTools: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  tableContainer: {
    flexGrow: 1,
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
    tableLayout: 'auto',
  },
  thead: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  headerCell: {
    padding: '4px 6px',
    textAlign: 'left',
    fontWeight: 600,
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap',
    fontSize: '11px',
  },
  row: {
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowFocused: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  cell: {
    padding: '1px 2px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    verticalAlign: 'middle',
    height: '24px',
  },
  cellFocused: {
    outline: `2px solid ${tokens.colorBrandStroke1}`,
    outlineOffset: '-2px',
  },
  textInput: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '2px 4px',
    fontSize: '12px',
    outline: 'none',
    '&:focus': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  checkboxCell: {
    textAlign: 'center',
  },
  checkbox: {
    cursor: 'pointer',
    width: '14px',
    height: '14px',
  },
  actionButton: {
    minWidth: '24px',
    width: '24px',
    height: '24px',
    padding: '0',
  },
  colourCellButton: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
    padding: '2px 4px',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  swatch: {
    width: '12px',
    height: '12px',
    border: '1px solid #000',
    borderRadius: '2px',
    display: 'inline-block',
    flexShrink: 0,
  },
  notOverridden: {
    color: tokens.colorNeutralForeground3,
  },
  pickerWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    overflowX: 'hidden',
  },
  pickerLayout: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  pickerControls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  fieldSwitch: {
    display: 'flex',
    gap: '6px',
  },
  previewPanel: {
    minWidth: '280px',
    maxWidth: '320px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    boxSizing: 'border-box',
  },
  previewFrame: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    width: '100%',
    height: '220px',
    boxSizing: 'border-box',
  },
  previewLegend: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground2,
  },
  previewLegendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  previewDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
});

const COLS = {
  NAME: 0,
  WIRE: 1,
  LABEL: 2,
  POWER: 3,
  WT: 4,
  ATTRS: 5,
  DUP: 6,
  DEL: 7,
};
const COLUMN_COUNT = 8;

function formatAttributes(attrs: { [key: string]: string }): string {
  return Object.keys(attrs || {})
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${attrs[key]}`)
    .join('; ');
}

function parseNullableNumber(value: string, min: number, fallback: number): number {
  const n = Number((value || '').trim());
  if (Number.isNaN(n)) {
    return fallback;
  }
  return Math.max(min, n);
}

function toRow(name: string, t: NetlistTypeDefinition, index: number): TypeRow {
  const wireThickness =
    t.wireThickness != null && t.wireThickness > 1 ? t.wireThickness : 1;
  return {
    id: `${name}-${index}`,
    originalName: name,
    name: t.name || name,
    overrideWireColor: t.wireColor != null,
    wireColor: t.wireColor || '#0000ff',
    overrideLabelColor: t.labelColor != null,
    labelColor: t.labelColor || '#008020',
    overridePowerColor: t.powerColor != null,
    powerColor: t.powerColor || '#000000',
    wireThickness: String(wireThickness),
    attributes: { ...(t.attributes || {}) },
  };
}

const NetlistTypeEditorDialog: React.FC<NetlistTypeEditorDialogProps> = ({
  dispatch,
  drawing,
}: NetlistTypeEditorDialogProps) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<TypeRow[]>([]);
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const [colourEditor, setColourEditor] = useState<{
    rowId: string;
    field: ColourField;
  } | null>(null);
  const [attributesEditorRowId, setAttributesEditorRowId] = useState<string | null>(
    null,
  );
  const [attributeRows, setAttributeRows] = useState<AttributeEditRow[]>([]);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const types = ensureNetlistTypes(drawing?.netlistTypes);
    const designOptions = drawing?.sheets?.[0]?.options;
    const keys = Object.keys(types).sort();
    setRows(
      keys.map((k, i) => {
        const row = toRow(k, types[k], i);
        if (k === DEFAULT_NETLIST_TYPE_NAME && designOptions) {
          return {
            ...row,
            overrideWireColor: true,
            wireColor: designOptions.color_wire,
            overrideLabelColor: true,
            labelColor: designOptions.color_label,
            overridePowerColor: true,
            powerColor: designOptions.color_power,
            wireThickness: '1',
          };
        }
        return row;
      }),
    );
  }, [drawing?.netlistTypes, drawing?.sheets]);

  const filteredRows = useMemo(() => {
    if (!searchQuery) {
      return rows;
    }
    const q = searchQuery.toLowerCase();
    return rows.filter((r) =>
      [
        r.name,
        r.wireColor,
        r.labelColor,
        r.powerColor,
        r.wireThickness,
        formatAttributes(r.attributes),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, searchQuery]);

  const selectedRowId =
    focusedCell && filteredRows[focusedCell.row]
      ? filteredRows[focusedCell.row].id
      : null;

  const updateRow = useCallback((id: string, patch: Partial<TypeRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const handleAdd = useCallback(() => {
    const nextIndex = rows.length + 1;
    const newRow: TypeRow = toRow(`type_${nextIndex}`, createDefaultNetlistType(), nextIndex);
    newRow.name = `type_${nextIndex}`;
    newRow.originalName = '';
    setRows((prev) => [...prev, newRow]);
  }, [rows.length]);

  const handleDuplicate = useCallback(() => {
    if (!selectedRowId) {
      return;
    }
    const source = rows.find((r) => r.id === selectedRowId);
    if (!source) {
      return;
    }
    const copyIndex = rows.length + 1;
    const copy: TypeRow = {
      ...source,
      id: `${source.name}-copy-${copyIndex}`,
      originalName: '',
      name: `${source.name}_copy`,
    };
    setRows((prev) => [...prev, copy]);
  }, [rows, selectedRowId]);

  const handleDelete = useCallback(() => {
    if (!selectedRowId) {
      return;
    }
    const target = rows.find((row) => row.id === selectedRowId);
    if (!target) {
      return;
    }
    if (target.name === DEFAULT_NETLIST_TYPE_NAME || target.originalName === DEFAULT_NETLIST_TYPE_NAME) {
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== selectedRowId));
    setFocusedCell(null);
  }, [selectedRowId, rows]);

  const navigateCell = useCallback(
    (rowDelta: number, colDelta: number) => {
      setFocusedCell((prev) => {
        if (!prev) {
          return prev;
        }
        let newRow = prev.row + rowDelta;
        let newCol = prev.col + colDelta;

        if (newCol < 0) {
          newCol = COLUMN_COUNT - 1;
          newRow = Math.max(0, newRow - 1);
        } else if (newCol >= COLUMN_COUNT) {
          newCol = 0;
          newRow = Math.min(filteredRows.length - 1, newRow + 1);
        }

        newRow = Math.max(0, Math.min(filteredRows.length - 1, newRow));
        return { row: newRow, col: newCol };
      });
    },
    [filteredRows.length],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLInputElement;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          navigateCell(-1, 0);
          break;
        case 'ArrowDown':
          e.preventDefault();
          navigateCell(1, 0);
          break;
        case 'ArrowLeft':
          if (
            target.type === 'checkbox' ||
            target.tagName === 'BUTTON' ||
            (target.tagName === 'INPUT' && target.selectionStart === 0)
          ) {
            e.preventDefault();
            navigateCell(0, -1);
          }
          break;
        case 'ArrowRight':
          if (
            target.type === 'checkbox' ||
            target.tagName === 'BUTTON' ||
            (target.tagName === 'INPUT' && target.selectionStart === target.value?.length)
          ) {
            e.preventDefault();
            navigateCell(0, 1);
          }
          break;
        case 'Tab':
          e.preventDefault();
          navigateCell(0, e.shiftKey ? -1 : 1);
          break;
        case 'Enter':
          e.preventDefault();
          navigateCell(1, 0);
          break;
      }
    },
    [navigateCell],
  );

  useEffect(() => {
    if (focusedCell && tableRef.current) {
      const cell = document.getElementById(`nt-cell-${focusedCell.row}-${focusedCell.col}`);
      if (cell) {
        const focusable = cell.querySelector('input, button') as HTMLElement;
        if (focusable) {
          focusable.focus();
          if ((focusable as HTMLInputElement).select) {
            (focusable as HTMLInputElement).select();
          }
        }
      }
    }
  }, [focusedCell]);

  const isDefaultRow = (row: TypeRow): boolean =>
    row.originalName === DEFAULT_NETLIST_TYPE_NAME;

  const getDefaultRow = (allRows: TypeRow[]): TypeRow | null => {
    return allRows.find((row) => isDefaultRow(row)) || null;
  };

  const handleSave = () => {
    const assignments = { ...(drawing?.netTypeAssignments || {}) };
    const defaultRow = getDefaultRow(rows);

    const nextTypes: NetlistTypes = {};
    const usedNames = new Set<string>();
    const renameMap: { [oldName: string]: string } = {};

    const uniqueName = (raw: string): string => {
      const base = (raw || '').trim() || 'type';
      if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
      }
      let i = 2;
      while (usedNames.has(`${base}_${i}`)) {
        i++;
      }
      const n = `${base}_${i}`;
      usedNames.add(n);
      return n;
    };

    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i];
      const name = uniqueName(row.name);
      const wireThickness = parseNullableNumber(row.wireThickness, 1, 1);
      const def: NetlistTypeDefinition = {
        name,
        wireColor: row.overrideWireColor ? (row.wireColor || '#0000ff') : null,
        labelColor: row.overrideLabelColor ? (row.labelColor || '#008020') : null,
        powerColor: row.overridePowerColor ? (row.powerColor || '#000000') : null,
        wireThickness: wireThickness > 1 ? wireThickness : null,
        attributes: { ...(row.attributes || {}) },
      };
      nextTypes[name] = def;
      if (row.originalName) {
        renameMap[row.originalName] = name;
      }
    }

    const resolved = ensureNetlistTypes(nextTypes);
    const resolvedNames = new Set(Object.keys(resolved));

    for (const net in assignments) {
      if (!assignments.hasOwnProperty(net)) {
        continue;
      }
      const current = assignments[net];
      const renamed = renameMap[current] || current;
      assignments[net] = resolvedNames.has(renamed)
        ? renamed
        : DEFAULT_NETLIST_TYPE_NAME;
    }

    dispatch(actionUpdateNetlistTypes(emptyNetlist, resolved, assignments));

    if (defaultRow && drawing?.sheets?.[0]?.options) {
      const designColours = drawing.sheets[0].options;
      dispatch(
        actionUpdateColoursAllSheets({
          ...designColours,
          color_wire: defaultRow.wireColor || designColours.color_wire,
          color_label: defaultRow.labelColor || designColours.color_label,
          color_power: defaultRow.powerColor || designColours.color_power,
        }),
      );
    }

    dispatch(actionCancelDialog());
  };

  const currentColourRow = colourEditor
    ? rows.find((row) => row.id === colourEditor.rowId) || null
    : null;
  const currentColourRowIsDefault =
    !!currentColourRow && isDefaultRow(currentColourRow);

  const getColourValue = (row: TypeRow, field: ColourField): string => {
    switch (field) {
      case 'wire':
        return row.wireColor;
      case 'label':
        return row.labelColor;
      case 'power':
        return row.powerColor;
    }
  };

  const getColourOverride = (row: TypeRow, field: ColourField): boolean => {
    switch (field) {
      case 'wire':
        return row.overrideWireColor;
      case 'label':
        return row.overrideLabelColor;
      case 'power':
        return row.overridePowerColor;
    }
  };

  const getDefaultColourValue = (field: ColourField): string => {
    switch (field) {
      case 'wire':
        return defaultSheetOption.color_wire;
      case 'label':
        return defaultSheetOption.color_label;
      case 'power':
        return defaultSheetOption.color_power;
    }
  };

  const getColourPatch = (field: ColourField, colour: string): Partial<TypeRow> => {
    switch (field) {
      case 'wire':
        return { wireColor: colour };
      case 'label':
        return { labelColor: colour };
      case 'power':
        return { powerColor: colour };
    }
  };

  const updateColourEditor = (patch: Partial<TypeRow>) => {
    if (!currentColourRow) {
      return;
    }
    updateRow(currentColourRow.id, patch);
  };

  const handlePickerChange = (colour: ColorResult) => {
    if (!currentColourRow || !colourEditor) {
      return;
    }
    switch (colourEditor.field) {
      case 'wire':
        updateColourEditor({ wireColor: colour.hex, overrideWireColor: true });
        break;
      case 'label':
        updateColourEditor({ labelColor: colour.hex, overrideLabelColor: true });
        break;
      case 'power':
        updateColourEditor({ powerColor: colour.hex, overridePowerColor: true });
        break;
    }
  };

  const handleResetDefaultColour = () => {
    if (!currentColourRow || !colourEditor) {
      return;
    }
    const defaultColour = getDefaultColourValue(colourEditor.field);
    updateColourEditor(getColourPatch(colourEditor.field, defaultColour));
  };

  const handleOverrideChange = (checked: boolean) => {
    if (!currentColourRow || !colourEditor) {
      return;
    }
    if (isDefaultRow(currentColourRow)) {
      return;
    }
    switch (colourEditor.field) {
      case 'wire':
        updateColourEditor({ overrideWireColor: checked });
        break;
      case 'label':
        updateColourEditor({ overrideLabelColor: checked });
        break;
      case 'power':
        updateColourEditor({ overridePowerColor: checked });
        break;
    }
  };

  const handlePickerFieldChange = (field: ColourField) => {
    setColourEditor((prev) => (prev ? { ...prev, field } : prev));
  };

  const openAttributesEditor = (row: TypeRow) => {
    const keys = Object.keys(row.attributes || {}).sort((a, b) =>
      a.localeCompare(b),
    );
    setAttributeRows(
      keys.map((key, index) => ({
        id: `${key}-${index}`,
        name: key,
        value: row.attributes[key] || '',
      })),
    );
    setAttributesEditorRowId(row.id);
  };

  const attributesPropertyItems: PropertyItem[] = useMemo(
    () =>
      attributeRows.map((row) => ({
        id: row.id,
        name: row.name,
        value: row.value,
        show: true,
        editable: true,
        deletable: true,
      })),
    [attributeRows],
  );

  const nextAttributeName = (existingNames: string[]): string => {
    const used = new Set(existingNames);
    if (!used.has('attr')) {
      return 'attr';
    }
    let idx = 2;
    while (used.has(`attr_${idx}`)) {
      idx++;
    }
    return `attr_${idx}`;
  };

  const saveAttributesEditor = () => {
    if (!attributesEditorRowId) {
      return;
    }
    const attrs: { [key: string]: string } = {};
    for (let i = 0; i < attributeRows.length; ++i) {
      const row = attributeRows[i];
      const key = (row.name || '').trim();
      if (!key) {
        continue;
      }
      attrs[key] = row.value || '';
    }
    updateRow(attributesEditorRowId, { attributes: attrs });
    setAttributesEditorRowId(null);
    setAttributeRows([]);
  };

  const activeColourField: ColourField = colourEditor?.field || 'wire';

  const currentEditorColour =
    currentColourRow
      ? getColourValue(currentColourRow, activeColourField)
      : null;
  const currentEditorDefaultColour = getDefaultColourValue(activeColourField);
  const isCurrentEditorDefault =
    !!currentEditorColour &&
    !!currentEditorDefaultColour &&
    currentEditorColour.toLowerCase() === currentEditorDefaultColour.toLowerCase();

  const getEffectivePreviewColour = (row: TypeRow, field: ColourField): string => {
    if (isDefaultRow(row) || getColourOverride(row, field)) {
      return getColourValue(row, field);
    }
    return getDefaultColourValue(field);
  };

  const previewWireColour = currentColourRow
    ? getEffectivePreviewColour(currentColourRow, 'wire')
    : defaultSheetOption.color_wire;
  const previewLabelColour = currentColourRow
    ? getEffectivePreviewColour(currentColourRow, 'label')
    : defaultSheetOption.color_label;
  const previewPowerColour = currentColourRow
    ? getEffectivePreviewColour(currentColourRow, 'power')
    : defaultSheetOption.color_power;
  const previewWireThickness = parseNullableNumber(
    currentColourRow?.wireThickness || '1',
    1,
    1,
  );

  return (
    <>
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface style={{ width: '900px', maxWidth: '96vw' }}>
        <DialogBody>
          <DialogTitle>{t('dialogues.netlistTypeEditor.title')}</DialogTitle>
          <DialogContent>
            <div className={styles.container}>
              <div className={styles.toolbar}>
                <div className={styles.leftTools}>
                  <Text>{t('dialogues.netlistTypeEditor.typesCount', { count: filteredRows.length })}</Text>
                  <Button size="small" appearance="primary" onClick={handleAdd}>
                    {t('common.add')}
                  </Button>
                  <Button
                    size="small"
                    appearance="secondary"
                    onClick={handleDuplicate}
                    disabled={!selectedRowId}
                  >
                    {t('dialogues.netlistTypeEditor.duplicate')}
                  </Button>
                  <Button
                    size="small"
                    appearance="secondary"
                    onClick={handleDelete}
                    disabled={!selectedRowId || !!rows.find((r) => r.id === selectedRowId && (r.name === DEFAULT_NETLIST_TYPE_NAME || r.originalName === DEFAULT_NETLIST_TYPE_NAME))}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
                <Input
                  placeholder={t('panel.common.search')}
                  size="small"
                  contentAfter={<Search24Regular />}
                  value={searchQuery}
                  onChange={(_, data) => setSearchQuery(data.value)}
                  style={{ width: '240px' }}
                />
              </div>

              <div className={styles.tableContainer}>
                <table className={styles.table} ref={tableRef}>
                  <thead className={styles.thead}>
                    <tr>
                      <th className={styles.headerCell}>{t('dialogues.netlistTypeEditor.netlistTypeName')}</th>
                      <th className={styles.headerCell}>{t('dialogues.netlistTypeEditor.wireColour')}</th>
                      <th className={styles.headerCell}>{t('dialogues.netlistTypeEditor.labelColour')}</th>
                      <th className={styles.headerCell}>{t('dialogues.netlistTypeEditor.powerColour')}</th>
                      <th className={styles.headerCell}>{t('dialogues.netlistTypeEditor.wireThickness')}</th>
                      <th className={styles.headerCell}>{t('dialogues.netlistTypeEditor.attributes')}</th>
                      <th className={styles.headerCell}>{t('dialogues.netlistTypeEditor.duplicate')}</th>
                      <th className={styles.headerCell}>{t('common.delete')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, rowIndex) => {
                      const isFocusedRow = focusedCell?.row === rowIndex;
                      const isDefaultType = isDefaultRow(row);
                      const cellClass = (col: number) =>
                        `${styles.cell} ${
                          isFocusedRow && focusedCell?.col === col ? styles.cellFocused : ''
                        }`;

                      return (
                        <tr key={row.id} className={`${styles.row} ${isFocusedRow ? styles.rowFocused : ''}`}>
                          <td id={`nt-cell-${rowIndex}-${COLS.NAME}`} className={cellClass(COLS.NAME)}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                className={styles.textInput}
                                type="text"
                                value={row.name}
                                readOnly={isDefaultType}
                                title={
                                  isDefaultType
                                    ? t('dialogues.netlistTypeEditor.defaultCannotRename')
                                    : undefined
                                }
                                onChange={(e) => updateRow(row.id, { name: e.target.value })}
                                onFocus={() => setFocusedCell({ row: rowIndex, col: COLS.NAME })}
                                onKeyDown={handleKeyDown}
                              />
                              {isDefaultType ? (
                                <span title={t('dialogues.netlistTypeEditor.defaultCannotRename')}>🔒</span>
                              ) : null}
                            </div>
                          </td>
                          <td id={`nt-cell-${rowIndex}-${COLS.WIRE}`} className={cellClass(COLS.WIRE)}>
                            <button
                              className={styles.colourCellButton}
                              onClick={() => setColourEditor({ rowId: row.id, field: 'wire' })}
                              onFocus={() => setFocusedCell({ row: rowIndex, col: COLS.WIRE })}
                              onKeyDown={handleKeyDown}
                            >
                              {isDefaultType || row.overrideWireColor ? (
                                <>
                                  <span
                                    className={styles.swatch}
                                    style={{ backgroundColor: row.wireColor }}
                                  />
                                </>
                              ) : (
                                <span className={styles.notOverridden}>--</span>
                              )}
                            </button>
                          </td>
                          <td id={`nt-cell-${rowIndex}-${COLS.LABEL}`} className={cellClass(COLS.LABEL)}>
                            <button
                              className={styles.colourCellButton}
                              onClick={() => setColourEditor({ rowId: row.id, field: 'label' })}
                              onFocus={() => setFocusedCell({ row: rowIndex, col: COLS.LABEL })}
                              onKeyDown={handleKeyDown}
                            >
                              {isDefaultType || row.overrideLabelColor ? (
                                <>
                                  <span
                                    className={styles.swatch}
                                    style={{ backgroundColor: row.labelColor }}
                                  />
                                </>
                              ) : (
                                <span className={styles.notOverridden}>--</span>
                              )}
                            </button>
                          </td>
                          <td id={`nt-cell-${rowIndex}-${COLS.POWER}`} className={cellClass(COLS.POWER)}>
                            <button
                              className={styles.colourCellButton}
                              onClick={() => setColourEditor({ rowId: row.id, field: 'power' })}
                              onFocus={() => setFocusedCell({ row: rowIndex, col: COLS.POWER })}
                              onKeyDown={handleKeyDown}
                            >
                              {isDefaultType || row.overridePowerColor ? (
                                <>
                                  <span
                                    className={styles.swatch}
                                    style={{ backgroundColor: row.powerColor }}
                                  />
                                </>
                              ) : (
                                <span className={styles.notOverridden}>--</span>
                              )}
                            </button>
                          </td>
                          <td id={`nt-cell-${rowIndex}-${COLS.WT}`} className={cellClass(COLS.WT)}>
                            <SpinButton
                              style={{ width: '70px' }}
                              value={Number(row.wireThickness) || 1}
                              displayValue={row.wireThickness}
                              min={1}
                              max={64}
                              step={1}
                              onChange={(e, data) =>
                                updateRow(row.id, {
                                  wireThickness: String(
                                    Math.min(64, Math.max(1, data.value ?? 1)),
                                  ),
                                })
                              }
                              onFocus={() => setFocusedCell({ row: rowIndex, col: COLS.WT })}
                              onKeyDown={handleKeyDown}
                              disabled={isDefaultType}
                            />
                          </td>
                          <td id={`nt-cell-${rowIndex}-${COLS.ATTRS}`} className={cellClass(COLS.ATTRS)}>
                            <Button
                              size="small"
                              appearance="subtle"
                              style={{ width: '100%', justifyContent: 'flex-start' }}
                              onClick={() => openAttributesEditor(row)}
                              onFocus={() => setFocusedCell({ row: rowIndex, col: COLS.ATTRS })}
                              onKeyDown={handleKeyDown}
                            >
                              {Object.keys(row.attributes || {}).length > 0
                                ? formatAttributes(row.attributes)
                                : '--'}
                            </Button>
                          </td>
                          <td id={`nt-cell-${rowIndex}-${COLS.DUP}`} className={`${cellClass(COLS.DUP)} ${styles.checkboxCell}`}>
                            <Button
                              size="small"
                              appearance="subtle"
                              className={styles.actionButton}
                              onClick={() => {
                                setFocusedCell({ row: rowIndex, col: COLS.DUP });
                                const copy: TypeRow = {
                                  ...row,
                                  id: `${row.name}-copy-inline-${Date.now()}`,
                                  originalName: '',
                                  name: `${row.name}_copy`,
                                };
                                setRows((prev) => [...prev, copy]);
                              }}
                              onKeyDown={handleKeyDown}
                            >
                              ⧉
                            </Button>
                          </td>
                          <td id={`nt-cell-${rowIndex}-${COLS.DEL}`} className={`${cellClass(COLS.DEL)} ${styles.checkboxCell}`}>
                            <Button
                              size="small"
                              appearance="subtle"
                              className={styles.actionButton}
                              disabled={isDefaultType}
                              onClick={() => {
                                setFocusedCell({ row: rowIndex, col: COLS.DEL });
                                if (isDefaultType) {
                                  return;
                                }
                                setRows((prev) => prev.filter((x) => x.id !== row.id));
                              }}
                              onKeyDown={handleKeyDown}
                            >
                              ×
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={handleSave}>
              {t('common.ok')}
            </Button>
            <Button appearance="secondary" onClick={() => dispatch(actionCancelDialog())}>
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
    {colourEditor && currentColourRow ? (
      <Dialog open={true} onOpenChange={() => setColourEditor(null)}>
        <DialogSurface style={{ width: '640px', maxWidth: '96vw' }}>
          <DialogBody>
            <DialogTitle>
              {t('dialogues.netlistTypeEditor.editColour', {
                field: activeColourField === 'wire'
                  ? t('toolbar.wire')
                  : activeColourField === 'label'
                    ? t('toolbar.label')
                    : t('toolbar.power'),
              })}
            </DialogTitle>
            <DialogContent>
              <div className={styles.pickerWrap}>
                <div className={styles.fieldSwitch}>
                  <Button
                    size="small"
                    appearance={activeColourField === 'wire' ? 'primary' : 'secondary'}
                    onClick={() => handlePickerFieldChange('wire')}
                  >
                    {t('toolbar.wire')}
                  </Button>
                  <Button
                    size="small"
                    appearance={activeColourField === 'label' ? 'primary' : 'secondary'}
                    onClick={() => handlePickerFieldChange('label')}
                  >
                    {t('toolbar.label')}
                  </Button>
                  <Button
                    size="small"
                    appearance={activeColourField === 'power' ? 'primary' : 'secondary'}
                    onClick={() => handlePickerFieldChange('power')}
                  >
                    {t('toolbar.power')}
                  </Button>
                </div>
                <div className={styles.pickerLayout}>
                  <div className={styles.pickerControls}>
                    <Checkbox
                      label={t('dialogues.netlistTypeEditor.overrideColour')}
                      checked={
                        currentColourRowIsDefault
                          ? true
                          : getColourOverride(currentColourRow, activeColourField)
                      }
                      onChange={(_, data) => handleOverrideChange(!!data.checked)}
                      disabled={currentColourRowIsDefault}
                    />
                    {currentColourRowIsDefault ? (
                      <Text size={200}>{t('dialogues.netlistTypeEditor.appliesToDesignDefaults')}</Text>
                    ) : null}
                    <SketchPicker
                      disableAlpha={true}
                      color={getColourValue(currentColourRow, activeColourField)}
                      onChange={handlePickerChange}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        appearance="subtle"
                        onClick={handleResetDefaultColour}
                        disabled={isCurrentEditorDefault}
                      >
                        {t('dialogues.netlistTypeEditor.resetToDefault')}
                      </Button>
                    </div>
                  </div>
                  <div className={styles.previewPanel}>
                    <Text weight="semibold" size={300}>{t('dialogues.netlistTypeEditor.preview')}</Text>
                    <svg viewBox="0 0 320 220" className={styles.previewFrame}>
                      <g>
                        <Wire
                          dx={20}
                          dy={56}
                          dr={0}
                          scale_x={1}
                          scale_y={1}
                          data={previewWireData}
                          color={previewWireColour}
                          lineWidth={previewWireThickness}
                          hover={false}
                          selected={false}
                          selected_handle={-1}
                        />
                        <Wire
                          dx={20}
                          dy={116}
                          dr={0}
                          scale_x={1}
                          scale_y={1}
                          data={previewWireToLabelData}
                          color={previewWireColour}
                          lineWidth={previewWireThickness}
                          hover={false}
                          selected={false}
                          selected_handle={-1}
                        />
                      </g>
                      <g>
                        <Power
                          dx={0}
                          dy={0}
                          dr={0}
                          scale_x={1}
                          scale_y={1}
                          color={previewPowerColour}
                          parent={previewPowerData}
                          data={previewPowerData}
                          hover={false}
                          selected={false}
                          selected_handle={-1}
                          renderOverride={{ font_colour: previewPowerColour }}
                        />
                        <Junction
                          dx={0}
                          dy={0}
                          dr={0}
                          scale_x={1}
                          scale_y={1}
                          color="black"
                          data={previewPowerJunctionData}
                        />
                      </g>
                      <g>
                        <Label
                          dx={0}
                          dy={0}
                          dr={0}
                          scale_x={1}
                          scale_y={1}
                          data={previewLabelDefaultData}
                          hover={false}
                          selected={false}
                          selected_handle={-1}
                          renderOverride={{ font_colour: previewLabelColour }}
                        />
                        <Label
                          dx={0}
                          dy={0}
                          dr={0}
                          scale_x={1}
                          scale_y={1}
                          data={previewLabelData}
                          hover={false}
                          selected={false}
                          selected_handle={-1}
                          renderOverride={{ font_colour: previewLabelColour }}
                        />
                      </g>
                    </svg>
                    <div className={styles.previewLegend}>
                      <span className={styles.previewLegendItem}>
                        <span
                          className={styles.previewDot}
                          style={{ backgroundColor: previewWireColour }}
                        />
                        {t('toolbar.wire')}
                      </span>
                      <span className={styles.previewLegendItem}>
                        <span
                          className={styles.previewDot}
                          style={{ backgroundColor: previewPowerColour }}
                        />
                        {t('toolbar.power')}
                      </span>
                      <span className={styles.previewLegendItem}>
                        <span
                          className={styles.previewDot}
                          style={{ backgroundColor: previewLabelColour }}
                        />
                        {t('toolbar.label')}
                      </span>
                    </div>
                </div>
              </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => setColourEditor(null)}>
                {t('common.ok')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    ) : null}
    {attributesEditorRowId ? (
      <Dialog open={true} onOpenChange={() => setAttributesEditorRowId(null)}>
        <DialogSurface style={{ width: '760px', maxWidth: '96vw' }}>
          <DialogBody>
            <DialogTitle>{t('dialogues.netlistTypeEditor.editAttributes')}</DialogTitle>
            <DialogContent>
              <div style={{ height: '45vh', minHeight: '240px' }}>
                <EditablePropertyTable
                  title={t('dialogues.netlistTypeEditor.attributes')}
                  showColumn={false}
                  items={attributesPropertyItems}
                  onNameChange={(id, name) =>
                    setAttributeRows((prev) =>
                      prev.map((row) =>
                        row.id === String(id) ? { ...row, name } : row,
                      ),
                    )
                  }
                  onValueChange={(id, value) =>
                    setAttributeRows((prev) =>
                      prev.map((row) =>
                        row.id === String(id) ? { ...row, value } : row,
                      ),
                    )
                  }
                  onShowChange={() => {}}
                  onDelete={(id) =>
                    setAttributeRows((prev) =>
                      prev.filter((row) => row.id !== String(id)),
                    )
                  }
                  onAdd={() =>
                    setAttributeRows((prev) => {
                      const name = nextAttributeName(prev.map((row) => row.name));
                      return [
                        ...prev,
                        {
                          id: `${Date.now()}-${prev.length}`,
                          name,
                          value: '',
                        },
                      ];
                    })
                  }
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={saveAttributesEditor}>
                {t('common.ok')}
              </Button>
              <Button
                appearance="secondary"
                onClick={() => {
                  setAttributesEditorRowId(null);
                  setAttributeRows([]);
                }}
              >
                {t('common.cancel')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    ) : null}
    </>
  );
};

const mapStateToProps = (state: docDrawing) => ({
  drawing: state.docStore.present.drawing,
});

export default connect(mapStateToProps)(NetlistTypeEditorDialog);

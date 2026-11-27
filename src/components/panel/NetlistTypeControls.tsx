import React, { Dispatch, useEffect, useMemo, useState } from 'react';
import { Button, Combobox, Option } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { NetlistData } from '../../io/netlists/netlistGenerator';
import { subscribeNetlist } from '../../io/netlists/netlistSync';
import {
  DEFAULT_NETLIST_TYPE_NAME,
  dsnDrawing,
  ensureNetlistTypes,
} from '../../model/dsnDrawing';
import {
  actionSelectDialog,
  actionUpdateNetlistTypes,
} from '../../state/dispatcher/AppDispatcher';

export function useNetlist() {
  const [netlist, setNetlist] = useState<NetlistData | null>(null);
  useEffect(() => subscribeNetlist(setNetlist), []);
  return netlist;
}

export function useNetlistTypeEditor(
  drawing: dsnDrawing,
  netlist: NetlistData | null,
  dispatch: Dispatch<any>,
) {
  const types = useMemo(
    () => ensureNetlistTypes(drawing.netlistTypes),
    [drawing.netlistTypes],
  );
  const typeNames = useMemo(() => Object.keys(types).sort(), [types]);

  const commitNetType = (net: string, rawTypeName: string) => {
    const name = rawTypeName.trim();
    if (!netlist || !name) {
      return;
    }

    const assignments = drawing.netTypeAssignments;
    const typeExists = Object.prototype.hasOwnProperty.call(types, name);
    if (typeExists && assignments?.[net] === name) {
      return;
    }

    const base = types[DEFAULT_NETLIST_TYPE_NAME];
    const nextTypes = typeExists
      ? types
      : { ...types, [name]: { ...base, name, attributes: { ...base.attributes } } };
    dispatch(actionUpdateNetlistTypes(netlist, nextTypes, { ...assignments, [net]: name }));
  };

  return { typeNames, commitNetType };
}

interface NetlistTypePickerProps {
  value: string;
  typeNames: string[];
  onCommit: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}

export function NetlistTypePicker({
  value,
  typeNames,
  onCommit,
  id,
  className,
  disabled,
}: NetlistTypePickerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (name: string) => {
    setDraft(null);
    if (name.trim() && name.trim() !== value) {
      onCommit(name);
    }
  };

  return (
    <Combobox
      id={id}
      aria-label={id ? undefined : t('panel.wire.netlistType')}
      className={className}
      value={draft ?? value}
      selectedOptions={value ? [value] : []}
      disabled={disabled}
      freeform
      size="small"
      onChange={(event) => setDraft(event.target.value)}
      onOptionSelect={(_, data) => {
        if (data.optionValue) {
          commit(data.optionValue);
        }
      }}
      onBlur={() => {
        if (draft !== null) {
          commit(draft);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.currentTarget.getAttribute('aria-activedescendant')) {
          event.currentTarget.blur();
        }
      }}
    >
      {typeNames.map((name) => (
        <Option key={name} value={name}>
          {name}
        </Option>
      ))}
    </Combobox>
  );
}

export function NetlistTypesButton({
  dispatch,
  className,
}: {
  dispatch: Dispatch<any>;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="small"
      className={className}
      onClick={() => dispatch(actionSelectDialog('netlist_type_editor', null))}
    >
      {t('dialogues.netlistTypeEditor.title')}
    </Button>
  );
}

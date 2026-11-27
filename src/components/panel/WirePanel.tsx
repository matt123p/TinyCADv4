import React, { Dispatch, useMemo } from 'react';
import { Label, Text, makeStyles, useId } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { getCurrentNetlist } from '../../io/netlists/netlistSync';
import { DEFAULT_NETLIST_TYPE_NAME, dsnDrawing } from '../../model/dsnDrawing';
import { DocItemTypes, dsnWire } from '../../model/dsnItem';
import {
  NetlistTypePicker,
  NetlistTypesButton,
  useNetlist,
  useNetlistTypeEditor,
} from './NetlistTypeControls';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'row',
    gap: '10px',
    padding: '8px 10px',
    background: '#fafafa',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'auto',
  },
  title: {
    margin: 0,
    writingMode: 'vertical-rl',
    transform: 'rotate(180deg)',
    padding: '8px 4px',
    borderRadius: '4px',
    background: 'linear-gradient(to bottom, #0078d4 0%, #005a9e 100%)',
    color: 'white',
    fontWeight: 600,
    fontSize: '11px',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '24px',
    minHeight: 'max-content',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
});

interface WirePanelProps {
  wire: dsnWire;
  sheetName: string;
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
}

export function WirePanel({ wire, sheetName, drawing, dispatch }: WirePanelProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const pickerId = useId('wire-netlist-type');
  const publishedNetlist = useNetlist();
  const netlist = useMemo(
    () => publishedNetlist && getCurrentNetlist(drawing),
    [publishedNetlist, drawing],
  );
  const net = useMemo(
    () => Object.keys(netlist?.nets || {}).find((name) =>
      netlist.nets[name].some((node) =>
        node.sheet === sheetName &&
        node.parent?.NodeName === DocItemTypes.Wire &&
        node.parent._id === wire._id,
      ),
    ),
    [netlist, sheetName, wire._id],
  );
  const { typeNames, commitNetType } = useNetlistTypeEditor(drawing, netlist, dispatch);
  const typeName = (net && drawing.netTypeAssignments?.[net]) ||
    wire.net_type || DEFAULT_NETLIST_TYPE_NAME;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{t('panel.wire.propertiesTitle')}</h2>
      <div className={styles.content}>
        <div className={styles.controls}>
          <Label htmlFor={pickerId}>{t('panel.wire.netlistType')}</Label>
          <NetlistTypePicker
            key={net}
            id={pickerId}
            value={typeName}
            typeNames={typeNames}
            onCommit={(name) => commitNetType(net, name)}
            disabled={!net}
          />
          <NetlistTypesButton dispatch={dispatch} />
        </div>
        <Text size={200}>{t('panel.wire.netlistTypeDescription')}</Text>
      </div>
    </div>
  );
}

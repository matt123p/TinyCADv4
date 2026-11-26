import React, { Dispatch, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Checkbox,
  Field,
  Textarea,
  Tab,
  TabList,
  Dropdown,
  Option,
  Button,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import { SpiceFields } from '../controls/SpiceFields';
import { SpiceModelPicker } from './SpiceModelPicker';
import { SymbolFontDefaultsButton, SymbolTextSizePanel } from './SymbolTextSizePanel';
import type { dsnDrawing } from '../../model/dsnDrawing';
import { BUNDLED_SPICE_SYMBOL, MODEL_BINDING, SPICE_ALTERNATE } from '../../simulation/catalogBindings';
import { changeSpiceModel } from '../../simulation/spiceModelCatalog';
import { ArrowResetRegular, PulseRegular } from '@fluentui/react-icons';
import { dsnSymbol } from '../../model/dsnItem';
import { updateSymbol } from '../../manipulators/updateSymbol';
import {
  actionSymbolShowPower,
  actionSymbolValue,
  actionSymbolSpiceProperty,
  actionSymbolName,
  actionSymbolAdd,
  actionSymbolShow,
  actionSymbolDelete,
  actionSymbolPPP,
  actionAllowResize,
  actionResetResize,
} from '../../state/dispatcher/AppDispatcher';
import { TextDisplayMethod } from '../../model/tclib';
import {
  EditablePropertyTable,
  PropertyItem,
} from '../controls/EditablePropertyTable';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    overflow: 'hidden',
    gap: '10px',
    padding: '8px 10px',
    background: '#fafafa',
    boxSizing: 'border-box',
  },
  titleVertical: {
    writingMode: 'vertical-rl',
    transform: 'rotate(180deg)',
    background: 'linear-gradient(to bottom, #0078d4 0%, #005a9e 100%)',
    color: 'white',
    fontWeight: 600,
    fontSize: '11px',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    padding: '8px 4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
  },
  mainContent: {
    display: 'flex',
    flexDirection: 'row',
    flexGrow: 1,
    overflowX: 'auto',
    overflowY: 'hidden',
    minWidth: 0,
    gap: '10px',
  },
  tableSection: {
    flexGrow: 1,
    minWidth: '240px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  optionsSection: {
    width: '360px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    background: 'white',
    borderRadius: '4px',
    padding: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    border: '1px solid #d0d0d0',
  },
  spiceContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    overflowY: 'auto',
    minHeight: 0,
  },
  optionsContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    overflowY: 'auto',
    minHeight: 0,
  },
  tabsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  textSizeSection: {
    width: '504px',
  },
  textSizeContent: {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
  },
  resizeRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4px',
  },
  pppContainer: {
    marginTop: '4px',
  },
});

interface SymbolPanelProps {
  selectedSymbol: dsnSymbol;
  drawing: dsnDrawing;
  sheetId: string;
  isLibraryEditMode: boolean;
  dispatch: Dispatch<any>;
}

// Remember the user's choice across panel unmounts for this application session.
let lastSelectedTab = 'options';

export const SymbolPanel: React.FC<SymbolPanelProps> = ({
  selectedSymbol,
  drawing,
  sheetId,
  isLibraryEditMode,
  dispatch,
}) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [selectedTab, setSelectedTab] = useState(lastSelectedTab);
  const activeTab = isLibraryEditMode && selectedTab === 'textSize' ? 'options' : selectedTab;

  // Build the property items list including Ref as the first row
  const propertyItems: PropertyItem[] = useMemo(() => {
    if (!selectedSymbol) return [];

    const items: PropertyItem[] = [];

    // Add all text properties
    selectedSymbol.text.forEach((v, index) => {
      const isRef = v.description === 'Ref';
      const isSpice = v.description.startsWith('$$SPICE');
      const editable =
        v.description !== 'Name' &&
        v.description !== 'Ref' &&
        v.display === TextDisplayMethod.ShowValueExtra;

      // Skip SPICE properties
      if (isSpice || v.description === BUNDLED_SPICE_SYMBOL || v.description === MODEL_BINDING) return;

      items.push({
        id: index,
        name: v.description,
        value: v.value,
        show: v.show,
        editable: editable,
        deletable: editable,
        isRef: isRef,
      });
    });

    // Sort to put Ref first, then Name, then others
    items.sort((a, b) => {
      if (a.isRef) return -1;
      if (b.isRef) return 1;
      if (a.name === 'Name') return -1;
      if (b.name === 'Name') return 1;
      return 0;
    });

    return items;
  }, [selectedSymbol]);

  const handleNameChange = useCallback(
    (id: string | number, name: string) => {
      dispatch(actionSymbolName(id as number, name));
    },
    [dispatch],
  );

  const handleValueChange = useCallback(
    (id: string | number, value: string) => {
      dispatch(actionSymbolValue(id as number, value));
    },
    [dispatch],
  );

  const handleShowChange = useCallback(
    (id: string | number, show: boolean) => {
      dispatch(actionSymbolShow(id as number));
    },
    [dispatch],
  );

  const handleDelete = useCallback(
    (id: string | number) => {
      dispatch(actionSymbolDelete(id as number));
    },
    [dispatch],
  );

  const handleAdd = useCallback(() => {
    dispatch(actionSymbolAdd());
  }, [dispatch]);

  const handleCheckboxChange = (checked: boolean, name: string) => {
    switch (name) {
      case 'show_power':
        dispatch(actionSymbolShowPower(checked));
        break;
      case 'allow_resize':
        dispatch(actionAllowResize(checked));
        break;
    }
  };

  if (!selectedSymbol) {
    return null;
  }

  const existingSpice = selectedSymbol.text.filter((property) =>
    property.description.startsWith('$$SPICE'),
  );
  const standardSpiceNames = new Set([
    SPICE_ALTERNATE,
    '$$SPICE',
    '$$SPICE_PROLOG',
    '$$SPICE_EPILOG',
    '$$SPICE_PROLOG_PRIORITY',
    '$$SPICE_EPILOG_PRIORITY',
  ]);

  // Check for multi-part symbol
  const updateSymbolHelper = new updateSymbol(selectedSymbol);
  const parts = updateSymbolHelper?.parts();
  let pppDropdown = null;

  if (parts > 1) {
    const options: { key: string; text: string }[] = [];
    for (let i = 0; i < parts; ++i) {
      options.push({
        key: i.toString(),
        text: String.fromCharCode(65 + i),
      });
    }
    pppDropdown = (
      <div className={styles.pppContainer}>
        <Dropdown
          value={String.fromCharCode(65 + selectedSymbol.part)}
          onOptionSelect={(e, data) =>
            dispatch(actionSymbolPPP(data.optionValue as string))
          }
          style={{ width: '100%', minWidth: 0 }}
        >
          {options.map((o) => (
            <Option key={o.key} value={o.key} text={`Part ${o.text}`}>
              {t('panel.common.part')} {o.text}
            </Option>
          ))}
        </Dropdown>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.titleVertical}>
        {t('panel.symbol.propertiesTitle')}
      </div>

      <div className={styles.mainContent}>
        {/* Properties Table */}
        <div className={styles.tableSection}>
          <EditablePropertyTable
            title={t('panel.symbol.properties')}
            items={propertyItems}
            onNameChange={handleNameChange}
            onValueChange={handleValueChange}
            onShowChange={handleShowChange}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        </div>

        {/* Options Section */}
        <div className={mergeClasses(styles.optionsSection, activeTab === 'textSize' && styles.textSizeSection)}>
          <div className={styles.tabsRow}>
            <TabList
              size="small"
              aria-label={t('panel.symbol.propertiesTitle')}
              selectedValue={activeTab}
              onTabSelect={(_, data) => {
                lastSelectedTab = String(data.value);
                setSelectedTab(lastSelectedTab);
              }}
            >
              <Tab value="options">{t('panel.symbol.options')}</Tab>
              {!isLibraryEditMode && <Tab value="textSize">{t('panel.symbol.textSize')}</Tab>}
              <Tab
                value="spice"
                icon={existingSpice.length ? <PulseRegular /> : undefined}
              >
                SPICE
              </Tab>
            </TabList>
            {activeTab === 'textSize' && <SymbolFontDefaultsButton />}
          </div>
          {activeTab === 'options' && (
            <div
              className={styles.optionsContent}
              role="tabpanel"
              aria-label={t('panel.symbol.options')}
            >
              {pppDropdown}

              <Checkbox
                label={t('panel.symbol.showPowerPins')}
                checked={selectedSymbol.show_power}
                onChange={(e, data) =>
                  handleCheckboxChange(!!data.checked, 'show_power')
                }
              />

              <div className={styles.resizeRow}>
                <Checkbox
                  label={t('panel.symbol.allowResize')}
                  checked={selectedSymbol.allow_resize}
                  onChange={(e, data) =>
                    handleCheckboxChange(!!data.checked, 'allow_resize')
                  }
                  style={{ flexGrow: 1 }}
                />
                <Button
                  icon={<ArrowResetRegular />}
                  size="small"
                  appearance="subtle"
                  title={t('panel.symbol.resetSize')}
                  onClick={() => dispatch(actionResetResize())}
                />
              </div>
            </div>
          )}
          {activeTab === 'textSize' && (
            <div className={styles.textSizeContent} role="tabpanel" aria-label={t('panel.symbol.textSize')}>
              <SymbolTextSizePanel />
            </div>
          )}
          {activeTab === 'spice' && (
            <div
              className={styles.spiceContent}
              role="tabpanel"
              aria-label="SPICE"
            >
              <SpiceModelPicker
                key={selectedSymbol._id}
                symbol={selectedSymbol}
                packs={drawing.spiceModelPacks}
                onChange={(selection) => dispatch({
                  type: 'simulation/catalog-model',
                  source: drawing,
                  drawing: changeSpiceModel(drawing, sheetId, selectedSymbol._id, selection),
                })}
              >
                <SpiceFields
                  value={(name) => existingSpice.find((property) => property.description === name)?.value}
                  onChange={(name, value) => dispatch(actionSymbolSpiceProperty(name, value))}
                />
                {existingSpice.filter((property) =>
                  !standardSpiceNames.has(property.description),
                ).map((property) => (
                  <Field key={property.description} label={property.description} size="small">
                    <Textarea
                      size="small"
                      resize="vertical"
                      rows={2}
                      value={property.value}
                      onChange={(_, data) => dispatch(
                        actionSymbolSpiceProperty(property.description, data.value),
                      )}
                    />
                  </Field>
                ))}
              </SpiceModelPicker>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

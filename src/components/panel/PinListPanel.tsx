import React, { useState, Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import {
  makeStyles,
  tokens,
  Tab,
  TabList,
  TabValue,
} from '@fluentui/react-components';
import { dsnDrawing } from '../../model/dsnDrawing';
import EditSymbolPanelContainer from '../../state/containers/editSymbolPanelContainer';
import EditSpicePanelContainer from '../../state/containers/editSpicePanelContainer';
import { PinTable } from './PinTable';
import { PluginSurface, usePlugins } from '../../plugins/components';
import { pluginManager } from '../../plugins/manager';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tabContainer: {
    padding: '0 8px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
  },
  contentContainer: {
    flexGrow: 1,
    overflow: 'hidden',
    position: 'relative',
    padding: '8px',
  },
  panelContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    padding: '8px',
  }
});

interface PinListPanelProps {
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
}

export const PinListPanel: React.FC<PinListPanelProps> = ({
  drawing,
  dispatch,
}) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [selectedTab, setSelectedTab] = useState<TabValue>('symbol');
  usePlugins();
  const tabs = pluginManager.contributions('symbolEditorTabs');
  const pluginTab = tabs.find(tab => tab.item.id === selectedTab);
  const currentTab = pluginTab || ['symbol', 'pins', 'spice'].includes(String(selectedTab)) ? selectedTab : 'symbol';

  return (
    <div className={styles.root}>
      <div className={styles.tabContainer}>
        <TabList selectedValue={currentTab} onTabSelect={(e, data) => setSelectedTab(data.value)}>
          <Tab value="symbol">{t('panel.pinList.symbol')}</Tab>
          <Tab value="pins">{t('panel.pinList.pins')}</Tab>
          <Tab value="spice">{t('panel.pinList.spice')}</Tab>
          {tabs.map(tab => <Tab key={tab.item.id} value={tab.item.id}>{tab.item.title}</Tab>)}
        </TabList>
      </div>
      <div className={styles.contentContainer}>
        {pluginTab && <PluginSurface pluginId={pluginTab.plugin.id} surface={pluginTab.item.surface} />}
        {currentTab === 'symbol' && (
          <div className={styles.panelContent}>
             <EditSymbolPanelContainer />
          </div>
        )}
        {selectedTab === 'pins' && (
          <div className={styles.panelContent}>
            <PinTable drawing={drawing} dispatch={dispatch} />
          </div>
        )}
        {selectedTab === 'spice' && (
          <div className={styles.panelContent}>
             <EditSpicePanelContainer />
          </div>
        )}
      </div>
    </div>
  );
};

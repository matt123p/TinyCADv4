import React, { Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import {
  actionCommand,
  actionBomClose,
  actionCommandWithDefault,
  actionMenuBrowserClose,
  actionSelectDialog,
  actionBomGenerate,
} from '../../state/dispatcher/AppDispatcher';
import {
  Toolbar as FluentToolbar,
  ToolbarButton,
  ToolbarDivider,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  makeStyles,
  tokens,
  mergeClasses,
  MenuDivider,
} from '@fluentui/react-components';
import {
  ArrowUndoRegular,
  ArrowRedoRegular,
  ZoomInRegular,
  ZoomOutRegular,
  ArrowRotateClockwiseRegular,
  ArrowRotateCounterclockwiseRegular,
  FlipHorizontalRegular,
  FlipVerticalRegular,
  SaveRegular,
  DismissRegular,
  ArrowDownloadRegular,
  ChevronDownRegular,
  DocumentAddRegular,
  ImageRegular,
  SettingsRegular,
  DataAreaRegular,
  ShareRegular,
  LibraryRegular,
  FolderOpenRegular,
  SaveCopyRegular,
  QuestionCircleRegular,
  ColorRegular,
  DocumentRegular,
  RulerRegular,
  GlobeRegular,
  CheckmarkRegular,
} from '@fluentui/react-icons';
import { ActionCreators } from 'redux-undo';
import {
  downloadBom,
  fileSave,
  librarySave,
  fileNew,
  fileOpen,
  fileSaveAs,
  librarySaveAs,
  exportPdf,
  exportSvg,
  importSymbolsFromFile,
  handleMenuCommand,
} from '../../io/files';
import { CurrentFile, ToolbarDefaults } from '../../state/stores/altStoreReducer';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import { Coordinate } from '../../model/dsnItem';
import { actionToggleRulers } from '../../state/actions/appActions';
import {
  normalizeLanguageCode,
  persistLanguagePreference,
  SUPPORTED_LANGUAGES,
} from '../../i18n/languages';
import { openCurrentAppUrl, openExternalUrl } from '../../util/navigation';


// Images (ES module imports)
import wireImage from 'url:../../../images/wire.png';
import noConnectImage from 'url:../../../images/no_connect.png';
import power1Image from 'url:../../../images/power0.png';
import power2Image from 'url:../../../images/power1.png';
import power3Image from 'url:../../../images/power2.png';
import power4Image from 'url:../../../images/power3.png';
import power5Image from 'url:../../../images/power4.png';
import label0Image from 'url:../../../images/label0.png';
import label1Image from 'url:../../../images/label1.png';
import label2Image from 'url:../../../images/label2.png';
import label3Image from 'url:../../../images/label3.png';
import textImage from 'url:../../../images/text.png';
import rectangleImage from 'url:../../../images/rectangle.png';
import ellipseImage from 'url:../../../images/ellipse.png';
import lineImage from 'url:../../../images/line.png';
import busImage from 'url:../../../images/bus.png';
import busJunctionImage from 'url:../../../images/bus_junction.png';
import busLabelImage from 'url:../../../images/bus_label.png';
import rulerHImage from 'url:../../../images/ruler_h.png';
import rulerVImage from 'url:../../../images/ruler_v.png';
import pinImage from 'url:../../../images/pin.png';
import discordImage from 'url:../../../images/Discord-Logo-Black.png';

const useStyles = makeStyles({
  toolbarContainer: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgb(230, 230, 230)',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    borderTop: '1px solid white',
  },
  toolbarContent: {
      marginLeft: '-8px', // Shifts content left to reduce gap
      flexGrow: 1,
  },
  highlight: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  imageIcon: {
    width: '18px',
    height: '18px',
  },
  splitButton: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  splitButtonMain: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  splitButtonMainHighlighted: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: tokens.colorBrandBackground2,
  },
  splitButtonMenu: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    minWidth: '24px',
    paddingLeft: '2px',
    paddingRight: '2px',
  },
  spacer: {
    flexGrow: 1,
  },
  divider: {
    backgroundColor: 'transparent',
    border: 'none',
    borderLeft: '2px solid #abbb',
    width: 0,
    height: '24px',
    margin: '0 10px',
    alignSelf: 'center',
    padding: 0,
  }
});

interface ToolbarProps {
  menu_command: string;
  can_undo: boolean;
  can_redo: boolean;
  hover_point?: Coordinate;
  showRulers: boolean;
  can_zoom_out: boolean;
  can_zoom_in: boolean;
  can_paste: boolean;
  can_cut: boolean;
  can_copy: boolean;
  can_rotate: boolean;
  can_flip: boolean;
  selected_sheet: number;
  toolbarDefaults: ToolbarDefaults;
  saveInProgress: boolean;
  saveNeeded: boolean;
  editLibrary: tclib;
  editSymbol: tclibLibraryEntry;
  recentFiles: CurrentFile[];
  dispatch: Dispatch<any>;
}

interface MenuItemConfig {
  key: string;
  text: string;
  image: string;
  command: string;
}

const ImageIcon: React.FC<{ src: string; className?: string }> = ({ src, className }) => (
  <img src={src} width={18} height={18} className={className} alt="" />
);

// Split button with dropdown menu
const SplitMenuButton: React.FC<{
  text: string;
  optionsSuffix: string;
  mainImage: string;
  highlighted: boolean;
  onMainClick: () => void;
  menuItems: MenuItemConfig[];
  onMenuItemClick: (item: MenuItemConfig) => void;
  styles: ReturnType<typeof useStyles>;
}> = ({ text, optionsSuffix, mainImage, highlighted, onMainClick, menuItems, onMenuItemClick, styles }) => {
  return (
    <div className={styles.splitButton}>
      <ToolbarButton
        aria-label={text}
        title={text}
        icon={<ImageIcon src={mainImage} />}
        onClick={onMainClick}
        className={highlighted ? styles.splitButtonMainHighlighted : styles.splitButtonMain}
      />
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton
            aria-label={`${text} ${optionsSuffix}`}
            icon={<ChevronDownRegular />}
            className={styles.splitButtonMenu}
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {menuItems.map((item) => (
              <MenuItem
                key={item.key}
                icon={<ImageIcon src={item.image} />}
                onClick={() => onMenuItemClick(item)}
              >
                {item.text}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
};

export const Toolbar: React.FC<ToolbarProps> = (props) => {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const m = props.menu_command;
  const currentLanguageAbbreviation = normalizeLanguageCode(i18n.language).slice(0, 2).toLowerCase();

  const changeLanguage = (code: string) => {
    persistLanguagePreference(code);
    void i18n.changeLanguage(code);
  };

  // BOM sheet toolbar
  if (props.selected_sheet === -1) {
    return (
      <div className={mergeClasses('toolbar-container', styles.toolbarContainer)}>
        <FluentToolbar>
          <ToolbarButton
            aria-label={t('toolbar.closeBomAria')}
            icon={<DismissRegular />}
            onClick={() => props.dispatch(actionBomClose())}
          >
            {t('toolbar.closeBom')}
          </ToolbarButton>
          <ToolbarButton
            aria-label={t('toolbar.downloadBomAria')}
            icon={<ArrowDownloadRegular />}
            onClick={() => props.dispatch(downloadBom)}
          >
            {t('toolbar.downloadBom')}
          </ToolbarButton>
        </FluentToolbar>
      </div>
    );
  }

  // Browser sheet toolbar
  if (props.selected_sheet < -1) {
    return (
      <div className={mergeClasses('toolbar-container', styles.toolbarContainer)}>
        <FluentToolbar>
          <ToolbarDivider className={styles.divider} />
          <ToolbarButton
            aria-label={t('toolbar.closeHelpAria')}
            icon={<DismissRegular />}
            onClick={() => props.dispatch(actionMenuBrowserClose(-2 - props.selected_sheet))}
          >
            {t('toolbar.close')}
          </ToolbarButton>
        </FluentToolbar>
      </div>
    );
  }

  // Library editor toolbar (no symbol selected)
  if (props.editLibrary && !props.editSymbol) {
    return (
      <div className={mergeClasses('toolbar-container', styles.toolbarContainer)}>
        <FluentToolbar>
          {process.env.TARGET_SYSTEM === 'filesystem' && (
             <ToolbarButton
                aria-label={t('toolbar.open')}
                title={t('toolbar.openLibrary')}
                icon={<FolderOpenRegular />}
                onClick={() => props.dispatch(fileOpen())}
             >
               {t('toolbar.open')}
             </ToolbarButton>
          )}

          <ToolbarButton
            aria-label={t('toolbar.save')}
            title={t('toolbar.saveLibrary')}
            icon={<SaveRegular />}
            disabled={!props.saveNeeded && !props.saveInProgress}
            onClick={() => props.dispatch(librarySave)}
          >
            {t('toolbar.save')}
          </ToolbarButton>

           {process.env.TARGET_SYSTEM === 'filesystem' && (
             <ToolbarButton
                aria-label={t('toolbar.saveAs')}
                title={t('toolbar.saveLibraryAs')}
                icon={<SaveCopyRegular />}
                onClick={() => props.dispatch(librarySaveAs)}
             >
               {t('toolbar.saveAs')}
             </ToolbarButton>
          )}

          <ToolbarButton
            aria-label={t('toolbar.undo')}
            title={t('toolbar.undo')}
            icon={<ArrowUndoRegular />}
            disabled={!props.can_undo}
            onClick={() => props.dispatch(ActionCreators.undo())}
          />
          <ToolbarButton
            aria-label={t('toolbar.redo')}
            title={t('toolbar.redo')}
            icon={<ArrowRedoRegular />}
            disabled={!props.can_redo}
            onClick={() => props.dispatch(ActionCreators.redo())}
          />
        </FluentToolbar>
      </div>
    );
  }

  // Normal editor toolbar
  if (props.selected_sheet < 0) {
    return null;
  }

  // Power menu items
  const powerItems: MenuItemConfig[] = [
    { key: 'add_power0', text: t('toolbar.powerBar'), image: power1Image, command: 'add_power0' },
    { key: 'add_power1', text: t('toolbar.powerCircle'), image: power2Image, command: 'add_power1' },
    { key: 'add_power2', text: t('toolbar.powerWave'), image: power3Image, command: 'add_power2' },
    { key: 'add_power3', text: t('toolbar.powerArrow'), image: power4Image, command: 'add_power3' },
    { key: 'add_power4', text: t('toolbar.powerEarth'), image: power5Image, command: 'add_power4' },
  ];

  // Label menu items
  const labelItems: MenuItemConfig[] = [
    { key: 'add_label0', text: t('toolbar.labelStandard'), image: label0Image, command: 'add_label0' },
    { key: 'add_label1', text: t('toolbar.labelInput'), image: label1Image, command: 'add_label1' },
    { key: 'add_label2', text: t('toolbar.labelOutput'), image: label2Image, command: 'add_label2' },
    { key: 'add_label3', text: t('toolbar.labelIO'), image: label3Image, command: 'add_label3' },
  ];

  // Shape menu items
  const shapeItems: MenuItemConfig[] = [
    { key: 'add_rectangle', text: t('toolbar.rectangle'), image: rectangleImage, command: 'add_rectangle' },
    { key: 'add_ellipse', text: t('toolbar.ellipse'), image: ellipseImage, command: 'add_ellipse' },
    { key: 'add_line', text: t('toolbar.line'), image: lineImage, command: 'add_line' },
  ];

  // Bus menu items
  const busItems: MenuItemConfig[] = [
    { key: 'add_bus', text: t('toolbar.bus'), image: busImage, command: 'add_bus' },
    { key: 'add_bus_junction', text: t('toolbar.busConnection'), image: busJunctionImage, command: 'add_bus_junction' },
    { key: 'add_bus_label', text: t('toolbar.label'), image: busLabelImage, command: 'add_bus_label' },
  ];

  // Ruler menu items
  const rulerItems: MenuItemConfig[] = [
    { key: 'add_hruler', text: t('toolbar.horzRuler'), image: rulerHImage, command: 'add_hruler' },
    { key: 'add_vruler', text: t('toolbar.vertRuler'), image: rulerVImage, command: 'add_vruler' },
  ];

  const handleMenuItemClick = (context: string) => (item: MenuItemConfig) => {
    props.dispatch(actionCommandWithDefault(context, { 
      key: item.key,
      iconProps: { imageProps: { src: item.image } }
    }, item.command));
  };

  return (
    <div className={mergeClasses('toolbar-container', styles.toolbarContainer)}>
      <FluentToolbar className={styles.toolbarContent}>
        {/* File Menu */}
        {process.env.TARGET_SYSTEM !== 'electron' && (
         <Menu>
          <MenuTrigger disableButtonEnhancement>
            <ToolbarButton icon={<DocumentRegular />} aria-label={t('toolbar.file')} title={t('toolbar.fileMenu')} />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              { process.env.TARGET_SYSTEM === 'filesystem' && (
                  <MenuItem icon={<FolderOpenRegular />} onClick={() => props.dispatch(fileOpen())}>
                    {t('toolbar.open')}
                  </MenuItem>
              )}
              <MenuItem icon={<ImageRegular />} onClick={() => props.dispatch(exportSvg)}>
                {t('toolbar.exportSvg')}
              </MenuItem>
              <MenuItem icon={<SaveCopyRegular />} onClick={() => props.dispatch(exportPdf)}>
                {t('toolbar.exportPdf')}
              </MenuItem>
              <MenuItem icon={<ArrowDownloadRegular />} onClick={() => props.dispatch(importSymbolsFromFile() as any)}>
                {t('toolbar.importKicad')}
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<SettingsRegular />} onClick={() => props.dispatch(actionSelectDialog('annotate', null))}>
                {t('toolbar.annotateSymbols')}
              </MenuItem>
              <MenuItem icon={<DataAreaRegular />} onClick={() => props.dispatch(actionBomGenerate())}>
                {t('toolbar.billOfMaterials')}
              </MenuItem>
              <MenuItem icon={<ShareRegular />} onClick={() => props.dispatch(actionSelectDialog('netlist', null))}>
                {t('toolbar.generateNetlist')}
              </MenuItem>
              <MenuItem icon={<ShareRegular />} onClick={() => props.dispatch(handleMenuCommand('tools-spice'))}>
                {t('toolbar.generateSpiceNetlist')}
              </MenuItem>
              <MenuDivider />
              {/* New Custom Library */}
               <MenuItem icon={<LibraryRegular />} onClick={() => {
                  const qp = new URLSearchParams();
                  qp.set('action', 'new-library');
                openCurrentAppUrl(qp);
               }}>
               {t('toolbar.newCustomLibrary')}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        )}

        { !props.editLibrary && process.env.TARGET_SYSTEM !== 'electron' && <ToolbarButton
          aria-label={t('toolbar.newDesign')}
          title={t('toolbar.newDesign')}
          icon={<DocumentAddRegular />}
          onClick={() => props.dispatch(fileNew())}
        />} 
        
        { !props.editLibrary && process.env.TARGET_SYSTEM === 'electron' && <ToolbarButton
          aria-label={t('toolbar.newDesign')}
          title={t('toolbar.newDesign')}
          icon={<DocumentAddRegular />}
          onClick={() => props.dispatch(fileNew())}
        />} 

        {/* Save buttons */}
        <ToolbarButton
          aria-label={t('toolbar.save')}
          title={props.editLibrary ? t('toolbar.saveLibrary') : t('toolbar.saveDesign')}
          icon={<SaveRegular />}
          disabled={!props.saveNeeded && !props.saveInProgress}
          onClick={() => props.dispatch(props.editLibrary ? librarySave : fileSave)}
        >
        </ToolbarButton>

         {process.env.TARGET_SYSTEM === 'filesystem' && (
             <ToolbarButton
               aria-label={t('toolbar.saveAs')}
               title={t('toolbar.saveAs')}
                icon={<SaveCopyRegular />}
                onClick={() => props.dispatch(props.editLibrary ? librarySaveAs : fileSaveAs)}
             />
          )}

        <ToolbarDivider className={styles.divider} />
        {/* Undo/Redo */}
        <ToolbarButton
          aria-label={t('toolbar.undo')}
          title={t('toolbar.undo')}
          icon={<ArrowUndoRegular />}
          disabled={!props.can_undo}
          onClick={() => props.dispatch(ActionCreators.undo())}
        />
        <ToolbarButton
          aria-label={t('toolbar.redo')}
          title={t('toolbar.redo')}
          icon={<ArrowRedoRegular />}
          disabled={!props.can_redo}
          onClick={() => props.dispatch(ActionCreators.redo())}
        />

        <ToolbarDivider className={styles.divider} />
        
        {/* Pin (Only if editing symbol) */}
        {props.editSymbol && process.env.TARGET_SYSTEM !== 'electron' && (
          <ToolbarButton
            aria-label={t('toolbar.pin')}
            title={t('toolbar.pin')}
            icon={<ImageIcon src={pinImage} />}
            onClick={() => props.dispatch(actionCommand('add_pin'))}
            className={m === 'add_pin' ? styles.highlight : undefined}
          />
        )}


        {/* Wire */}
        <ToolbarButton
          aria-label={t('toolbar.wire')}
          title={t('toolbar.wire')}
          icon={<ImageIcon src={wireImage} />}
          onClick={() => props.dispatch(actionCommand('add_wire'))}
          className={m === 'add_wire' ? styles.highlight : undefined}
        />

        {/* No Connect */}
        <ToolbarButton
          aria-label={t('toolbar.noConnect')}
          title={t('toolbar.noConnect')}
          icon={<ImageIcon src={noConnectImage} />}
          onClick={() => props.dispatch(actionCommand('add_no_connect'))}
          className={m === 'add_no_connect' ? styles.highlight : undefined}
        />

        {/* Power (split button) */}
        <SplitMenuButton
          text={t('toolbar.power')}
          optionsSuffix={t('toolbar.optionsSuffix')}
          mainImage={props.toolbarDefaults.Power.image}
          highlighted={m === props.toolbarDefaults.Power.command}
          onMainClick={() => props.dispatch(actionCommand(props.toolbarDefaults.Power.command))}
          menuItems={powerItems}
          onMenuItemClick={handleMenuItemClick('Power')}
          styles={styles}
        />

        {/* Label (split button) - only in normal mode */}
        {!props.editSymbol && (
          <SplitMenuButton
            text={t('toolbar.label')}
            optionsSuffix={t('toolbar.optionsSuffix')}
            mainImage={props.toolbarDefaults.Label.image}
            highlighted={m === props.toolbarDefaults.Label.command}
            onMainClick={() => props.dispatch(actionCommand(props.toolbarDefaults.Label.command))}
            menuItems={labelItems}
            onMenuItemClick={handleMenuItemClick('Label')}
            styles={styles}
          />
        )}

        {/* Text */}
        <ToolbarButton
          aria-label={t('toolbar.text')}
          title={t('toolbar.text')}
          icon={<ImageIcon src={textImage} />}
          onClick={() => props.dispatch(actionCommand('add_text'))}
          className={m === 'add_text' ? styles.highlight : undefined}
        />

        {/* Shapes (split button) */}
        <SplitMenuButton
          text={t('toolbar.shapes')}
          optionsSuffix={t('toolbar.optionsSuffix')}
          mainImage={props.toolbarDefaults.Shape.image}
          highlighted={m === props.toolbarDefaults.Shape.command}
          onMainClick={() => props.dispatch(actionCommand(props.toolbarDefaults.Shape.command))}
          menuItems={shapeItems}
          onMenuItemClick={handleMenuItemClick('Shape')}
          styles={styles}
        />

        {/* Bus (split button) */}
        <SplitMenuButton
          text={t('toolbar.bus')}
          optionsSuffix={t('toolbar.optionsSuffix')}
          mainImage={props.toolbarDefaults.Bus.image}
          highlighted={m === props.toolbarDefaults.Bus.command}
          onMainClick={() => props.dispatch(actionCommand(props.toolbarDefaults.Bus.command))}
          menuItems={busItems}
          onMenuItemClick={handleMenuItemClick('Bus')}
          styles={styles}
        />

        {/* Ruler (split button) - only in normal mode */}
        {!props.editSymbol && (
          <SplitMenuButton
            text={t('toolbar.ruler')}
            optionsSuffix={t('toolbar.optionsSuffix')}
            mainImage={props.toolbarDefaults.Ruler.image}
            highlighted={m === props.toolbarDefaults.Ruler.command}
            onMainClick={() => props.dispatch(actionCommand(props.toolbarDefaults.Ruler.command))}
            menuItems={rulerItems}
            onMenuItemClick={handleMenuItemClick('Ruler')}
            styles={styles}
          />
        )}

        <ToolbarDivider className={styles.divider} />

        {/* Rotate/Flip buttons */}
        <ToolbarButton
          aria-label={t('toolbar.rotateCounterClockwise')}
          title={t('toolbar.rotateLeft')}
          icon={<ArrowRotateCounterclockwiseRegular />}
          disabled={!props.can_rotate}
          onClick={() => props.dispatch(actionCommand('rotate_left'))}
        />
        <ToolbarButton
          aria-label={t('toolbar.rotateClockwise')}
          title={t('toolbar.rotateRight')}
          icon={<ArrowRotateClockwiseRegular />}
          disabled={!props.can_rotate}
          onClick={() => props.dispatch(actionCommand('rotate_right'))}
        />
        <ToolbarButton
          aria-label={t('toolbar.flipHorizontal')}
          title={t('toolbar.flipHorizontal')}
          icon={<FlipHorizontalRegular />}
          disabled={!props.can_flip}
          onClick={() => props.dispatch(actionCommand('mirror_h'))}
        />
        <ToolbarButton
          aria-label={t('toolbar.flipVertical')}
          title={t('toolbar.flipVertical')}
          icon={<FlipVerticalRegular />}
          disabled={!props.can_flip}
          onClick={() => props.dispatch(actionCommand('mirror_v'))}
        />

        <ToolbarDivider className={styles.divider} />

        {/* Zoom */}
        <ToolbarButton
          aria-label={t('toolbar.zoomIn')}
          title={t('toolbar.zoomIn')}
          icon={<ZoomInRegular />}
          disabled={!props.can_zoom_in}
          onClick={() => props.dispatch(actionCommand('zoom_in'))}
        />
        <ToolbarButton
          aria-label={t('toolbar.zoomOut')}
          title={t('toolbar.zoomOut')}
          icon={<ZoomOutRegular />}
          disabled={!props.can_zoom_out}
          onClick={() => props.dispatch(actionCommand('zoom_out'))}
        />

        <ToolbarDivider className={styles.divider} />

        <ToolbarButton
          aria-label={t('toolbar.toggleRulers')}
          title={t('toolbar.toggleRulers')}
          icon={<RulerRegular />}
          disabled={false}
          className={props.showRulers ? styles.highlight : undefined}
          onClick={() => props.dispatch(actionToggleRulers())}
        />

        {process.env.TARGET_SYSTEM !== 'electron' && (
          <>
            <ToolbarDivider className={styles.divider} />
             {/* Settings Menu */}
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <ToolbarButton icon={<SettingsRegular />} aria-label={t('toolbar.settings')} title={t('toolbar.settings')} />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<DataAreaRegular />} onClick={() => props.dispatch(actionSelectDialog('design_details', null))}>
                    {t('toolbar.designDetails')}
                  </MenuItem>
                  <MenuItem icon={<DataAreaRegular />} onClick={() => props.dispatch(actionSelectDialog('page_size', null))}>
                    {t('toolbar.pageSize')}
                  </MenuItem>
                  <MenuItem icon={<SettingsRegular />} onClick={() => props.dispatch(actionSelectDialog('settings', null))}>
                    {t('toolbar.settings')}
                  </MenuItem>
                  <MenuItem icon={<ColorRegular />} onClick={() => props.dispatch(actionSelectDialog('colours', null))}>
                    {t('toolbar.colours')}
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </>
        )}

        <div className={styles.spacer} />

        {/* Far Items */}
        <>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <ToolbarButton
              aria-label={t('toolbar.languageMenu')}
              title={t('toolbar.language')}
              icon={<GlobeRegular />}
            >
              {currentLanguageAbbreviation}
            </ToolbarButton>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem onClick={() => openExternalUrl('https://docs.tinycad.net/v4/Language-translation/')}>
                {t('toolbar.aboutTranslations')}
              </MenuItem>
              <MenuDivider />
              {SUPPORTED_LANGUAGES.map((language) => (
                <MenuItem
                  key={language.code}
                  icon={normalizeLanguageCode(i18n.language) === language.code ? <CheckmarkRegular /> : undefined}
                  onClick={() => changeLanguage(language.code)}
                >
                  {language.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>

         {/* Help */}
        {process.env.TARGET_SYSTEM !== 'electron' && (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton
                aria-label={t('toolbar.help')}
                title={t('toolbar.help')}
                icon={<QuestionCircleRegular />}
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  icon={<ImageIcon src={discordImage} />}
                  onClick={() => openExternalUrl('https://discord.gg/bdXnjhrSYQ')}
                >
                  {t('toolbar.discord')}
                </MenuItem>
                <MenuItem
                  icon={<DocumentRegular />}
                  onClick={() => openExternalUrl('https://docs.tinycad.net/v4/')}
                >
                  {t('toolbar.manual')}
                </MenuItem>
                <MenuDivider />
                <MenuItem onClick={() => props.dispatch(actionSelectDialog('about', null))}>
                  {t('toolbar.aboutTinyCAD')}
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
        </>
      </FluentToolbar>
    </div>
  );
};

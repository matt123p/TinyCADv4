import React, { Dispatch } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  Field,
  Select,
  Spinner,
  Input,
  Checkbox,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Print20Regular } from '@fluentui/react-icons';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import TPrintSheet from '../svg/PrintSheet';
import { docDrawing } from '../../state/undo/undo';
import { WithTranslation, withTranslation } from 'react-i18next';
import {
  loadPrinterSettings,
  printerPaperSizes,
  PrinterSettings,
  savePrinterSettings,
} from '../../io/printerSettings';

const useStyles = makeStyles({
  surface: {
    maxWidth: 'min(700px, calc(100vw - 24px))',
  },
  desktopSurface: {
    maxWidth: 'min(900px, calc(100vw - 24px))',
  },
  content: {
    padding: '4px',
  },
  layout: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXXL,
  },
  preview: {
    flex: '1.2 1 350px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  canvas: {
    '--print-preview-page-height': '320px',
    display: 'grid',
    placeItems: 'center',
    flexGrow: 1,
    minHeight: '352px',
    padding: tokens.spacingHorizontalXXL,
    boxSizing: 'border-box',
    '@media (max-width: 720px)': {
      '--print-preview-page-height': '200px',
      minHeight: '200px',
      padding: tokens.spacingHorizontalL,
    },
  },
  paper: {
    backgroundColor: '#fff',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow8,
    overflow: 'hidden',
    boxSizing: 'border-box',
    '& > svg': {
      display: 'block',
      width: '100%',
      height: '100%',
    },
  },
  sheetNavigation: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
  },
  settings: {
    flex: '1 1 300px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    border: 0,
    margin: 0,
    padding: 0,
    minWidth: 0,
    '@media (max-width: 400px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  fullWidthField: {
    gridColumn: '1 / -1',
  },
  sheetList: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '120px',
    overflowY: 'auto',
    padding: tokens.spacingVerticalXS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    marginTop: tokens.spacingVerticalM,
  },
  actions: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    justifySelf: 'stretch',
    gap: tokens.spacingHorizontalS,
    gridColumn: '1 / -1',
    paddingTop: tokens.spacingVerticalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  saveSettings: {
    marginInlineEnd: 'auto',
  },
});

interface PrinterInfo {
  name: string;
  displayName: string;
}

interface PrintPreviewDialogProps extends WithTranslation {
  dispatch: Dispatch<any>;
  drawing: docDrawing['docStore']['present']['drawing'];
  title?: string;
  styles: ReturnType<typeof useStyles>;
}

interface PrintPreviewDialogState {
  printers: PrinterInfo[];
  settings: PrinterSettings;
  savedSettings: PrinterSettings;
  currentSheet: number;
  selectedPages: boolean[];
  loading: boolean;
  printing: boolean;
  advancedPrinting: boolean;
  printerError: string | null;
  error: string | null;
}

class PrintPreviewDialog extends React.PureComponent<
  PrintPreviewDialogProps,
  PrintPreviewDialogState
> {
  constructor(props: PrintPreviewDialogProps) {
    super(props);

    // Initialize all pages as selected
    const selectedPages = props.drawing.sheets.map(() => true);
    const settings = loadPrinterSettings();

    this.state = {
      printers: [],
      settings,
      savedSettings: settings,
      currentSheet: 0,
      selectedPages,
      loading: !!window.electronAPI?.getPrinters,
      printing: false,
      advancedPrinting: false,
      printerError: null,
      error: null,
    };

    this.handleClickPrint = this.handleClickPrint.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);
  }

  componentDidMount() {
    // Get available printers from Electron
    if (window.electronAPI?.getPrinters) {
      window.electronAPI.getPrinters().then((printers: PrinterInfo[]) => {
        this.setState({
          printers,
          loading: false,
        });
      }).catch((err: Error) => {
        this.setState({
          loading: false,
          printerError: this.props.t('dialogues.printPreview.failedToGetPrinterList', { error: err.message }),
        });
      });
    }
  }

  selectedSheets() {
    return this.props.drawing.sheets.filter((_, index) => this.state.selectedPages[index]);
  }

  async handleClickPrint() {
    if (!window.electronAPI?.printDocument) {
      this.handleBrowserPrint();
      return;
    }

    const { settings } = this.state;
    const [firstPage] = this.selectedSheets();
    if (!firstPage || !this.canUseSettings()) return;

    const [width, height] = firstPage.details.page_size;
    const landscape = settings.orientation === 'drawing'
      ? width > height
      : settings.orientation === 'landscape';

    this.setState({ printing: true, error: null });
    try {
      const result = await window.electronAPI.printDocument({
        html: this.generatePrintHtml(landscape, settings.paperSize),
        printerName: settings.printerName,
        pageSize: settings.paperSize,
        copies: settings.copies,
        landscape,
        color: settings.colour ? settings.colour === 'colour' : undefined,
        duplexMode: settings.duplexMode,
      });

      if (!result.success) {
        const { t } = this.props;
        throw new Error(result.printerUnavailable
          ? t('dialogues.printPreview.printerUnavailable')
          : result.failureReason || t('dialogues.printPreview.printFailed'));
      }
      this.props.dispatch(actionCancelDialog());
    } catch (error) {
      this.setState({ printing: false, error: (error as Error).message });
    }
  }

  handleAdvancedPrint = async () => {
    const sheets = this.selectedSheets();
    if (sheets.length === 0) return;

    this.setState({ advancedPrinting: true, error: null });
    try {
      const { openPdfForPrinting } = await import('../../io/print');
      const keepPreviewOpen = await openPdfForPrinting(
        { ...this.props.drawing, sheets },
        this.props.title ?? 'TinyCAD Print',
      );
      if (keepPreviewOpen) {
        this.setState({ advancedPrinting: false });
      } else {
        this.props.dispatch(actionCancelDialog());
      }
    } catch (error) {
      this.setState({
        advancedPrinting: false,
        error: this.props.t('dialogues.printPreview.pdfOpenFailed', {
          error: (error as Error).message,
        }),
      });
    }
  };

  updatePrinterSettings(changes: Partial<PrinterSettings>) {
    this.setState<'settings' | 'error'>(({ settings }) => ({
      settings: { ...settings, ...changes },
      error: null,
    }));
  }

  handleSavePrinterSettings = () => {
    const { settings } = this.state;
    if (!this.canUseSettings()) return;

    try {
      savePrinterSettings(settings);
      this.setState({ savedSettings: settings, error: null });
    } catch (error) {
      this.setState({
        error: this.props.t('dialogues.printPreview.setupSaveFailed', {
          error: (error as Error).message,
        }),
      });
    }
  };

  hasPrintDestination() {
    const { printers, settings } = this.state;
    return settings.printerName
      ? printers.some(printer => printer.name === settings.printerName)
      : printers.length > 0;
  }

  hasValidCopies() {
    const { copies } = this.state.settings;
    return Number.isInteger(copies) && copies >= 1 && copies <= 999;
  }

  canUseSettings() {
    return !this.state.loading && this.hasPrintDestination() && this.hasValidCopies();
  }

  renderPrinterSettings(disabled: boolean) {
    const { t, styles } = this.props;
    const { printers, settings, printerError } = this.state;
    const hasDestination = this.hasPrintDestination();
    const destinationError = printerError || (printers.length === 0
      ? t('dialogues.printPreview.noPrinters')
      : !hasDestination && t('dialogues.printPreview.printerUnavailable'));
    return (
      <fieldset
        disabled={disabled || printers.length === 0}
        className={styles.settingsGrid}
      >
        <Field
          label={t('dialogues.printPreview.printer')}
          validationState={destinationError ? 'error' : 'none'}
          validationMessage={destinationError}
          className={styles.fullWidthField}
        >
          <Select value={settings.printerName} onChange={(_, data) => this.updatePrinterSettings({ printerName: data.value })}>
            <option value="">{t('dialogues.printPreview.systemDefault')}</option>
            {settings.printerName && !hasDestination && (
              <option value={settings.printerName} disabled>{settings.printerName}</option>
            )}
            {printers.map(({ name, displayName }) => (
              <option key={name} value={name}>{displayName}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('dialogues.pageSize.paperSize')}>
          <Select value={settings.paperSize} onChange={(_, data) => this.updatePrinterSettings({ paperSize: data.value as PrinterSettings['paperSize'] })}>
            <option value="">{t('dialogues.printPreview.printerDefault')}</option>
            {Object.keys(printerPaperSizes).map(size => <option key={size}>{size}</option>)}
          </Select>
        </Field>
        <Field label={t('dialogues.pageSize.orientation')}>
          <Select value={settings.orientation} onChange={(_, data) => this.updatePrinterSettings({ orientation: data.value as PrinterSettings['orientation'] })}>
            <option value="drawing">{t('dialogues.printPreview.matchDrawing')}</option>
            <option value="portrait">{t('dialogues.pageSize.portrait')}</option>
            <option value="landscape">{t('dialogues.pageSize.landscape')}</option>
          </Select>
        </Field>
        <Field
          label={t('dialogues.printPreview.copies')}
          validationMessage={!this.hasValidCopies() && t('dialogues.printPreview.invalidCopies')}
          validationState={this.hasValidCopies() ? 'none' : 'error'}
        >
          <Input
            type="number"
            min={1}
            max={999}
            value={settings.copies ? String(settings.copies) : ''}
            onChange={(_, data) => this.updatePrinterSettings({ copies: Number(data.value) })}
          />
        </Field>
        <Field label={t('dialogues.printPreview.colourMode')}>
          <Select value={settings.colour} onChange={(_, data) => this.updatePrinterSettings({ colour: data.value as PrinterSettings['colour'] })}>
            <option value="">{t('dialogues.printPreview.printerDefault')}</option>
            <option value="colour">{t('dialogues.printPreview.colour')}</option>
            <option value="monochrome">{t('dialogues.printPreview.monochrome')}</option>
          </Select>
        </Field>
        <Field label={t('dialogues.printPreview.duplex')} className={styles.fullWidthField}>
          <Select value={settings.duplexMode} onChange={(_, data) => this.updatePrinterSettings({ duplexMode: data.value as PrinterSettings['duplexMode'] })}>
            <option value="">{t('dialogues.printPreview.printerDefault')}</option>
            <option value="simplex">{t('dialogues.printPreview.singleSided')}</option>
            <option value="longEdge">{t('dialogues.printPreview.longEdge')}</option>
            <option value="shortEdge">{t('dialogues.printPreview.shortEdge')}</option>
          </Select>
        </Field>
      </fieldset>
    );
  }

  handleBrowserPrint() {
    const html = this.generatePrintHtml();
    const printFrame = document.createElement('iframe') as HTMLIFrameElement;
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';

    const cleanup = () => {
      if (printFrame.parentNode) {
        printFrame.parentNode.removeChild(printFrame);
      }
    };

    const triggerPrint = () => {
      const frameWindow = printFrame.contentWindow;
      if (!frameWindow) {
        cleanup();
        this.setState({
          error: this.props.t('dialogues.printPreview.printFailed'),
        });
        return;
      }

      const handleAfterPrint = () => {
        frameWindow.removeEventListener('afterprint', handleAfterPrint);
        cleanup();
      };

      frameWindow.addEventListener('afterprint', handleAfterPrint);
      frameWindow.focus();
      frameWindow.print();
      window.setTimeout(cleanup, 60_000);
    };

    printFrame.onload = triggerPrint;
    document.body.appendChild(printFrame);

    printFrame.srcdoc = html;

    this.props.dispatch(actionCancelDialog());
  }

  generatePrintHtml(landscape?: boolean, paperSize: PrinterSettings['paperSize'] = ''): string {
    const pagesToPrint = this.selectedSheets();
    const firstPage = pagesToPrint[0];
    const isLandscape = landscape ?? (firstPage.details.page_size[0] > firstPage.details.page_size[1]);
    const [paperWidth, paperHeight] = printerPaperSizes[paperSize || 'A4'];
    const printableWidth = (isLandscape ? paperHeight : paperWidth) - 20;
    const printableHeight = (isLandscape ? paperWidth : paperHeight) - 20;
    
    // Build SVG content by rendering each selected sheet
    let svgContent = '';
    
    for (let si = 0; si < pagesToPrint.length; ++si) {
      const sheet = pagesToPrint[si];
      
      // Convert TinyCAD units to mm (divide by 5)
      const pageWidthMm = sheet.details.page_size[0] / 5;
      const pageHeightMm = sheet.details.page_size[1] / 5;
      
      // Calculate scale factor to fit within printable area
      const widthRatio = pageWidthMm / printableWidth;
      const heightRatio = pageHeightMm / printableHeight;
      const maxRatio = Math.max(widthRatio, heightRatio);
      
      // Scale down if content exceeds printable area (up to 10% overflow gets scaled)
      const scale = maxRatio > 1.0 ? 1.0 / maxRatio : 1.0;
      
      // Calculate final dimensions after scaling
      const finalWidthMm = pageWidthMm * scale;
      const finalHeightMm = pageHeightMm * scale;
      
      const svg = (
        <TPrintSheet
          items={sheet.items}
          page_size={sheet.details.page_size}
          details={sheet.details}
          options={sheet.options}
          images={sheet.images}
          hatches={sheet.hatches}
          netlistTypes={this.props.drawing.netlistTypes}
        />
      );

      // Use ReactDOMServer for static markup
      const ReactDOMServer = require('react-dom/server');
      let svgHtml = ReactDOMServer.renderToStaticMarkup(svg);
      
      // Replace the SVG's width/height attributes to use our scaled dimensions
      svgHtml = svgHtml.replace(
        /width="[^"]*"\s+height="[^"]*"/,
        `width="${finalWidthMm}mm" height="${finalHeightMm}mm"`
      );
      
      const pageBreak = si < pagesToPrint.length - 1 ? 'page-break-after: always;' : '';
      svgContent += `<div class="page" style="${pageBreak}">${svgHtml}</div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>TinyCAD Print</title>
  <style>
    @page {
      size: ${isLandscape ? 'landscape' : 'portrait'};
      margin: 10mm;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
    }
    body {
      font-family: Arial, sans-serif;
    }
    .page {
      width: ${printableWidth}mm;
      height: ${printableHeight}mm;
      overflow: hidden;
    }
    svg {
      display: block;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .page {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;
  }

  handleClickCancel() {
    if (this.state.printing || this.state.advancedPrinting) return;
    this.props.dispatch(actionCancelDialog());
  }

  renderPreview() {
    const { styles } = this.props;
    const sheet = this.props.drawing.sheets[this.state.currentSheet];
    if (!sheet) return null;

    const [width, height] = sheet.details.page_size;
    return (
      <div className={styles.canvas}>
        <div
          className={styles.paper}
          style={{
            width: `min(100%, 400px, calc(var(--print-preview-page-height) * ${width / height}))`,
            aspectRatio: `${width} / ${height}`,
          }}
        >
          <TPrintSheet
            items={sheet.items}
            page_size={sheet.details.page_size}
            details={sheet.details}
            options={sheet.options}
            images={sheet.images}
            hatches={sheet.hatches}
            netlistTypes={this.props.drawing.netlistTypes}
          />
        </div>
      </div>
    );
  }

  render() {
    const { t, styles } = this.props;
    const sheets = this.props.drawing.sheets;
    const hasMultiplePages = sheets.length > 1;
    const isElectron = !!window.electronAPI?.printDocument;
    const { settings, savedSettings, loading, printing, advancedPrinting, error } = this.state;
    const busy = printing || advancedPrinting;
    const canUseSettings = this.canUseSettings();
    const selectedCount = this.state.selectedPages.filter(p => p).length;

    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface className={isElectron ? styles.desktopSurface : styles.surface}>
          <DialogBody>
            <DialogTitle>{t('dialogues.printPreview.title')}</DialogTitle>
            <DialogContent className={styles.content}>
              <div className={styles.layout}>
                <div className={styles.preview}>
                  {this.renderPreview()}
                  {hasMultiplePages && (
                    <div className={styles.sheetNavigation}>
                      <Button
                        appearance="subtle"
                        disabled={this.state.currentSheet === 0}
                        onClick={() => this.setState(s => ({ ...s, currentSheet: s.currentSheet - 1 }))}
                      >
                        {t('dialogues.printPreview.prev')}
                      </Button>
                      <span>
                        {t('dialogues.printPreview.pageOf', {
                          page: this.state.currentSheet + 1,
                          total: sheets.length,
                        })}
                      </span>
                      <Button
                        appearance="subtle"
                        disabled={this.state.currentSheet === sheets.length - 1}
                        onClick={() => this.setState(s => ({ ...s, currentSheet: s.currentSheet + 1 }))}
                      >
                        {t('dialogues.printPreview.next')}
                      </Button>
                    </div>
                  )}
                </div>
                {(isElectron || hasMultiplePages) && (
                  <div className={styles.settings}>
                    {isElectron && (loading
                      ? <Spinner size="small" label={t('dialogues.printPreview.loadingPrinters')} />
                      : this.renderPrinterSettings(busy))}
                    {hasMultiplePages && (
                      <Field label={t('dialogues.printPreview.pagesToPrint')}>
                        <div className={styles.sheetList}>
                          {sheets.map((sheet, index) => (
                            <Checkbox
                              key={index}
                              disabled={busy}
                              checked={this.state.selectedPages[index]}
                              onChange={(e, data) => {
                                const newSelectedPages = [...this.state.selectedPages];
                                newSelectedPages[index] = data.checked === true;
                                this.setState({ selectedPages: newSelectedPages });
                              }}
                              label={sheet.name}
                            />
                          ))}
                        </div>
                      </Field>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div role="alert" className={styles.error}>
                  {error}
                </div>
              )}
            </DialogContent>
            <DialogActions className={styles.actions}>
              {isElectron && (
                <Button
                  appearance="subtle"
                  className={styles.saveSettings}
                  onClick={this.handleSavePrinterSettings}
                  disabled={busy || !canUseSettings || settings === savedSettings}
                >
                  {t('dialogues.printPreview.saveSettings')}
                </Button>
              )}
              <Button appearance="secondary" onClick={this.handleClickCancel} disabled={busy}>
                {t('common.cancel')}
              </Button>
              {window.electronAPI?.openPrintPdf && (
                <Button
                  onClick={this.handleAdvancedPrint}
                  disabled={busy || selectedCount === 0}
                  title={t('dialogues.printPreview.advancedPrintHint')}
                >
                  {advancedPrinting ? <Spinner size="tiny" /> : t('dialogues.printPreview.advancedPrint')}
                </Button>
              )}
              <Button
                appearance="primary"
                icon={printing ? <Spinner size="tiny" /> : <Print20Regular />}
                onClick={this.handleClickPrint}
                disabled={busy || selectedCount === 0 || (isElectron && !canUseSettings)}
              >
                {t('dialogues.printPreview.printButton', { count: selectedCount })}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }
}

function mapStateToProps(state: docDrawing) {
  return {
    drawing: state.docStore.present.drawing,
    title: state.altStore.file?.name,
  };
}

function StyledPrintPreviewDialog(props: Omit<PrintPreviewDialogProps, 'styles'>) {
  const styles = useStyles();
  return <PrintPreviewDialog {...props} styles={styles} />;
}

export default connect(mapStateToProps)(withTranslation()(StyledPrintPreviewDialog));

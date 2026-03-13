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
  Dropdown,
  Option,
  Spinner,
  Input,
  Checkbox,
} from '@fluentui/react-components';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import TPrintSheet from '../svg/PrintSheet';
import { docDrawing } from '../../state/undo/undo';
import { WithTranslation, withTranslation } from 'react-i18next';

interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

interface PrintPreviewDialogProps extends WithTranslation {
  dispatch: Dispatch<any>;
  drawing: docDrawing['docStore']['present']['drawing'];
}

interface PrintPreviewDialogState {
  printers: PrinterInfo[];
  selectedPrinter: string;
  copies: number;
  currentSheet: number;
  selectedPages: boolean[];
  loading: boolean;
  printing: boolean;
  error: string | null;
}

class PrintPreviewDialog extends React.PureComponent<
  PrintPreviewDialogProps,
  PrintPreviewDialogState
> {
  private cleanupPrintComplete: (() => void) | null = null;

  constructor(props: PrintPreviewDialogProps) {
    super(props);

    // Initialize all pages as selected
    const selectedPages = props.drawing.sheets.map(() => true);

    this.state = {
      printers: [],
      selectedPrinter: '',
      copies: 1,
      currentSheet: 0,
      selectedPages,
      loading: true,
      printing: false,
      error: null,
    };

    this.handleClickPrint = this.handleClickPrint.bind(this);
    this.handleClickCancel = this.handleClickCancel.bind(this);
  }

  componentDidMount() {
    // Get available printers from Electron
    if (window.electronAPI?.getPrinters) {
      window.electronAPI.getPrinters().then((printers: PrinterInfo[]) => {
        const defaultPrinter = printers.find(p => p.isDefault);
        this.setState({
          printers,
          selectedPrinter: defaultPrinter?.name || (printers[0]?.name ?? ''),
          loading: false,
        });
      }).catch((err: Error) => {
        this.setState({
          loading: false,
          error: this.props.t('dialogues.printPreview.failedToGetPrinterList', { error: err.message }),
        });
      });
    } else {
      // Not in Electron, use browser print
      this.setState({ loading: false });
    }

    // Listen for print completion
    if (window.electronAPI?.onPrintComplete) {
      this.cleanupPrintComplete = window.electronAPI.onPrintComplete((result: { success: boolean; failureReason?: string }) => {
        this.setState({ printing: false });
        if (result.success) {
          this.props.dispatch(actionCancelDialog());
        } else {
          this.setState({
            error:
              result.failureReason || this.props.t('dialogues.printPreview.printFailed'),
          });
        }
      });
    }
  }

  componentWillUnmount() {
    if (this.cleanupPrintComplete) {
      this.cleanupPrintComplete();
    }
  }

  handleClickPrint() {
    const { selectedPages } = this.state;
    const pagesToPrint = this.props.drawing.sheets.filter((_, index) => selectedPages[index]);
    const firstPage = pagesToPrint[0];
    const isLandscape = firstPage ? firstPage.details.page_size[0] > firstPage.details.page_size[1] : false;
    
    if (window.electronAPI?.printDocument) {
      this.setState({ printing: true, error: null });
      
      // Generate the HTML content for printing
      const html = this.generatePrintHtml();
      
      window.electronAPI.printDocument({
        html,
        printerName: this.state.selectedPrinter,
        copies: this.state.copies,
        landscape: isLandscape,
      });
    } else {
      // Fallback for web: open print dialog
      this.handleBrowserPrint();
    }
  }

  handleBrowserPrint() {
    const html = this.generatePrintHtml();
    const printFrame = document.createElement('iframe');
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

    if ('srcdoc' in printFrame) {
      printFrame.srcdoc = html;
    } else {
      const frameDocument = printFrame.contentDocument;
      if (!frameDocument) {
        cleanup();
        this.setState({
          error: this.props.t('dialogues.printPreview.printFailed'),
        });
        return;
      }

      frameDocument.open();
      frameDocument.write(html);
      frameDocument.close();
    }

    this.props.dispatch(actionCancelDialog());
  }

  generatePrintHtml(): string {
    const sheets = this.props.drawing.sheets;
    const { selectedPages } = this.state;
    
    // Filter to only selected pages
    const pagesToPrint = sheets.filter((_, index) => selectedPages[index]);
    
    // Determine orientation from first selected page
    const firstPage = pagesToPrint[0];
    const isLandscape = firstPage ? firstPage.details.page_size[0] > firstPage.details.page_size[1] : false;
    
    // Standard paper sizes in mm (we use the printable area after 10mm margins)
    // A4: 210x297mm, Letter: 215.9x279.4mm
    // Printable area with 10mm margins: ~190x277mm (portrait) or ~277x190mm (landscape)
    const printableWidth = isLandscape ? 277 : 190;
    const printableHeight = isLandscape ? 190 : 277;
    
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
    this.props.dispatch(actionCancelDialog());
  }

  renderPreview() {
    const sheet = this.props.drawing.sheets[this.state.currentSheet];
    if (!sheet) return null;

    // Calculate preview size to fit in dialog
    // Use a fixed max size for the preview container
    const maxWidth = 400;
    const maxHeight = 350;
    const pageWidth = sheet.details.page_size[0];
    const pageHeight = sheet.details.page_size[1];
    
    const scale = Math.min(maxWidth / pageWidth, maxHeight / pageHeight);
    const previewWidth = Math.floor(pageWidth * scale);
    const previewHeight = Math.floor(pageHeight * scale);

    // Render the TPrintSheet component to get its SVG content
    const ReactDOMServer = require('react-dom/server');
    const svgContent = ReactDOMServer.renderToStaticMarkup(
      <TPrintSheet
        items={sheet.items}
        page_size={sheet.details.page_size}
        details={sheet.details}
        options={sheet.options}
        images={sheet.images}
        hatches={sheet.hatches}
      />
    );

    return (
      <div style={{
        width: previewWidth,
        height: previewHeight,
        border: '1px solid #ccc',
        backgroundColor: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div 
          style={{ 
            width: '100%', 
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          dangerouslySetInnerHTML={{ 
            __html: svgContent.replace(
              /<svg([^>]*)>/,
              `<svg$1 style="width: ${previewWidth}px; height: ${previewHeight}px;">`
            )
          }}
        />
      </div>
    );
  }

  render() {
    const { t } = this.props;
    const sheets = this.props.drawing.sheets;
    const hasMultiplePages = sheets.length > 1;
    const isElectron = !!window.electronAPI?.printDocument;

    const selectedCount = this.state.selectedPages.filter(p => p).length;

    return (
      <Dialog open={true} onOpenChange={this.handleClickCancel}>
        <DialogSurface style={{ maxWidth: '700px', overflow: 'hidden' }}>
          <DialogBody>
            <DialogTitle>{t('dialogues.printPreview.title')}</DialogTitle>
            <DialogContent style={{ overflow: 'visible' }}>
              {this.state.loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                  <Spinner label={t('dialogues.printPreview.loadingPrinters')} />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '24px' }}>
                  {/* Preview panel */}
                  <div style={{ flex: '0 0 auto' }}>
                    {this.renderPreview()}
                    {hasMultiplePages && (
                      <div style={{ marginTop: '10px', textAlign: 'center' }}>
                        <Button
                          appearance="subtle"
                          disabled={this.state.currentSheet === 0}
                          onClick={() => this.setState(s => ({ ...s, currentSheet: s.currentSheet - 1 }))}
                        >
                          {t('dialogues.printPreview.prev')}
                        </Button>
                        <span style={{ margin: '0 10px' }}>
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
                  
                  {/* Options panel */}
                  <div style={{ minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {isElectron && this.state.printers.length > 0 && (
                      <Field label={t('dialogues.printPreview.printer')}>
                        <Dropdown
                          value={this.state.printers.find(p => p.name === this.state.selectedPrinter)?.displayName || this.state.selectedPrinter}
                          onOptionSelect={(e, data) => this.setState({ selectedPrinter: data.optionValue as string })}
                        >
                          {this.state.printers.map((printer) => (
                            <Option key={printer.name} value={printer.name} text={`${printer.displayName}${printer.isDefault ? ` ${t('dialogues.printPreview.defaultSuffix')}` : ''}`}>
                              {printer.displayName}{printer.isDefault ? ` ${t('dialogues.printPreview.defaultSuffix')}` : ''}
                            </Option>
                          ))}
                        </Dropdown>
                      </Field>
                    )}
                    
                    {hasMultiplePages && (
                      <Field label={t('dialogues.printPreview.pagesToPrint')}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                          {sheets.map((sheet, index) => (
                            <Checkbox
                              key={index}
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
                    
                    <Field label={t('dialogues.printPreview.copies')}>
                      <Input
                        type="number"
                        min={1}
                        max={999}
                        value={this.state.copies.toString()}
                        onChange={(e, data) => {
                          const val = parseInt(data.value, 10);
                          if (!isNaN(val) && val > 0) {
                            this.setState({ copies: val });
                          }
                        }}
                        style={{ width: '100%' }}
                      />
                    </Field>
                  </div>
                </div>
              )}
              
              {this.state.error && (
                <div style={{ color: 'red', marginTop: '10px' }}>
                  {this.state.error}
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button 
                appearance="primary" 
                onClick={this.handleClickPrint}
                disabled={this.state.loading || this.state.printing || selectedCount === 0}
              >
                {this.state.printing
                  ? <Spinner size="tiny" />
                  : selectedCount > 0
                    ? t('dialogues.printPreview.printButton', { count: selectedCount })
                    : t('toolbar.print')}
              </Button>
              <Button appearance="secondary" onClick={this.handleClickCancel}>
                {t('common.cancel')}
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
  };
}

export default connect(mapStateToProps)(withTranslation()(PrintPreviewDialog));

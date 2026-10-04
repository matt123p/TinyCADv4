import React, { Dispatch } from 'react';
import { TDrawing } from './Drawing';
import TDesignDetails from './DesignDetails';
import TDesignGuides from './DesignGuides';
import { TouchLoupe } from './TouchLoupe';
// PrecisionPad removed
import { UtilityService } from '../../util/utilityService';
import { Coordinate, DocItem, Filled } from '../../model/dsnItem';
import { FindResult } from '../../model/dsnView';
import TSvgDefs from './SvgDefs';
import {
  SheetDetails,
  SheetOptions,
  libImage,
  libHatch,
  NetlistTypes,
} from '../../model/dsnDrawing';
import {
  updateFactory,
  updateTextFactory,
} from '../../manipulators/updateFactory';
import {
  actionKeyDown,
  actionKeyPress,
  actionUnfocus,
  actionEditorEvent,
  actionRegisterTSheet,
  actionUnregisterTSheet,
  actionCommand,
  actionSelectPanel,
  Panels,
  actionMenuDefaultCommand,
  actionSelectLibrarySymbol,
} from '../../state/dispatcher/AppDispatcher';
import { ActionCreators } from 'redux-undo';
import {
  fileSave,
  fileSaveAs,
  imageFile,
  librarySave,
  librarySaveAs,
  print,
} from '../../io/files';
import { SelectSymbol } from '../libraryPanel/Search';
import { Ruler } from '../controls/Ruler';
import { actionSetMousePosition } from '../../state/actions/viewActions';
import { subscribeNetlist } from '../../io/netlists/netlistSync';
import { NetlistData } from '../../io/netlists/netlistGenerator';

interface TSheetProps {
  sheet_name: string;
  zoom: number;
  _selected_array: number[];
  _in_select_rect: boolean;
  _select_rect_a: Coordinate;
  _select_rect_b: Coordinate;
  items: DocItem[];
  markers: FindResult[];
  hover_point: Coordinate;
  display_add: boolean;
  add: DocItem;
  cursor: string;
  page_size: Coordinate;
  details: SheetDetails;
  hover_obj: DocItem | DocItem[];
  hover_ids: number[];
  hover_pins: string[];
  options: SheetOptions;
  _selected_handle: number;
  dispatch: Dispatch<any>;
  images: { [key: string]: libImage };
  hatches: libHatch[];
  contextMenu: boolean;
  part: number;
  show_power: boolean;
  editingLibrary: boolean;
  heterogeneous: boolean;
  showRulers: boolean;
  netlistTypes: NetlistTypes;
  netTypeAssignments: { [net: string]: string };
}

interface TSheetState {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    mouseX: number | null;  // In drawing units (internal coordinates)
    mouseY: number | null;
  netlist: NetlistData | null;
  touchActive: boolean;
  touchSvgX: number | null;
  touchSvgY: number | null;
  touchDragActive: boolean;
  precisionPadButtonVisible: boolean;
  isFingerDown: boolean;
}

const accelerator: { [key: string]: any } = {
  Delete: () => actionCommand('delete'),
  w: () => actionCommand('add_wire'),
  n: () => actionCommand('add_no_connect'),
  p: () => actionMenuDefaultCommand('Power'),
  l: () => actionMenuDefaultCommand('Label'),
  t: () => actionCommand('add_text'),
  b: () => actionMenuDefaultCommand('Bus'),
  s: () => actionMenuDefaultCommand('Shape'),
  '+': () => actionCommand('zoom_in'),
  '=': () => actionCommand('zoom_in'),
  '-': () => actionCommand('zoom_out'),
  _: () => actionCommand('zoom_out'),
  '~z': () => ActionCreators.undo(),
  '~y': () => ActionCreators.redo(),
  r: () => actionCommand('rotate_right'),
  '~r': () => actionCommand('rotate_left'),
  '~p': () => print,
  /*
  '': 'library panel',
  '': 'style/symbol panel'
  '': 'generate netlist',
  '': 'bom',
  */
};

//
// This class represents editing a single sheet of a TinyCAD drawing
//
export class TSheet extends React.PureComponent<TSheetProps, TSheetState> {
  private _div: HTMLDivElement;
  private readonly autoScrollMargin = 48;
  private readonly autoScrollMaxStep = 24;
  private pendingZoomAnchor:
    | {
        clientX: number;
        clientY: number;
        worldX: number;
        worldY: number;
      }
    | null = null;

  // The current scroll position
  private scroll: Coordinate = [0, 0];

  // Track mouse dragging
  private _mouse_drag_start = [0, 0];
  private _in_mouse_drag = false;
  private _last_drag_client: Coordinate | null = null;
  private _last_drag_key = 0;
  private _auto_scroll_frame: number | null = null;
  private unsubscribeNetlist: (() => void) | null = null;

  // The page border
  private border = 100;

  // Touch tracking variables
  private _touch_mode: 'none' | 'drag' | 'gesture' = 'none';
  private _touch_identifier: number | null = null;
  private _last_touch_x = 0;
  private _last_touch_y = 0;
  private _lastTouchDistance: number | null = null;
  private _lastTouchCenter: Coordinate | null = null;
  private _long_press_timer: any = null;
  private _virtual_client_x = 0;
  private _virtual_client_y = 0;
  // _trackpad_last variables removed

  constructor(props: TSheetProps) {
    super(props);

    this.state = {
        scrollX: 0,
        scrollY: 0,
        width: 100,
        height: 100,
        mouseX: null,
      mouseY: null,
      netlist: null,
      touchActive: false,
      touchSvgX: null,
      touchSvgY: null,
      touchDragActive: false,
      precisionPadButtonVisible: false,
      isFingerDown: false,
    };

    this.onkeydown = this.onkeydown.bind(this);
    this.onkeypress = this.onkeypress.bind(this);
    this.onfocus = this.onfocus.bind(this);
    this.onblur = this.onblur.bind(this);
    this.onscroll = this.onscroll.bind(this);
    this.handleDocumentMouseMove = this.handleDocumentMouseMove.bind(this);
    this.handleDocumentMouseUp = this.handleDocumentMouseUp.bind(this);
    this.runAutoScrollFrame = this.runAutoScrollFrame.bind(this);
    this.ontouchstart = this.ontouchstart.bind(this);
    this.ontouchmove = this.ontouchmove.bind(this);
    this.ontouchend = this.ontouchend.bind(this);
    this.ontouchcancel = this.ontouchcancel.bind(this);
  }

  private resizeObserver: ResizeObserver;
  private _prevDiv: HTMLDivElement = null;

  // Called on component construction
  componentDidMount() {
    this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            this.setState({
                width: entry.contentRect.width,
                height: entry.contentRect.height
            });
        }
    });
    this.attachResizeObserver();
    
    // Scroll correctly
    let border = this.border;
    let scale = this.props.zoom / 100.0;
    let offset = (border + 0.5) * scale;

    if (this._div) {
        this._div.scrollTop = offset;
        this._div.scrollLeft = offset;
        
        // Also initialize state with current size
        this.setState({
            scrollX: offset,
            scrollY: offset,
            width: this._div.clientWidth,
            height: this._div.clientHeight
        });
    }

    this.props.dispatch(actionRegisterTSheet(this));

    this.unsubscribeNetlist = subscribeNetlist((value) => {
      this.setState({ netlist: value });
    });

    window.addEventListener('touchsymbol-drop', this.handleTouchSymbolDrop as any);
  }
  
  componentDidUpdate(prevProps: TSheetProps) {
    // Re-attach resize observer if the div ref changed
    this.attachResizeObserver();

    if (prevProps.zoom !== this.props.zoom) {
      this.applyPendingZoomAnchor();
    }
  }
  
  private attachResizeObserver() {
    if (this._div && this._div !== this._prevDiv) {
        if (this._prevDiv && this.resizeObserver) {
            this.resizeObserver.unobserve(this._prevDiv);
        }
        if (this.resizeObserver) {
            this.resizeObserver.observe(this._div);
        }
        this._prevDiv = this._div;
        // Update size immediately
        this.setState({
            width: this._div.clientWidth,
            height: this._div.clientHeight
        });
    }
  }

  private clampScroll(scroll: number, maxScroll: number) {
    return Math.max(0, Math.min(scroll, maxScroll));
  }

  private applyPendingZoomAnchor() {
    if (!this.pendingZoomAnchor || !this._div) {
      return;
    }

    const nextScale = this.props.zoom / 100.0;
    const { clientX, clientY, worldX, worldY } = this.pendingZoomAnchor;
    const offset = this._div.getBoundingClientRect();
    const eventX = clientX - offset.x;
    const eventY = clientY - offset.y;
    const contentWidth = (this.props.page_size[0] + this.border * 2) * nextScale;
    const contentHeight = (this.props.page_size[1] + this.border * 2) * nextScale;
    const nextScrollLeft = this.clampScroll(
      (worldX + this.border) * nextScale - eventX,
      Math.max(0, contentWidth - this._div.clientWidth),
    );
    const nextScrollTop = this.clampScroll(
      (worldY + this.border) * nextScale - eventY,
      Math.max(0, contentHeight - this._div.clientHeight),
    );

    this._div.scrollLeft = nextScrollLeft;
    this._div.scrollTop = nextScrollTop;
    this.scroll = [nextScrollLeft, nextScrollTop];
    this.pendingZoomAnchor = null;
  }

  private setPendingZoomAnchor(clientX: number, clientY: number) {
    const [worldX, worldY] = this.getEventLocationFromClient(clientX, clientY);

    this.pendingZoomAnchor = {
      clientX,
      clientY,
      worldX,
      worldY,
    };
  }

  componentWillUnmount() {
    this.stopDocumentDragTracking();
    if (this.resizeObserver) {
        this.resizeObserver.disconnect();
    }
    if (this.unsubscribeNetlist) {
      this.unsubscribeNetlist();
      this.unsubscribeNetlist = null;
    }
    window.removeEventListener('touchsymbol-drop', this.handleTouchSymbolDrop as any);
    setTimeout(() => this.props.dispatch(actionUnregisterTSheet(this)), 0);
  }

  onshowItem(id: number) {
    const item = this.props.items.find((f) => f._id === id);
    if (item) {
      const update = updateFactory(item);
      const bb = update.getBoundingRect();

      let scale = this.props.zoom / 100.0;
      let offset = (this.border + 0.5) * scale;

      const x = bb.x1 * scale + offset - this._div.clientWidth / 2;
      const y = bb.y1 * scale + offset - this._div.clientHeight / 2;

      this._div.scrollLeft = x;
      this._div.scrollTop = y;
    }
  }

  onkeydown(e: any) {
    if (this.props.contextMenu) {
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.props.dispatch(actionCommand('escape'));
      return;
    }

    const hasPrimaryModifier = e.metaKey || e.ctrlKey;
    const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';

    if (hasPrimaryModifier && !e.altKey && key === 's') {
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        this.props.dispatch(
          (this.props.editingLibrary ? librarySaveAs : fileSaveAs) as any,
        );
      } else {
        this.props.dispatch(
          (this.props.editingLibrary ? librarySave : fileSave) as any,
        );
      }
      return;
    }

    if (!this.wantKeyPress()) {
      // Handle arrow keys for moving selected objects or panning
      if (e.keyCode >= 37 && e.keyCode <= 40) {
        e.preventDefault();
        e.stopPropagation();
        
        // Calculate movement direction based on arrow key
        let dx = 0, dy = 0;
        switch (e.keyCode) {
          case 37: dx = -1; break; // Left
          case 38: dy = -1; break; // Up
          case 39: dx = 1; break;  // Right
          case 40: dy = 1; break;  // Down
        }
        
        if (this.props._selected_array && this.props._selected_array.length > 0) {
          // Move selected objects - use 1 pixel with Ctrl, grid spacing otherwise
          const command = e.ctrlKey ? 'move_selected_pixel' : 'move_selected_grid';
          this.props.dispatch(actionCommand(command, dx, dy));
        } else {
          // Pan the view when nothing is selected
          const panAmount = e.ctrlKey ? 10 : 50; // Smaller pan with Ctrl
          this._div.scrollLeft += dx * panAmount;
          this._div.scrollTop += dy * panAmount;
        }
        return;
      }
      
      // Check the accelerator
      const acceleratorKey: string = hasPrimaryModifier ? '~' + e.key : e.key;
      const action = accelerator[acceleratorKey];
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        this.props.dispatch(action());
      }
      return;
    }

    if (
      ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) ||
      e.keyCode === 35 || // End
      e.keyCode === 36 || // Home
      (e.keyCode >= 37 && e.keyCode <= 40) || // Cursor keys
      e.keyCode === 8 || // Backspace
      e.keyCode === 46 // Delete
    ) {
      e.preventDefault();
      e.stopPropagation();

      this.props.dispatch(
        actionKeyDown(
          e.keyCode,
          e.shiftKey,
          e.ctrlKey,
          e.altKey,
          e.metaKey,
        ),
      );
    }
  }

  onkeypress(e: any) {
    if (this.props.contextMenu) {
      return;
    }

    if (!this.wantKeyPress()) {
      return;
    }

    // Is this cut copy or paste?
    if (e.metaKey || e.ctrlKey) {
      // Don't respond to special keys (so that cut/copy/paste works!)
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    this.props.dispatch(actionKeyPress(e.charCode, e.shiftKey, e.ctrlKey));
  }

  onfocus(e: any) {}

  onblur(e: any) {
    this.props.dispatch(actionUnfocus());
  }

  onscroll(e: any) {
    this.scroll = [e.target.scrollLeft, e.target.scrollTop];
    this.setState({
        scrollX: e.target.scrollLeft,
        scrollY: e.target.scrollTop
    });
  }

  private getKeyState(e: {
    altKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
  }) {
    let key = 0;

    if (e.altKey) {
      key += 4;
    }
    if (e.ctrlKey) {
      key += 2;
    }
    if (e.shiftKey) {
      key += 1;
    }

    return key;
  }

  private getEventLocationFromClient(clientX: number, clientY: number) {
    const offset = this._div.getBoundingClientRect();
    let event_x = clientX - offset.x;
    let event_y = clientY - offset.y;

    let x = event_x + this.scroll[0];
    let y = event_y + this.scroll[1];

    const scale = this.props.zoom / 100.0;

    y /= scale;
    x /= scale;

    y -= this.border;
    x -= this.border;

    return [x, y, event_x, event_y] as const;
  }

  private updatePointerPosition(clientX: number, clientY: number) {
    const [x, y] = this.getEventLocationFromClient(clientX, clientY);

    this.setState({
      mouseX: x,
      mouseY: y,
    });
    this.props.dispatch(actionSetMousePosition([x, y]));

    return [x, y] as const;
  }

  private dispatchEditorPointerEvent(
    name: string,
    clientX: number,
    clientY: number,
    key: number,
  ) {
    const [x, y, event_x, event_y] = this.getEventLocationFromClient(
      clientX,
      clientY,
    );

    this.setState({
      mouseX: x,
      mouseY: y,
    });
    this.props.dispatch(actionSetMousePosition([x, y]));

    this.props.dispatch(
      actionEditorEvent(
        name,
        [x, y],
        [x - this._mouse_drag_start[0], y - this._mouse_drag_start[1]],
        [event_x, event_y],
        { x: clientX, y: clientY },
        key,
      ),
    );

    if (name === 'lbuttondown' && !this._in_mouse_drag) {
      this._mouse_drag_start = [x, y];
      this.props.dispatch(
        actionEditorEvent(
          'dragstart',
          [x, y],
          [0, 0],
          [event_x, event_y],
          { x: clientX, y: clientY },
          key,
        ),
      );
      this._in_mouse_drag = true;
      this._last_drag_client = [clientX, clientY];
      this._last_drag_key = key;
      this.startDocumentDragTracking();
    } else if (name === 'mousedrag') {
      this._last_drag_client = [clientX, clientY];
      this._last_drag_key = key;
    }

    if (name === 'lbuttonup' && this._in_mouse_drag) {
      this.props.dispatch(
        actionEditorEvent(
          'dragend',
          [x, y],
          [0, 0],
          [event_x, event_y],
          { x: clientX, y: clientY },
          key,
        ),
      );
      this._in_mouse_drag = false;
      this._last_drag_client = null;
      this.stopDocumentDragTracking();
    }

    this._mouse_drag_start = [x, y];
  }

  private startDocumentDragTracking() {
    document.addEventListener('mousemove', this.handleDocumentMouseMove);
    document.addEventListener('mouseup', this.handleDocumentMouseUp);

    if (this._auto_scroll_frame === null) {
      this._auto_scroll_frame = window.requestAnimationFrame(
        this.runAutoScrollFrame,
      );
    }
  }

  private stopDocumentDragTracking() {
    document.removeEventListener('mousemove', this.handleDocumentMouseMove);
    document.removeEventListener('mouseup', this.handleDocumentMouseUp);

    if (this._auto_scroll_frame !== null) {
      window.cancelAnimationFrame(this._auto_scroll_frame);
      this._auto_scroll_frame = null;
    }
  }

  private handleDocumentMouseMove(e: MouseEvent) {
    if (this.state.touchDragActive) {
      return;
    }
    if (!this._in_mouse_drag || !this._div) {
      return;
    }

    e.preventDefault();
    this.applyAutoScroll(e.clientX, e.clientY);
    this.dispatchEditorPointerEvent(
      'mousedrag',
      e.clientX,
      e.clientY,
      this.getKeyState(e),
    );
  }

  private handleDocumentMouseUp(e: MouseEvent) {
    if (this.state.touchDragActive) {
      return;
    }
    if (!this._in_mouse_drag || !this._div) {
      return;
    }

    e.preventDefault();
    this.applyAutoScroll(e.clientX, e.clientY);
    this.dispatchEditorPointerEvent(
      e.button === 0 ? 'lbuttonup' : 'rbuttonup',
      e.clientX,
      e.clientY,
      this.getKeyState(e),
    );
  }

  private getAutoScrollDelta(position: number, viewportSize: number) {
    if (position < this.autoScrollMargin) {
      const strength = Math.min(
        1,
        (this.autoScrollMargin - position) / this.autoScrollMargin,
      );
      return -Math.ceil(this.autoScrollMaxStep * strength);
    }

    if (position > viewportSize - this.autoScrollMargin) {
      const strength = Math.min(
        1,
        (position - (viewportSize - this.autoScrollMargin)) /
          this.autoScrollMargin,
      );
      return Math.ceil(this.autoScrollMaxStep * strength);
    }

    return 0;
  }

  private applyAutoScroll(clientX: number, clientY: number) {
    if (!this._div) {
      return false;
    }

    const rect = this._div.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;

    const deltaX = this.getAutoScrollDelta(pointerX, rect.width);
    const deltaY = this.getAutoScrollDelta(pointerY, rect.height);

    if (deltaX === 0 && deltaY === 0) {
      return false;
    }

    const nextScrollLeft = Math.max(
      0,
      Math.min(
        this._div.scrollWidth - this._div.clientWidth,
        this._div.scrollLeft + deltaX,
      ),
    );
    const nextScrollTop = Math.max(
      0,
      Math.min(
        this._div.scrollHeight - this._div.clientHeight,
        this._div.scrollTop + deltaY,
      ),
    );

    if (
      nextScrollLeft === this._div.scrollLeft &&
      nextScrollTop === this._div.scrollTop
    ) {
      return false;
    }

    this._div.scrollLeft = nextScrollLeft;
    this._div.scrollTop = nextScrollTop;
    this.scroll = [nextScrollLeft, nextScrollTop];

    return true;
  }

  private runAutoScrollFrame() {
    if (!this._in_mouse_drag || !this._last_drag_client) {
      this._auto_scroll_frame = null;
      return;
    }

    const didScroll = this.applyAutoScroll(
      this._last_drag_client[0],
      this._last_drag_client[1],
    );

    if (didScroll) {
      this.dispatchEditorPointerEvent(
        'mousedrag',
        this._last_drag_client[0],
        this._last_drag_client[1],
        this._last_drag_key,
      );
    } else {
      this.updatePointerPosition(
        this._last_drag_client[0],
        this._last_drag_client[1],
      );
    }

    this._auto_scroll_frame = window.requestAnimationFrame(
      this.runAutoScrollFrame,
    );
  }

  ontouchstart(e: React.TouchEvent) {
    if (this.props.contextMenu) {
      return;
    }

    if (this._long_press_timer !== null) {
      window.clearTimeout(this._long_press_timer);
      this._long_press_timer = null;
    }

    if (!this.state.precisionPadButtonVisible) {
      this.setState({ precisionPadButtonVisible: true });
    }

    if (this.state.touchActive) {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this._touch_mode = 'drag';
        this._touch_identifier = touch.identifier;
        this._last_touch_x = touch.clientX;
        this._last_touch_y = touch.clientY;
        this.setState({ isFingerDown: true });
        e.preventDefault();
        e.stopPropagation();
      } else if (e.touches.length >= 2) {
        this._touch_mode = 'gesture';
        this._touch_identifier = null;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        this._lastTouchDistance = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY,
        );
        this._lastTouchCenter = [
          (touch1.clientX + touch2.clientX) / 2,
          (touch1.clientY + touch2.clientY) / 2,
        ];
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (this.state.touchDragActive) {
      const key = 0;
      this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, key);
      this.setState({ touchDragActive: false });
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      this._touch_mode = 'drag';
      this._touch_identifier = touch.identifier;
      this._last_touch_x = touch.clientX;
      this._last_touch_y = touch.clientY;
      
      this._virtual_client_x = touch.clientX;
      this._virtual_client_y = touch.clientY;

      this._div.focus();
      
      const key = 0;
      
      const rect = this._div.getBoundingClientRect();
      const event_x = touch.clientX - rect.left;
      const event_y = touch.clientY - rect.top;
      const svgTouchX = event_x + this.scroll[0];
      const svgTouchY = event_y + this.scroll[1];

      this.setState({
        touchActive: false,
        touchSvgX: svgTouchX,
        touchSvgY: svgTouchY,
        isFingerDown: true,
      });

      this.dispatchEditorPointerEvent('lbuttondown', touch.clientX, touch.clientY, key);

      // Start long press timer for context menu (700ms)
      this._long_press_timer = window.setTimeout(() => {
        if (this._touch_mode === 'drag' && !this._in_mouse_drag) {
          // Cancel active drag/selection
          this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, key);
          
          // Trigger context menu
          this.dispatchEditorPointerEvent('rbuttondown', this._virtual_client_x, this._virtual_client_y, key);
          this.dispatchEditorPointerEvent('rbuttonup', this._virtual_client_x, this._virtual_client_y, key);
          
          this.setState({
            touchActive: false,
            touchSvgX: null,
            touchSvgY: null,
          });
          this._touch_mode = 'none';
          this._touch_identifier = null;
        }
      }, 700);
    } else if (e.touches.length >= 2) {
      // If we were dragging, cancel it
      if (this._touch_mode === 'drag') {
        const key = 0;
        this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, key);
      }

      this.setState({
        touchActive: false,
        touchSvgX: null,
        touchSvgY: null,
      });
      this._touch_mode = 'gesture';
      this._touch_identifier = null;

      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      this._lastTouchDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY,
      );
      this._lastTouchCenter = [
        (touch1.clientX + touch2.clientX) / 2,
        (touch1.clientY + touch2.clientY) / 2,
      ];
    }
  }

  ontouchmove(e: React.TouchEvent) {
    if (this.state.touchActive) {
      if (this._touch_mode === 'drag' && e.touches.length === 1) {
        const touch = e.touches[0];
        if (touch.identifier === this._touch_identifier) {
          const dx = touch.clientX - this._last_touch_x;
          const dy = touch.clientY - this._last_touch_y;
          if (Math.hypot(dx, dy) > 5 && this._long_press_timer !== null) {
            window.clearTimeout(this._long_press_timer);
            this._long_press_timer = null;
          }

          this._last_touch_x = touch.clientX;
          this._last_touch_y = touch.clientY;

          const scaleFactor = 0.3;
          this._virtual_client_x += dx * scaleFactor;
          this._virtual_client_y += dy * scaleFactor;

          const rect = this._div.getBoundingClientRect();
          const event_x = this._virtual_client_x - rect.left;
          const event_y = this._virtual_client_y - rect.top;
          const svgTouchX = event_x + this.scroll[0];
          const svgTouchY = event_y + this.scroll[1];

          this.setState({
            touchActive: true,
            touchSvgX: svgTouchX,
            touchSvgY: svgTouchY,
          });

          const key = 0;
          if (this.state.touchDragActive) {
            this.dispatchEditorPointerEvent('mousedrag', this._virtual_client_x, this._virtual_client_y, key);
          } else {
            this.updatePointerPosition(this._virtual_client_x, this._virtual_client_y);
          }
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (this._touch_mode === 'gesture' && e.touches.length >= 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];

        const dist = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY,
        );
        const cx = (touch1.clientX + touch2.clientX) / 2;
        const cy = (touch1.clientY + touch2.clientY) / 2;

        if (this._lastTouchCenter) {
          const dx = cx - this._lastTouchCenter[0];
          const dy = cy - this._lastTouchCenter[1];
          if (dx !== 0 || dy !== 0) {
            this._div.scrollLeft -= dx;
            this._div.scrollTop -= dy;
            this.scroll = [this._div.scrollLeft, this._div.scrollTop];
            this.setState({
              scrollX: this._div.scrollLeft,
              scrollY: this._div.scrollTop,
            });
          }
        }

        if (this._lastTouchDistance && Math.abs(dist - this._lastTouchDistance) > 2) {
          const factor = dist / this._lastTouchDistance;
          const clampedFactor = Math.min(1.25, Math.max(1 / 1.25, factor));

          this.setPendingZoomAnchor(cx, cy);
          this.props.dispatch(actionCommand('zoom_scale', clampedFactor));
        }

        this._lastTouchDistance = dist;
        this._lastTouchCenter = [cx, cy];
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (this._touch_mode === 'drag' && e.touches.length === 1) {
      const touch = e.touches[0];
      if (touch.identifier === this._touch_identifier) {
        const dx = touch.clientX - this._last_touch_x;
        const dy = touch.clientY - this._last_touch_y;
        if (Math.hypot(dx, dy) > 5 && this._long_press_timer !== null) {
          window.clearTimeout(this._long_press_timer);
          this._long_press_timer = null;
        }

        this._last_touch_x = touch.clientX;
        this._last_touch_y = touch.clientY;

        const scaleFactor = 1.0;
        this._virtual_client_x += dx * scaleFactor;
        this._virtual_client_y += dy * scaleFactor;

        const rect = this._div.getBoundingClientRect();
        const event_x = this._virtual_client_x - rect.left;
        const event_y = this._virtual_client_y - rect.top;
        const svgTouchX = event_x + this.scroll[0];
        const svgTouchY = event_y + this.scroll[1];

        this.setState({
          touchActive: false,
          touchSvgX: svgTouchX,
          touchSvgY: svgTouchY,
        });

        const key = 0;
        this.dispatchEditorPointerEvent('mousedrag', this._virtual_client_x, this._virtual_client_y, key);
      }
    } else if (this._touch_mode === 'gesture' && e.touches.length >= 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      const dist = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY,
      );
      const cx = (touch1.clientX + touch2.clientX) / 2;
      const cy = (touch1.clientY + touch2.clientY) / 2;

      // Handle Panning
      if (this._lastTouchCenter) {
        const dx = cx - this._lastTouchCenter[0];
        const dy = cy - this._lastTouchCenter[1];
        if (dx !== 0 || dy !== 0) {
          this._div.scrollLeft -= dx;
          this._div.scrollTop -= dy;
          this.scroll = [this._div.scrollLeft, this._div.scrollTop];
          this.setState({
            scrollX: this._div.scrollLeft,
            scrollY: this._div.scrollTop,
          });
        }
      }

      // Handle Zooming
      if (this._lastTouchDistance && Math.abs(dist - this._lastTouchDistance) > 2) {
        const factor = dist / this._lastTouchDistance;
        const clampedFactor = Math.min(1.25, Math.max(1 / 1.25, factor));

        this.setPendingZoomAnchor(cx, cy);
        this.props.dispatch(actionCommand('zoom_scale', clampedFactor));
      }

      this._lastTouchDistance = dist;
      this._lastTouchCenter = [cx, cy];
    }
  }

  ontouchend(e: React.TouchEvent) {
    if (this._long_press_timer !== null) {
      window.clearTimeout(this._long_press_timer);
      this._long_press_timer = null;
    }

    if (this.state.touchActive) {
      if (e.touches.length === 0) {
        this.setState({
          isFingerDown: false,
        });
        this._touch_mode = 'none';
        this._touch_identifier = null;
        this._lastTouchDistance = null;
        this._lastTouchCenter = null;
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        this._touch_mode = 'drag';
        this._touch_identifier = touch.identifier;
        this._last_touch_x = touch.clientX;
        this._last_touch_y = touch.clientY;
        this.setState({
          isFingerDown: false,
        });
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (this._touch_mode === 'drag') {
      const changedTouches = Array.from(e.changedTouches);
      const touch = changedTouches.find(t => t.identifier === this._touch_identifier);
      if (touch) {
        const key = 0;
        this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, key);
      }
    }

    if (e.touches.length === 0) {
      this.setState({
        touchActive: false,
        touchSvgX: null,
        touchSvgY: null,
        isFingerDown: false,
      });
      this._touch_mode = 'none';
      this._touch_identifier = null;
      this._lastTouchDistance = null;
      this._lastTouchCenter = null;
    } else if (e.touches.length === 1) {
      this.setState({
        touchActive: false,
        touchSvgX: null,
        touchSvgY: null,
        isFingerDown: false,
      });
      this._touch_mode = 'none';
      this._touch_identifier = null;
      this._lastTouchDistance = null;
      this._lastTouchCenter = null;
    }
  }

  ontouchcancel(e: React.TouchEvent) {
    if (this._long_press_timer !== null) {
      window.clearTimeout(this._long_press_timer);
      this._long_press_timer = null;
    }

    if (this.state.touchActive) {
      this.setState({
        isFingerDown: false,
      });
      this._touch_mode = 'none';
      this._touch_identifier = null;
      this._lastTouchDistance = null;
      this._lastTouchCenter = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (this._touch_mode === 'drag') {
      const changedTouches = Array.from(e.changedTouches);
      const touch = changedTouches.find(t => t.identifier === this._touch_identifier);
      if (touch) {
        const key = 0;
        this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, key);
      }
    }

    this.setState({
      touchActive: false,
      touchSvgX: null,
      touchSvgY: null,
      isFingerDown: false,
    });
    this._touch_mode = 'none';
    this._touch_identifier = null;
    this._lastTouchDistance = null;
    this._lastTouchCenter = null;
  }



  private renderTouchIndicator() {
    if (!this.state.touchActive || this.state.touchSvgX === null || this.state.touchSvgY === null) {
      return null;
    }
    
    return (
      <g style={{ pointerEvents: 'none' }}>
        <circle
          cx={this.state.touchSvgX}
          cy={this.state.touchSvgY}
          r="6"
          fill="none"
          stroke="#0078d4"
          strokeWidth="1.5"
          strokeDasharray="2,2"
        />
        <circle
          cx={this.state.touchSvgX}
          cy={this.state.touchSvgY}
          r="1.5"
          fill="#0078d4"
        />
        <line
          x1={this.state.touchSvgX - 12}
          y1={this.state.touchSvgY}
          x2={this.state.touchSvgX + 12}
          y2={this.state.touchSvgY}
          stroke="#0078d4"
          strokeWidth="1"
          opacity="0.75"
        />
        <line
          x1={this.state.touchSvgX}
          y1={this.state.touchSvgY - 12}
          x2={this.state.touchSvgX}
          y2={this.state.touchSvgY + 12}
          stroke="#0078d4"
          strokeWidth="1"
          opacity="0.75"
        />
      </g>
    );
  }

  private handleVirtualClick = () => {
    if (this.state.touchSvgX !== null && this.state.touchSvgY !== null) {
      const key = 0;
      this.dispatchEditorPointerEvent('lbuttondown', this._virtual_client_x, this._virtual_client_y, key);
      this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, key);
    }
  };

  private handleVirtualRightClick = () => {
    if (this.state.touchSvgX !== null && this.state.touchSvgY !== null) {
      const key = 0;
      this.dispatchEditorPointerEvent('rbuttondown', this._virtual_client_x, this._virtual_client_y, key);
      this.dispatchEditorPointerEvent('rbuttonup', this._virtual_client_x, this._virtual_client_y, key);
    }
  };

  private handleVirtualDragToggle = () => {
    if (this.state.touchSvgX !== null && this.state.touchSvgY !== null) {
      const key = 0;
      if (!this.state.touchDragActive) {
        this.dispatchEditorPointerEvent('lbuttondown', this._virtual_client_x, this._virtual_client_y, key);
        this.setState({ touchDragActive: true });
      } else {
        this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, key);
        this.setState({ touchDragActive: false });
      }
    }
  };

  private handleVirtualClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (this.state.touchDragActive) {
      this.dispatchEditorPointerEvent('lbuttonup', this._virtual_client_x, this._virtual_client_y, 0);
    }
    this.setState({
      touchActive: false,
      touchSvgX: null,
      touchSvgY: null,
      touchDragActive: false,
    });
  };

  private handleTouchSymbolDrop = (e: any) => {
    const { clientX, clientY, payload } = e.detail;

    if (!this._div) return;
    const rect = this._div.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const [x, y] = this.getEventLocationFromClient(clientX, clientY);
      try {
        if (payload && payload.name && payload.symbolData) {
          this.props.dispatch(
            actionSelectLibrarySymbol(payload.name, payload.symbolData, [x, y]),
          );
        } else if (payload && payload.searchSymbol) {
          this.props.dispatch(SelectSymbol(payload.searchSymbol, [x, y]));
        }
      } catch (err) {
        console.error('Touch drop symbol error:', err);
      }
    }
  };

  private handleToggleButtonClick = () => {
    if (this.state.touchActive) {
      this.handleVirtualClose();
    } else {
      if (this._div) {
        const rect = this._div.getBoundingClientRect();
        const event_x = rect.width / 2;
        const event_y = rect.height / 2;
        const svgTouchX = event_x + this.scroll[0];
        const svgTouchY = event_y + this.scroll[1];
        
        this._virtual_client_x = event_x + rect.left;
        this._virtual_client_y = event_y + rect.top;
        
        this.setState({
          touchActive: true,
          touchSvgX: svgTouchX,
          touchSvgY: svgTouchY,
          isFingerDown: false,
          touchDragActive: false,
        });
        
        this.updatePointerPosition(this._virtual_client_x, this._virtual_client_y);
      }
    }
  };

  private renderLoupeToggleButton() {
    if (!this.state.precisionPadButtonVisible) {
      return null;
    }

    const active = this.state.touchActive;
    return (
      <button
        onClick={this.handleToggleButtonClick}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 24px',
          borderRadius: '50px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          background: active 
            ? 'linear-gradient(135deg, #d83b01 0%, #b83200 100%)'
            : 'linear-gradient(135deg, #0078d4 0%, #005a9e 100%)',
          color: '#ffffff',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: '14px',
          fontWeight: 600,
          letterSpacing: '0.5px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
          cursor: 'pointer',
          transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease, box-shadow 0.2s ease',
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateX(-50%) scale(1.05)';
          e.currentTarget.style.boxShadow = '0 12px 38px rgba(0, 0, 0, 0.3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.24)';
        }}
      >
        <span style={{ fontSize: '16px' }}>{active ? '❌' : '🔍'}</span>
        <span>{active ? 'Hide Loupe' : 'Show Loupe'}</span>
      </button>
    );
  }

  oncontextmenu(e: any) {
    e.preventDefault();
    return false;
  }

  ondragover(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  ondrop(e: React.DragEvent) {
    e.preventDefault();
    const [x, y] = this.getEventLocation(e);

    // We only accept one file at a time
    if (e.dataTransfer.types.indexOf('application/json') >= 0) {
      try {
        // Is this a symbol being dropped?
        const d = e.dataTransfer.getData('application/json');
        const data = JSON.parse(d);
        if (data && data.name && data.symbolData) {
          this.props.dispatch(
            actionSelectLibrarySymbol(data.name, data.symbolData, [x, y]),
          );
        } else if (data && data.searchSymbol) {
          this.props.dispatch(SelectSymbol(data.searchSymbol, [x, y]));
        }
      } catch (e) {
        // Ignore drop errors
        console.log(e);
      }
    } else if (e.dataTransfer.files.length === 1) {
      const file = e.dataTransfer.files[0];
      switch (file.type) {
        case 'image/png':
          this.props.dispatch(imageFile(file, [x, y], 'PNG'));
          break;
        case 'image/jpeg':
          // We can add this file as an image
          this.props.dispatch(imageFile(file, [x, y], 'JPEG'));
          break;
      }
    }
  }

  onwheel(e: React.WheelEvent) {
    if (e.ctrlKey) {
      const zoomFactor = Math.exp((-e.deltaY * Math.log(1.25)) / 100);
      const clampedZoomFactor = Math.min(1.25, Math.max(1 / 1.25, zoomFactor));

      this.setPendingZoomAnchor(e.clientX, e.clientY);
      this.props.dispatch(actionCommand('zoom_scale', clampedZoomFactor));
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (e.shiftKey) {
      this.setPendingZoomAnchor(e.clientX, e.clientY);
      if (e.deltaY < 0) {
        this.props.dispatch(actionCommand('zoom_in'));
      } else {
        this.props.dispatch(actionCommand('zoom_out'));
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Two-finger scroll on touchpad (no modifiers) - let the browser handle
    // native scrolling/panning, which is the default behavior
  }

  getEventLocation(e: React.MouseEvent | React.DragEvent) {
    return this.getEventLocationFromClient(e.clientX, e.clientY);
  }

  onmouseevent(e: React.MouseEvent, ref: HTMLDivElement) {
    if (this.props.contextMenu) {
      return;
    }

    if (this._in_mouse_drag && (e.type === 'mousemove' || e.type === 'mouseup')) {
      return;
    }

    e.preventDefault();

    const key = this.getKeyState(e);

    let name = e.type;
    if (name === 'mousedown') {
      this._div.focus();
      if (e.button === 0) {
        name =
          e.detail >= 3
            ? 'ltripleclick'
            : e.detail === 2
              ? 'ldoubleclick'
              : 'lbuttondown';
      } else {
        name = 'rbuttondown';
      }
    }

    if (name === 'mouseup') {
      if (e.button === 0) {
        name = 'lbuttonup';
      } else {
        name = 'rbuttonup';
      }
    }

    if (name === 'mousemove' && this._in_mouse_drag) {
      name = 'mousedrag';
    }

    this.dispatchEditorPointerEvent(name, e.clientX, e.clientY, key);
  }

  show(a: Coordinate) {
    let border = this.border;
    let scale = this.props.zoom / 100.0;
    let offset = (border + 0.5) * scale;

    this._div.scrollTop = a[1] * scale + offset - this._div.clientHeight / 2;
    this._div.scrollLeft = a[0] * scale + offset - this._div.clientWidth / 2;
  }

  //
  // Draw this sheet
  //
  render() {
    // Is the user dragging out a selection rectangle?
    const selectRectBounds = this.props._in_select_rect
      ? UtilityService.normalizeRect(
          this.props._select_rect_a,
          this.props._select_rect_b,
        )
      : null;

    let selectrect = this.props._in_select_rect ? (
      <rect
        x={selectRectBounds.a[0]}
        y={selectRectBounds.a[1]}
        width={selectRectBounds.b[0] - selectRectBounds.a[0]}
        height={selectRectBounds.b[1] - selectRectBounds.a[1]}
        style={{
          fill: 'blue',
          fillOpacity: 0.25,
          stroke: 'black',
          strokeWidth: 1,
        }}
      />
    ) : null;

    // Do we need to show selection handles?
    let handles = null;
    if (
      UtilityService.singleSelectedItem(
        this.props.items,
        this.props._selected_array,
      )
    ) {
      handles = (
        <>
          {updateFactory(
            UtilityService.singleSelectedItem(
              this.props.items,
              this.props._selected_array,
            ),
          )
            .handles()
            .map((p: Coordinate, index: number) => {
              return (
                <rect
                  x={p[0] - 2}
                  y={p[1] - 2}
                  width="5"
                  height="5"
                  key={index}
                  style={{
                    fill: 'none',
                    fillOpacity: 0.75,
                    stroke: 'black',
                    strokeWidth: 1,
                  }}
                />
              );
            })}
        </>
      );
    }

    // Do we show the markers?
    let markers = (
      <>
        {this.props.markers?.map((p: FindResult, index: number) => {
          if (
            this.props.hover_point &&
            p.a[0] === this.props.hover_point[0] &&
            p.a[1] === this.props.hover_point[1]
          ) {
            return (
              <circle
                cx={p.a[0]}
                cy={p.a[1]}
                r="8"
                stroke="red"
                strokeWidth="3"
                fill="none"
                key={index}
              />
            );
          } else {
            return (
              <circle
                cx={p.a[0]}
                cy={p.a[1]}
                r="5"
                stroke="red"
                strokeWidth="2"
                fill="none"
                key={index}
              />
            );
          }
        })}
      </>
    );

    let add = null;
    if (this.props.display_add) {
      add = this.props.add;
    }

    const PIXELS_PER_MM = 5;
    let border = this.border;
    let scale = this.props.zoom / 100.0;
    // Offset for the SVG content within the scrollable area
    // This matches the transform matrix offset
    let offset = (border + 0.5) * scale;
    
    // Ruler zero offset in screen pixels relative to the scroll container's content start
    const zeroOffset = border * scale;
    
    // Only engage the grid layout if rulers are visible
    if (this.props.showRulers) {
        return (
          <div style={{ position: 'relative', display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' }}>
            <div style={{
                 display: 'grid', 
                 gridTemplateColumns: 'minmax(0, 1fr) 20px', 
                 gridTemplateRows: '20px minmax(0, 1fr)', 
                 flexGrow: 1, 
                 flexShrink: 1, 
                 flexBasis: 0, 
                 overflow: 'hidden',
                 minHeight: 0,
                 width: '100%',
                 height: '100%'
            }}>
                <div style={{overflow: 'hidden'}}>
                  <Ruler 
                      orientation="horizontal" 
                      unit="mm" 
                      zoom={this.props.zoom} 
                      scrollOffset={this.state.scrollX}
                      mousePosition={this.state.mouseX !== null ? this.state.mouseX / PIXELS_PER_MM : null}
                      containerSize={this.state.width}
                      zeroOffset={zeroOffset}
                      scaleOrign={PIXELS_PER_MM}
                  />
                </div>
                <div style={{backgroundColor: '#e0e0e0', borderBottom: '1px solid #999', borderLeft: '1px solid #999'}} />
                
            <div
              className="circuit-drawing"
              style={{gridColumn: '1', gridRow: '2'}}
              onScroll={(e) => this.onscroll(e)}
              ref={(div) => {
                this._div = div;
              }}
              tabIndex={-1}
              onKeyDown={this.onkeydown}
              onKeyPress={this.onkeypress}
              onFocus={this.onfocus}
              onBlur={this.onblur}
            >
             {/* SVG content */}
              <svg
                id="svg-drawing"
                onMouseMove={(e) => this.onmouseevent(e, this._div)}
                onMouseDown={(e) => this.onmouseevent(e, this._div)}
                onMouseUp={(e) => this.onmouseevent(e, this._div)}
                onTouchStart={this.ontouchstart}
                onTouchMove={this.ontouchmove}
                onTouchEnd={this.ontouchend}
                onTouchCancel={this.ontouchcancel}
                onWheel={(e) => this.onwheel(e)}
                onContextMenu={(e) => this.oncontextmenu(e)}
                onDragOver={(e) => this.ondragover(e)}
                onDrop={(e) => this.ondrop(e)}
                className="circuit-svg"
                width={(this.props.page_size[0] + border * 2) * scale}
                height={(this.props.page_size[1] + border * 2) * scale}
                cursor={this.props.cursor}
              >
                <TSvgDefs images={this.props.images} hatches={this.props.hatches} />
                <defs>
                  <pattern
                    id="grid-pattern"
                    x={-this.props.details.grid / 2}
                    y={-this.props.details.grid / 2}
                    width={this.props.details.grid}
                    height={this.props.details.grid}
                    patternUnits="userSpaceOnUse"
                  >
                    <circle
                      cx={this.props.details.grid / 2}
                      cy={this.props.details.grid / 2}
                      r="0.75"
                      fill="#a0a0a0"
                    />
                  </pattern>
                </defs>
      
                <g id={"sheet-content-" + this.props.sheet_name.replace(/\s+/g, '-')}>
                  <rect
                    x="0"
                    y="0"
                    width={(this.props.page_size[0] + border * 2) * scale}
                    height={border * scale}
                    className="offPageArea"
                  />
                  <rect
                    x="0"
                    y={border * scale}
                    width={border * scale}
                    height={(this.props.page_size[1] + border) * scale}
                    className="offPageArea"
                  />
                  <rect
                    x={(this.props.page_size[0] + border) * scale}
                    y={border * scale}
                    width={border * scale}
                    height={(this.props.page_size[1] + border) * scale}
                    className="offPageArea"
                  />
                  <rect
                    x="0"
                    y={(this.props.page_size[1] + border) * scale}
                    width={(this.props.page_size[0] + border * 2) * scale}
                    height={border * scale}
                    className="offPageArea"
                  />
                  <rect
                    x={border * scale}
                    y={border * scale}
                    width={this.props.page_size[0] * scale}
                    height={this.props.page_size[1] * scale}
                    className="pageRectangle"
                  />
        
                  <g transform={`matrix(${scale} 0 0 ${scale} ${offset} ${offset})`}>
                    {this.props.options.show_grid ? (
                      <rect
                        x="0"
                        y="0"
                        width={this.props.page_size[0]}
                        height={this.props.page_size[1]}
                        fill="url(#grid-pattern)"
                        pointerEvents="none"
                      />
                    ) : null}
                    {this.props.details.show_details ? (
                      <TDesignDetails
                        details={this.props.details}
                        page_size={this.props.page_size}
                      />
                    ) : null}
                    {this.props.details.show_guides ? (
                      <TDesignGuides
                        details={this.props.details}
                        page_size={this.props.page_size}
                      />
                    ) : null}
                    <TDrawing
                      dx={0}
                      dy={0}
                      dr={0}
                      items={this.props.items}
                      hover_obj={this.props.hover_obj}
                      hover_ids={this.props.hover_ids}
                      hover_pins={this.props.hover_pins}
                      selection={this.props._selected_array}
                      selected_handle={this.props._selected_handle}
                      options={this.props.options}
                      add={add}
                      hover={false}
                      parent={null}
                      part={this.props.part}
                      selected={false}
                      show_power={this.props.show_power}
                      editLibrary={this.props.editingLibrary}
                      heterogeneous={this.props.heterogeneous}
                      scale_x={1.0}
                      scale_y={1.0}
                      sheetName={this.props.sheet_name}
                      netlist={this.state.netlist}
                      netlistTypes={this.props.netlistTypes}
                      netTypeAssignments={this.props.netTypeAssignments}
                    />
                    {markers}
                    {selectrect}
                    {handles}
                  </g>
                </g>
                {this.state.touchActive && this.state.touchSvgX !== null && this.state.touchSvgY !== null && (
                  <TouchLoupe
                    touchSvgX={this.state.touchSvgX}
                    touchSvgY={this.state.touchSvgY}
                    scrollX={this.scroll[0]}
                    scrollY={this.scroll[1]}
                    zoom={this.props.zoom}
                    sheetName={this.props.sheet_name}
                    canvasWidth={this.state.width}
                    canvasHeight={this.state.height}
                    onClose={this.handleVirtualClose}
                    isFingerDown={this.state.isFingerDown}
                    onLeftClick={this.handleVirtualClick}
                    onRightClick={this.handleVirtualRightClick}
                    onDragToggle={this.handleVirtualDragToggle}
                    isDragging={this.state.touchDragActive}
                  />
                )}
                {this.renderTouchIndicator()}
              </svg>
            </div>
      
              <div style={{overflow: 'hidden'}}>
                   <Ruler 
                      orientation="vertical" 
                      unit="mm" 
                      zoom={this.props.zoom} 
                      scrollOffset={this.state.scrollY}
                      mousePosition={this.state.mouseY !== null ? this.state.mouseY / PIXELS_PER_MM : null}
                      containerSize={this.state.height}
                      zeroOffset={zeroOffset}
                      scaleOrign={PIXELS_PER_MM}
                      tickAlignment="start"
                  />
              </div>
            </div>
            {this.renderLoupeToggleButton()}
          </div>
        );
    }

    // Default layout (without rulers)
    return (
      <div style={{ position: 'relative', display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' }}>
        <div
          className="circuit-drawing"
          onScroll={(e) => this.onscroll(e)}
          ref={(div) => {
            this._div = div;
          }}
          tabIndex={-1}
          onKeyDown={this.onkeydown}
          onKeyPress={this.onkeypress}
          onFocus={this.onfocus}
          onBlur={this.onblur}
          style={{ width: '100%', height: '100%' }}
        >
          <svg
            id="svg-drawing"
            onMouseMove={(e) => this.onmouseevent(e, this._div)}
            onMouseDown={(e) => this.onmouseevent(e, this._div)}
            onMouseUp={(e) => this.onmouseevent(e, this._div)}
            onTouchStart={this.ontouchstart}
            onTouchMove={this.ontouchmove}
            onTouchEnd={this.ontouchend}
            onTouchCancel={this.ontouchcancel}
            onWheel={(e) => this.onwheel(e)}
            onContextMenu={(e) => this.oncontextmenu(e)}
            onDragOver={(e) => this.ondragover(e)}
            onDrop={(e) => this.ondrop(e)}
            className="circuit-svg"
            width={(this.props.page_size[0] + border * 2) * scale}
            height={(this.props.page_size[1] + border * 2) * scale}
            cursor={this.props.cursor}
          >
            <TSvgDefs images={this.props.images} hatches={this.props.hatches} />
            <defs>
              <pattern
                id="grid-pattern"
                x={-this.props.details.grid / 2}
                y={-this.props.details.grid / 2}
                width={this.props.details.grid}
                height={this.props.details.grid}
                patternUnits="userSpaceOnUse"
              >
                <circle
                  cx={this.props.details.grid / 2}
                  cy={this.props.details.grid / 2}
                  r="0.75"
                  fill="#a0a0a0"
                />
              </pattern>
            </defs>

            <g id={"sheet-content-" + this.props.sheet_name.replace(/\s+/g, '-')}>
              <rect
                x="0"
                y="0"
                width={(this.props.page_size[0] + border * 2) * scale}
                height={border * scale}
                className="offPageArea"
              />
              <rect
                x="0"
                y={border * scale}
                width={border * scale}
                height={(this.props.page_size[1] + border) * scale}
                className="offPageArea"
              />
              <rect
                x={(this.props.page_size[0] + border) * scale}
                y={border * scale}
                width={border * scale}
                height={(this.props.page_size[1] + border) * scale}
                className="offPageArea"
              />
              <rect
                x="0"
                y={(this.props.page_size[1] + border) * scale}
                width={(this.props.page_size[0] + border * 2) * scale}
                height={border * scale}
                className="offPageArea"
              />
              <rect
                x={border * scale}
                y={border * scale}
                width={this.props.page_size[0] * scale}
                height={this.props.page_size[1] * scale}
                className="pageRectangle"
              />

              <g transform={`matrix(${scale} 0 0 ${scale} ${offset} ${offset})`}>
                {this.props.options.show_grid ? (
                  <rect
                    x="0"
                    y="0"
                    width={this.props.page_size[0]}
                    height={this.props.page_size[1]}
                    fill="url(#grid-pattern)"
                    pointerEvents="none"
                  />
                ) : null}
                {this.props.details.show_details ? (
                  <TDesignDetails
                    details={this.props.details}
                    page_size={this.props.page_size}
                  />
                ) : null}
                {this.props.details.show_guides ? (
                  <TDesignGuides
                    details={this.props.details}
                    page_size={this.props.page_size}
                  />
                ) : null}
                <TDrawing
                  dx={0}
                  dy={0}
                  dr={0}
                  items={this.props.items}
                  hover_obj={this.props.hover_obj}
                  hover_ids={this.props.hover_ids}
                  hover_pins={this.props.hover_pins}
                  selection={this.props._selected_array}
                  selected_handle={this.props._selected_handle}
                  options={this.props.options}
                  add={add}
                  hover={false}
                  parent={null}
                  part={this.props.part}
                  selected={false}
                  show_power={this.props.show_power}
                  editLibrary={this.props.editingLibrary}
                  heterogeneous={this.props.heterogeneous}
                  scale_x={1.0}
                  scale_y={1.0}
                  sheetName={this.props.sheet_name}
                  netlist={this.state.netlist}
                  netlistTypes={this.props.netlistTypes}
                  netTypeAssignments={this.props.netTypeAssignments}
                />
                {markers}
                {selectrect}
                {handles}
              </g>
            </g>
            {this.state.touchActive && this.state.touchSvgX !== null && this.state.touchSvgY !== null && (
              <TouchLoupe
                touchSvgX={this.state.touchSvgX}
                touchSvgY={this.state.touchSvgY}
                scrollX={this.scroll[0]}
                scrollY={this.scroll[1]}
                zoom={this.props.zoom}
                sheetName={this.props.sheet_name}
                canvasWidth={this.state.width}
                canvasHeight={this.state.height}
                onClose={this.handleVirtualClose}
                isFingerDown={this.state.isFingerDown}
                onLeftClick={this.handleVirtualClick}
                onRightClick={this.handleVirtualRightClick}
                onDragToggle={this.handleVirtualDragToggle}
                isDragging={this.state.touchDragActive}
              />
            )}
            {this.renderTouchIndicator()}
          </svg>
        </div>
        {this.renderLoupeToggleButton()}
      </div>
    );
  }

  private wantKeyPress() {
    // Does a control want this?
    if (
      !this.props._selected_array ||
      this.props._selected_array.length !== 1
    ) {
      // Not extactly one item selected
      return false;
    }

    // Get the selected item
    const selectItem = this.props.items.find(
      (f) => f._id === this.props._selected_array[0],
    );
    const update_selectItem = updateTextFactory(selectItem);
    if (
      !update_selectItem ||
      !update_selectItem.wantKeyPress(this.props._selected_handle)
    ) {
      // This isn't a text item or the text in this item isn't being edited
      return false;
    }

    return true;
  }
}

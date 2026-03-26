import { XMLBuilder } from '../util/xmlbuilder';
import {
  DocItemTypes,
  DocItem,
  Stroked,
  Filled,
  Coordinate,
  dsnRectangle,
  dsnEllipse,
  dsnBusLabel,
  dsnBusSlash,
  dsnBusWire,
  dsnJunction,
  dsnLabel,
  dsnLine,
  dsnNoConnect,
  dsnPin,
  dsnPower,
  dsnSymbol,
  dsnText,
  dsnWire,
  Text,
  dsnImage,
} from '../model/dsnItem';
import {
  dsnSheet,
  dsnDrawing,
  DsnSettings,
  libSymbol,
  SheetOptions,
  SheetDetails,
  libImage,
  libSymbolPart,
  DEFAULT_NETLIST_TYPE_NAME,
  NetlistTypeDefinition,
  ensureNetlistTypes,
} from '../model/dsnDrawing';
import { isStroked, isFilled, isText } from '../model/dsnTypeGuards';
import { get_global_id } from '../util/global_id';
import { Snap } from '../manipulators/snap';
import { updateLine } from '../manipulators/updateLine';
import { updateText } from '../manipulators/updateText';
import { updatePower } from '../manipulators/updatePower';
import { updatePin } from '../manipulators/updatePin';
import { updateLabel } from '../manipulators/updateLabel';
import { updateBusLabel } from '../manipulators/updateBusLabel';
import { updateSymbol } from '../manipulators/updateSymbol';
import md5 from 'md5';
import { updateFactory } from '../manipulators/updateFactory';
import { measureText, getFont } from '../util/measureText';
import { uudecode } from './uudecode';
import { updateView } from '../manipulators/updateView';

interface XMLStyle {
  STYLE: number;
  COLOR: string;
  THICKNESS: number;
}

interface XMLFont {
  HEIGHT: number;
  FACENAME: string;
  WIDTH: number;
  WEIGHT: number;
  ITALIC: number;
  UNDERLINE: number;
  STRIKEOUT: number;
  CHARSET: number;
}

interface XMLFill {
  INDEX: string;
  COLOR: string;
}

interface XMLSymbolDef {
  symbol: libSymbol;
}

interface XMLImageDef {
  imageData: libImage;
}

export const defaultSheetOption: SheetOptions = {
  color_background: '#ffffff',
  color_bus: '#ff0000',
  color_hidden_pin: '#208020',
  color_junction: '#000000',
  color_label: '#008020',
  color_noconnect: '#000000',
  color_notetext_fill: '#ffffaf',
  color_notetext_line: '#0000ff',
  color_notetext_text: '#0000ff',
  show_label_connection_point: true,
  notetext_fill: true,
  notetext_stroke: true,
  notetext_line_pattern: 0,
  notetext_line_width: 1,
  font_bold: false,
  font_italic: false,
  font_name: 'Arial',
  font_size: 14,
  color_pin: '#c04040',
  color_power: '#000000',
  color_wire: '#0000ff',
  color_shape: '#000000',
  color_shape_fill: '#ffffff',
  fill_shape: false,
  shape_line_pattern: 0,
  shape_line_width: 1,
  stroke_shape: true,
  show_grid: true,
  units: 0,
};

export function blankXML() {
  return (
    "<TinyCADSheets><TinyCAD><NAME>Sheet 1</NAME><DETAILS><Size width='1455' height='1020'/><GUIDES horiz='7' vert='5'/><TITLE></TITLE>" +
    '<AUTHOR></AUTHOR><REVISION>1.0</REVISION><DOCNUMBER></DOCNUMBER><ORGANISATION></ORGANISATION><SHEETS>1 of 1</SHEETS><SHOWS>1</SHOWS>' +
    "<DATE></DATE><GRID spacing='50.00000' snap='1'/></DETAILS><OPTIONS><GRID>1</GRID><UNITS>0</UNITS><COLOR_WIRE>FF0000</COLOR_WIRE><COLOR_BUS>0000FF</COLOR_BUS>" +
    '<COLOR_JUNCTION>000000</COLOR_JUNCTION><COLOR_NOCONNECT>000000</COLOR_NOCONNECT><COLOR_LABEL>208000</COLOR_LABEL><COLOR_POWER>000000</COLOR_POWER>' +
    '<COLOR_PIN>4040C0</COLOR_PIN><COLOR_HIDDEN_PIN>208020</COLOR_HIDDEN_PIN><COLOR_BACKGROUND>FFFFFF</COLOR_BACKGROUND>' +
    '<COLOR_NOTETEXT_FILL>AFFFFF</COLOR_NOTETEXT_FILL><COLOR_NOTETEXT_LINE>FF0000</COLOR_NOTETEXT_LINE><COLOR_NOTETEXT_TEXT>FF0000</COLOR_NOTETEXT_TEXT>' +
    '<SHOW_LABEL_CONNECTION_POINT>1</SHOW_LABEL_CONNECTION_POINT>' +
    '</OPTIONS></TinyCAD></TinyCADSheets>'
  );
}

export function blank() {
  const dsn = blankXML();
  let io = new ioXML();
  let xmlBuilder = new XMLBuilder();
  xmlBuilder.fromText(dsn);
  return io.from_dsn(xmlBuilder);
}

export class ioXML {
  // IO operations
  //

  // Read in a TinyCAD document (or sheets)
  public from_dsn(xmlBuilder: XMLBuilder) {
    let r: dsnDrawing = {
      sheets: [],
      settings: {
        showRulers: true,
      },
      drc: {
        DupRef: true, // Duplicated references
        UnConnect: true, // Unconnected items
        NoConnect: true, // Mode than one item on a no-connect net
        Power: true, // Power connected to power
        OutputPwr: true, // Power connected to an output
        Output: true, // Output connected to an output
        NoOutput: true, // No outputs driving inputs
        UnConnected: true, // Unconnected nets
        MultipleNetNames: true, // Multiple net names on same net
        NonCaseDistinctNetNames: true, // Non-case distinct net names (i.e., Vcc and VCC)
        UnAssignedRefDes: true, // Unassigned reference designators (i.e., U?)
        PowerInputConflict: true, // Multiple power inputs with no driver
        PowerOutputConflict: true, // Multiple power outputs on same net
      },
      drcTable: [],
      annotate: {
        add_references: true, // Action: Add References/Remove references
        which_references: 0, // 0 = All, 1 = Un-numbered, 2 = matching
        matching: 'U?', // Wildcard to match
        all_sheets: true, // All sheets?
        start_value: 0, // 0 = Default, otherwise the starting value
      },
      netlistTypes: ensureNetlistTypes(null),
      netTypeAssignments: {},
    };

    let root = xmlBuilder.getElementsByTagName('TinyCADSheets');
    if (root.length === 0) {
      root = xmlBuilder.getElementsByTagName('TinyCAD');
      if (root.length >= 1) {
        let sheet = this.from_tinycad(root[0], root[0], false);
        r.sheets.push(sheet);
      }
    } else {
      let nodes = root[0].childNodes;
      for (let i = 0; i < nodes.length; ++i) {
        if (nodes[i].nodeName === 'HierarchicalSymbol') {
          let sheet = this.from_tinycad(nodes[i], nodes[i], true);
          r.sheets.push(sheet);
        }
        if (nodes[i].nodeName === 'TinyCAD') {
          let sheet = this.from_tinycad(nodes[i], nodes[i], false);
          r.sheets.push(sheet);
        }
        if (nodes[i].nodeName === 'NETLIST_TYPES') {
          const parsed = this.readNetlistTypes(nodes[i]);
          r.netlistTypes = parsed.types;
          r.netTypeAssignments = parsed.assignments;
        }
        if (nodes[i].nodeName === 'DSNSETTINGS') {
          r.settings = this.readSettings(nodes[i]);
        }
      }
    }

    r.netlistTypes = ensureNetlistTypes(r.netlistTypes);
    if (!r.netTypeAssignments) {
      r.netTypeAssignments = {};
    }

    return r;
  }

  public to_dsn(
    drawing: dsnDrawing,
    include_details: boolean,
    include_options: boolean,
  ) {
    // Create the root object
    let dsn = new XMLBuilder();
    dsn.createDoc('TinyCADSheets');
    for (var i = 0; i < drawing.sheets.length; ++i) {
      this.to_tinycad(
        drawing.sheets[i],
        dsn,
        drawing.sheets[i].items,
        include_details,
        include_options,
        false,
      );
    }
    this.writeSettings(dsn, drawing.settings);
    this.writeNetlistTypes(dsn, drawing);

    return dsn;
  }

  public to_tinycad(
    sheet: dsnSheet,
    dsn: XMLBuilder,
    items: DocItem[],
    include_details: boolean,
    include_options: boolean,
    no_junctions: boolean,
  ) {
    // The TinyCAD format is as follows:
    // 1. NAME
    // 2. DETAILS
    // 3. FONT (s)
    // 4. STYLE (s)
    // 5. FILL (s)
    // 6. SYMBOLDEF
    // 7. OPTIONS
    // 8. ... Drawing Objects ...

    // Compile a list of fonts, styles, fills, symboldefs & images
    let fonts: XMLFont[] = [];
    let styles: XMLStyle[] = [];
    let fills: XMLFill[] = [];
    let symboldefs: { [key: string]: XMLSymbolDef } = {};
    let images: { [key: string]: XMLImageDef } = {};

    // Create the individual sheets
    let root = dsn.appendChild(
      sheet.hierarchicalSymbol ? 'HierarchicalSymbol' : 'TinyCAD',
    );

    // Create the resources and document for insertion later
    this.to_resources(root, items, fonts, styles, fills, symboldefs, images);

    // 1.. Add the sheet name
    root.appendChild('NAME', sheet.name, null);

    // 2.. DETAILS
    if (include_details) {
      let details = root.appendChild('DETAILS');
      details.appendChild('Size', null, {
        width: sheet.details.page_size[0],
        height: sheet.details.page_size[1],
      });
      let shows =
        // tslint:disable-next-line: no-bitwise
        (sheet.details.show_details ? 1 : 0) |
        (sheet.details.show_guides ? 2 : 0);

      details.appendChild('GUIDES', null, { horiz: 7, vert: 5 });
      details.appendChild('TITLE', sheet.details.title);
      details.appendChild('AUTHOR', sheet.details.author);
      details.appendChild('REVISION', sheet.details.revision);
      details.appendChild('DOCNUMBER', sheet.details.docnumber);
      details.appendChild('ORGANISATION', sheet.details.organisation);
      details.appendChild('SHEETS', sheet.details.sheets);
      details.appendChild('SHOWS', shows.toString());
      details.appendChild('DATE', sheet.details.date);
      details.appendChild('GRID', null, {
        spacing: sheet.details.grid * 10,
        snap: sheet.details.grid_snap ? 1 : 0,
      });
    }

    // 3.. FONT (s)
    for (let index = 0; index < fonts.length; ++index) {
      let font = root.appendChild('FONT', null, {
        id: index + 1,
      });
      font.appendChildren(fonts[index]);
    }

    // 4.. STYLE (s)
    for (let index = 0; index < styles.length; ++index) {
      let style = root.appendChild('STYLE', null, {
        id: index + 1,
      });
      style.appendChildren(styles[index]);
    }

    // 5.. FILL (s)
    for (let index = 0; index < fills.length; ++index) {
      let fill = root.appendChild('FILL', null, {
        id: index + 1,
      });
      fill.appendChildren(fills[index]);
    }

    // 6.. SYMBOLDEF
    for (let symbol_id in symboldefs) {
      if (symboldefs.hasOwnProperty(symbol_id)) {
        let symboldef = root.appendChild('SYMBOLDEF', null, {
          id: symbol_id,
        });

        let symbol = symboldefs[symbol_id].symbol;
        symboldef.appendChild('NAME', symbol.name.value, {
          type: symbol.name.type,
        });
        symboldef.appendChild('GUID', symbol.uid);
        symboldef.appendChild('REF', symbol.ref.value, {
          type: symbol.ref.type,
        });
        symboldef.appendChild('DESCRIPTION', symbol.description);
        symboldef.appendChild('PPP', symbol.parts.toString());

        let a = {
          pos: root.makeCoords(symbol.outlines[0].ref_point),
          power: false,
          part: 1,
        };
        symboldef.appendChild('REF_POINT', null, a);

        // Insert the definition
        let tinycad: XMLBuilder;
        if (symbol.outlines.length > 1) {
          tinycad = symboldef.appendChild('TinyCADSheets');
          for (let i = 0; i < symbol.outlines.length; ++i) {
            const ts = tinycad.appendChild('TinyCAD');
            this.to_tinycad_simple(sheet, ts, symbol.outlines[i].items, false);
          }
        } else {
          tinycad = symboldef.appendChild('TinyCAD');
          this.to_tinycad_simple(
            sheet,
            tinycad,
            symbol.outlines[0].items,
            false,
          );
        }
      }
    }

    // 7.. IMAGES
    for (let image_id in images) {
      if (images.hasOwnProperty(image_id)) {
        let image = images[image_id].imageData;
        let imagedef = root.appendChild('IMAGE', null, {
          id: image_id,
          type: image.type,
        });
        let encoder = new uudecode();
        encoder.encode(imagedef, image.imageData);
      }
    }

    // 8.. OPTIONS
    if (include_options) {
      let options = root.appendChild('OPTIONS');
      options.appendChild('GRID', sheet.options.show_grid ? '1' : '0');
      options.appendChild('UNITS', sheet.options.units.toString());
      options.appendChild(
        'SHOW_LABEL_CONNECTION_POINT',
        sheet.options.show_label_connection_point ? '1' : '0',
      );
      options.appendChild(
        'COLOR_WIRE',
        root.makeColor(sheet.options.color_wire),
      );
      options.appendChild('COLOR_BUS', root.makeColor(sheet.options.color_bus));
      options.appendChild(
        'COLOR_JUNCTION',
        root.makeColor(sheet.options.color_junction),
      );
      options.appendChild(
        'COLOR_NOCONNECT',
        root.makeColor(sheet.options.color_noconnect),
      );
      options.appendChild(
        'COLOR_LABEL',
        root.makeColor(sheet.options.color_label),
      );
      options.appendChild(
        'COLOR_POWER',
        root.makeColor(sheet.options.color_power),
      );
      options.appendChild('COLOR_PIN', root.makeColor(sheet.options.color_pin));
      options.appendChild(
        'COLOR_HIDDEN_PIN',
        root.makeColor(sheet.options.color_hidden_pin),
      );
      options.appendChild(
        'COLOR_BACKGROUND',
        root.makeColor(sheet.options.color_background),
      );
      options.appendChild(
        'COLOR_NOTETEXT_FILL',
        root.makeColor(sheet.options.color_notetext_fill),
      );
      options.appendChild(
        'COLOR_NOTETEXT_LINE',
        root.makeColor(sheet.options.color_notetext_line),
      );
      options.appendChild(
        'COLOR_NOTETEXT_TEXT',
        root.makeColor(sheet.options.color_notetext_text),
      );
    }

    // Now the actual drawing objects
    this.to_tinycad_simple(sheet, root, items, no_junctions);

    return root;
  }

  to_resources(
    root: XMLBuilder,
    items: DocItem[],
    fonts: XMLFont[],
    styles: XMLStyle[],
    fills: XMLFill[],
    symboldefs: { [key: string]: XMLSymbolDef },
    images: { [key: string]: XMLImageDef },
  ) {
    // Extract resources
    for (let i = 0; i < items.length; ++i) {
      let item = items[i];
      if (isStroked(item)) {
        let style: XMLStyle;
        if (item.stroked) {
          style = {
            STYLE: item.line_pattern ? item.line_pattern : 0,
            COLOR: root.makeColor(item.line_colour),
            THICKNESS: item.line_width,
          };
        } else {
          style = {
            STYLE: 5,
            COLOR: root.makeColor('#000000'),
            THICKNESS: 1,
          };
        }
        item.style_id = this.lookup_item(styles, style);
      }
      if (isFilled(item)) {
        if (item.filled) {
          let fill = {
            INDEX: item.filled ? item.hatch.toString() : '-1',
            COLOR: root.makeColor(
              item.fill_colour ? item.fill_colour : '#000000',
            ),
          };
          item.fill_id = this.lookup_item(fills, fill);
        } else {
          item.fill_id = 0;
        }
      }

      if (isText(item)) {
        let font = {
          HEIGHT: item.font_size,
          FACENAME: item.font_name,
          WIDTH: 0,
          WEIGHT: item.font_bold ? 700 : 400,
          ITALIC: item.font_italic ? 255 : 0,
          UNDERLINE: 0,
          STRIKEOUT: 0,
          CHARSET: 0,
        };
        item.font_id = this.lookup_item(fonts, font);
      }

      if (item.NodeName === DocItemTypes.Symbol) {
        let symboldef = {
          symbol: item._symbol,
        };
        symboldefs[item._symbol.id] = symboldef;
        for (let j = 0; j < item._symbol.outlines.length; ++j) {
          this.to_resources(
            root,
            item._symbol.outlines[j].items,
            fonts,
            styles,
            fills,
            symboldefs,
            images,
          );
        }
      }

      if (item.NodeName === DocItemTypes.Image) {
        let image = {
          imageData: item.imageData,
        };
        images[item.imageData.id] = image;
      }
    }
  }

  to_tinycad_simple(
    sheet: dsnSheet,
    root: XMLBuilder,
    items: DocItem[],
    no_junctions: boolean,
  ) {
    for (let i = 0; i < items.length; ++i) {
      let item = items[i];
      let o = null;
      let a: any = {};
      switch (item.NodeName) {
        case DocItemTypes.BusLabel:
          a = {
            pos: root.makeCoords(item.point),
            font: item.font_id,
            color: root.makeColor(item.font_colour),
            direction: 0,
          };
          switch (item.rotation) {
            case 3: // Up
              a.direction = 0;
              break;
            case 1: // Down
              a.direction = 1;
              break;
            case 2: // Left
              a.direction = 2;
              break;
            case 0: // Right
              a.direction = 3;
              break;
          }
          root.appendChild('BUSNAME', item.text, a);
          break;
        case DocItemTypes.BusSlash:
          a = {
            pos: root.makeCoords(item.point),
            direction: item.rotation,
          };
          o = root.appendChild('BUSSLASH', null, a);
          break;
        case DocItemTypes.BusWire:
          a = {
            a: root.makeCoords(item.d_points[0]),
            b: root.makeCoords(item.d_points[1]),
          };
          root.appendChild('BUS', null, a);

          break;
        case DocItemTypes.Ellipse:
          a = {
            a: root.makeCoords(item.point),
            b: root.makeCoords(item.point_b),
            style: item.style_id,
            fill: item.fill_id,
          };
          o = root.appendChild('ELLIPSE', null, a);
          break;
        case DocItemTypes.Junction:
          if (!no_junctions) {
            a = {
              pos: root.makeCoords(item.point),
            };
            o = root.appendChild('JUNCTION', null, a);
          }
          break;
        case DocItemTypes.Label:
          a = {
            pos: root.makeCoords(item.point),
            font: item.font_id,
            color: root.makeColor(item.font_colour),
            direction: 0,
            style: item.which,
          };
          switch (item.rotation) {
            case 3: // Up
              a.direction = 0;
              break;
            case 1: // Down
              a.direction = 1;
              break;
            case 2: // Left
              a.direction = 2;
              break;
            case 0: // Right
              a.direction = 3;
              break;
          }
          o = root.appendChild('LABEL', item.text, a);
          if (item.hints) {
            for (let j = 0; j < item.hints.length; ++j) {
              const hint = item.hints[j];
              o.appendChild('HINT', null, {
                pin: hint.pin,
                net: hint.net,
              });
            }
          }
          break;
        case DocItemTypes.Line:
          const update_item = new updateLine(item);
          let br = update_item.getBoundingRect();
          let base = [br.x1, br.y1];

          a = {
            polygon: item.polygon ? 1 : 0,
            style: item.style_id,
            pos: root.makeCoords(base),
          };
          if (item.polygon) {
            a.fill = item.fill_id;
          } else {
            a.fill = 0;
          }
          o = root.appendChild('POLYGON', null, a);

          for (let j = 0; j < item.d_points.length; ++j) {
            if (item.d_points[j].length > 2) {
              // Control points are dealt with by the following endpoint
              continue;
            }

            a = {
              pos: root.makeCoords([
                item.d_points[j][0] - base[0],
                item.d_points[j][1] - base[1],
              ]),
              arc: 0,
            };

            // Was the previous point a control point?
            let prev_j = j - 1;
            if (prev_j < 0) {
              prev_j = item.d_points.length - 1;
            }
            let prev_j2 = prev_j - 1;
            if (prev_j2 < 0) {
              prev_j2 = item.d_points.length - 1;
            }
            let prev_j3 = prev_j2 - 1;
            if (prev_j3 < 0) {
              prev_j3 = item.d_points.length - 1;
            }
            let p4 = item.d_points[prev_j3];
            let p3 = item.d_points[prev_j2];
            let p2 = item.d_points[prev_j];
            let p1 = item.d_points[j];
            if (p2.length > 2 && p3.length > 2) {
              // Cubic Bézier: two consecutive control points
              a.control = root.makeCoords([p3[0] - base[0], p3[1] - base[1]]);
              a.control2 = root.makeCoords([p2[0] - base[0], p2[1] - base[1]]);
            } else if (p2.length > 2) {
              if (p2[0] === p1[0] && p2[1] === p3[1]) {
                // It an "old-format" arc-in
                a.arc = 1;
              } else if (p2[0] === p3[0] && p2[1] === p1[1]) {
                // It an "old-format" arc-out
                a.arc = 2;
              } else {
                // New format control point (quadratic)
                a.control = root.makeCoords([p2[0] - base[0], p2[1] - base[1]]);
              }
            }

            o.appendChild('POINT', null, a);
          }
          break;
        case DocItemTypes.NoConnect:
          a = {
            pos: root.makeCoords(item.point),
          };
          o = root.appendChild('NOCONNECT', null, a);
          break;
        case DocItemTypes.Pin:
          a = {
            pos: root.makeCoords(item.point),
            direction: root.makeRotation2(item.rotation),
            number: item.number,
            length: item.length,
            number_pos: item.number_pos,
            centre_name: item.centre_name ? 1 : 0,
            which: item.which,
            elec: item.elec,
            part: item.part,
            show: 0,
          };
          if (item.show_name) {
            // tslint:disable-next-line: no-bitwise
            a.show |= 1;
          }
          if (item.show_number) {
            // tslint:disable-next-line: no-bitwise
            a.show |= 2;
          }
          o = root.appendChild('PIN', item.name, a);
          break;
        case DocItemTypes.Power:
          a = {
            pos: root.makeCoords(item.point),
            which: item.which,
          };
          switch (item.rotation) {
            case 2: // Up
              a.direction = 0;
              break;
            case 0: // Down
              a.direction = 1;
              break;
            case 1: // Left
              a.direction = 2;
              break;
            case 3: // Right
              a.direction = 3;
              break;
          }
          o = root.appendChild('POWER', item.text, a);
          if (item.hints) {
            for (let j = 0; j < item.hints.length; ++j) {
              const hint = item.hints[j];
              o.appendChild('HINT', null, {
                pin: hint.pin,
                net: hint.net,
              });
            }
          }
          break;
        case DocItemTypes.Rectangle:
          a = {
            a: root.makeCoords(item.point),
            b: root.makeCoords(item.point_b),
            style: item.style_id,
            fill: item.fill_id,
          };
          o = root.appendChild('RECTANGLE', null, a);
          break;
        case DocItemTypes.Image:
          a = {
            a: root.makeCoords(item.point),
            b: root.makeCoords(item.point_b),
            id: item.imageData.id,
          };
          o = root.appendChild('METAFILE', null, a);
          break;
        case DocItemTypes.Image:
          a = {
            a: root.makeCoords(item.point),
            b: root.makeCoords(item.point_b),
            style: item.style_id,
            fill: item.fill_id,
          };
          o = root.appendChild('METAFILE', null, a);
          break;
        case DocItemTypes.Symbol:
          a = {
            pos: root.makeCoords(item.point),
            id: item._symbol.id,
            show_power: item.show_power ? 1 : 0,
            can_scale: item.allow_resize ? 1 : 0,
            scale_x: item.scale_x,
            scale_y: item.scale_y,
            part: item.part,
          };

          // tslint:disable-next-line: no-bitwise
          let mirror = (item.rotation & 4) !== 0;

          // tslint:disable-next-line: no-bitwise
          switch (item.rotation & 3) {
            case 0: // Up
              // tslint:disable-next-line: no-bitwise
              a.rotate = 0 | (mirror ? 4 : 0);
              break;
            case 2: // Down
              // tslint:disable-next-line: no-bitwise
              a.rotate = 1 | (mirror ? 0 : 4);
              break;
            case 3: // Left
              // tslint:disable-next-line: no-bitwise
              a.rotate = 2 | (mirror ? 0 : 4);
              break;
            case 1: // Right
              // tslint:disable-next-line: no-bitwise
              a.rotate = 3 | (mirror ? 4 : 0);
              break;
          }
          o = root.appendChild('SYMBOL', null, a);

          for (let j = 0; j < item.text.length; ++j) {
            let field = item.text[j];
            a = {
              pos: root.makeCoords([
                field.position[0],
                field.position[1] + item.font_size,
              ]),
              value: field.value,
              description: field.description,
              type: field.display,
              show: field.show ? 1 : 0,
            };
            o.appendChild('FIELD', null, a);
          }
          for (let j = 0; j < item.hints.length; ++j) {
            let hint = item.hints[j];
            a = {
              pin: hint.pin,
              net: hint.net,
            };
            o.appendChild('HINT', null, a);
          }
          break;
        case DocItemTypes.Text:
          let border_style = 0; // 0 = Normal rectangle, 1 = rounded rect, 2 = none
          if (!item.stroked) {
            border_style = 2;
          } else if (item.rounded_rect) {
            border_style = 1;
          }
          a = {
            a: root.makeCoords(item.point),
            b: root.makeCoords(item.point_b),
            font: item.font_id,
            color: root.makeColor(item.font_colour),
            style: item.style_id,
            fill: item.fill_id,
            direction: root.makeRotation2(item.rotation),
            border_style: border_style,
          };
          o = root.appendChild('NOTE_TEXT', item.text, a);
          break;
        case DocItemTypes.Wire:
          a = {
            a: root.makeCoords(item.d_points[0]),
            b: root.makeCoords(item.d_points[1]),
          };
          root.appendChild('WIRE', null, a);
          break;
        case DocItemTypes.Ruler:
          o = root.appendChild('ruler');
          break;
      }
    }
  }

  private from_tinycad(root: any, sheet: any, hierarchicalSymbol: boolean) {
    let r: DocItem[] = [];
    let nodes = sheet.childNodes;
    const newSheet: dsnSheet = {
      name: 'Sheet',
      items: r,
      details: {
        author: '',
        date: '',
        docnumber: '',
        organisation: '',
        revision: '',
        sheets: '1 of 1',
        title: '',
        show_details: true,
        show_guides: false,
        horiz_guide: 7,
        vert_guide: 5,
        filename: '',
        page_size: [1485, 1050],
        grid_snap: true,
        grid: 5,
      },

      // Symbol library
      symbols: {},

      // Image library
      images: {},

      // Fill Hatches
      hatches: [],

      // Design options
      options: {
        ...defaultSheetOption,
      },

      hierarchicalSymbol: hierarchicalSymbol,
    };

    for (let i = 0; i < nodes.length; ++i) {
      let o = null;
      let node = nodes[i];
      switch (node.nodeName) {
        case 'NAME':
          newSheet.name = this.nodeText(node);
          break;
        case 'DETAILS':
          newSheet.details = this.details(node.childNodes);
          break;
        case 'FONT':
        case 'STYLE':
        case 'FILL':
        case 'SYMBOLDEF':
        case 'IMAGE':
          // Ignore, we can always go back and get these
          break;
        case 'OPTIONS':
          newSheet.options = this.options(node.childNodes);
          break;
        case 'RECTANGLE':
          o = {
            NodeName: DocItemTypes.Rectangle,
            _id: get_global_id(),
            ...this.style(root, node.getAttribute('style')),
            ...this.fill(root, node.getAttribute('fill')),
            point: this.coords(node.getAttribute('a')),
            point_b: this.coords(node.getAttribute('b')),
          } as dsnRectangle;
          break;
        case 'METAFILE':
          o = {
            NodeName: DocItemTypes.Image,
            _id: get_global_id(),
            ...this.style(root, node.getAttribute('style')),
            point: this.coords(node.getAttribute('a')),
            point_b: this.coords(node.getAttribute('b')),
            imageData: this.imagedef(root, newSheet, node.getAttribute('id')),
          } as dsnImage;
          break;
        case 'ELLIPSE':
          o = {
            NodeName: DocItemTypes.Ellipse,
            _id: get_global_id(),
            ...this.style(root, node.getAttribute('style')),
            ...this.fill(root, node.getAttribute('fill')),
            point: this.coords(node.getAttribute('a')),
            point_b: this.coords(node.getAttribute('b')),
          } as dsnEllipse;
          break;
        case 'NOTE_TEXT':
          o = {
            NodeName: DocItemTypes.Text,
            _id: get_global_id(),
            // TODO: (newSheet.options);
            ...this.style(root, node.getAttribute('style')),
            ...this.fill(root, node.getAttribute('fill')),
            ...this.font(root, node.getAttribute('font')),
            ...this.font_colour(node.getAttribute('color')),
            point: this.coords(node.getAttribute('a')),
            point_b: this.coords(node.getAttribute('b')),
            text: this.multiLineNodeText(node),
            rotation: this.rotation2(node.getAttribute('direction')),
          } as dsnText;

          // 0 = Normal rectangle, 1 = rounded rect, 2 = none
          let border_style = parseInt(node.getAttribute('border_style'), 10);
          switch (border_style) {
            case 1:
              o.stroked = true;
              o.rounded_rect = true;
              break;
            case 2:
              o.stroked = false;
              o.filled = false;
              o.rounded_rect = false;
              break;
            default:
              o.stroked = true;
              o.rounded_rect = false;
              break;
          }

          o = new updateText(o).post_construction();
          break;
        case 'TEXT':
          {
            let rotation = 0;
            switch (parseInt(node.getAttribute('direction'), 10)) {
              case 0: // Up
                rotation = 3;
                break;
              case 1: // Down
                rotation = 1;
                break;
              case 2: // Left
                rotation = 2;
                break;
              case 3: // Right
                rotation = 0;
                break;
            }
            o = {
              _id: get_global_id(),
              NodeName: DocItemTypes.Text,
              ...this.font(root, node.getAttribute('font')),
              ...this.font_colour(node.getAttribute('color')),
              rotation: rotation,
              stroked: false,
              filled: false,
              text: this.nodeText(node),
              point: null,
              point_b: null,
            } as dsnText;
            const txt_size = measureText(getFont(o), o.text);
            const pos = this.coords(node.getAttribute('pos'));
            switch (rotation) {
              case 0: // Right
              case 2: // Left
                o.point = [pos[0], pos[1] - o.font_size - 2];
                o.point_b = [pos[0] + txt_size + 4, pos[1]];
                break;
              case 3: // Up
              case 1: // Down
                o.point = [pos[0] - o.font_size - 2, pos[1] - txt_size - 4];
                o.point_b = [pos[0], pos[1]];
                break;
            }
            o = new updateText(o).post_construction();
          }
          break;
        case 'POLYGON':
          let points = node.getElementsByTagName('POINT');
          let base = this.coords(node.getAttribute('pos'));
          let d_points: Coordinate[] = [];
          for (let j = 0; j < points.length; ++j) {
            let p = this.coords(points[j].getAttribute('pos'));
            p[0] += base[0];
            p[1] += base[1];
            d_points.push(p);
          }

          // Now fill in any arcs
          let offset = 0;
          let pc = d_points.slice();
          for (let k = 0; k < points.length; ++k) {
            let arc = parseInt(points[k].getAttribute('arc'), 10);
            if (arc !== 0) {
              // We need the previous point!
              let p1 = d_points[k];
              let p3;
              if (k === 0) {
                p3 = d_points[d_points.length - 1];
              } else {
                p3 = d_points[k - 1];
              }

              let p2;
              if (arc === 1) {
                // Add an arc point
                p2 = [p1[0], p3[1], 1];
              } else if (arc === 2) {
                // Add an arc point
                p2 = [p3[0], p1[1], 1];
              }

              // Insert
              pc.splice(k + offset, 0, p2);
              ++offset;
            }
            let control = points[k].getAttribute('control');
            if (control) {
              let p2 = this.coords(control);
              p2[0] += base[0];
              p2[1] += base[1];
              p2.push(1);

              // Insert
              pc.splice(k + offset, 0, p2);
              ++offset;

              // Check for cubic Bézier (second control point)
              let control2 = points[k].getAttribute('control2');
              if (control2) {
                let p2b = this.coords(control2);
                p2b[0] += base[0];
                p2b[1] += base[1];
                p2b.push(1);

                // Insert second control point after the first
                pc.splice(k + offset, 0, p2b);
                ++offset;
              }
            }
          }
          o = {
            NodeName: DocItemTypes.Line,
            _id: get_global_id(),
            ...this.style(root, node.getAttribute('style')),
            ...this.fill(root, node.getAttribute('fill')),
            polygon: false,
            d_points: pc,
          } as dsnLine;
          if (o.filled) {
            o.polygon = true;
          }
          if (node.getAttribute('polygon')) {
            o.polygon = parseInt(node.getAttribute('polygon'), 10) !== 0;
          }
          break;
        case 'WIRE':
          o = {
            NodeName: DocItemTypes.Wire,
            _id: get_global_id(),
            d_points: [
              this.coords(node.getAttribute('a')),
              this.coords(node.getAttribute('b')),
            ],
          } as dsnWire;
          break;
        case 'BUS':
          o = {
            NodeName: DocItemTypes.BusWire,
            _id: get_global_id(),
            d_points: [
              this.coords(node.getAttribute('a')),
              this.coords(node.getAttribute('b')),
            ],
          } as dsnBusWire;
          break;
        case 'NOCONNECT':
          o = {
            NodeName: DocItemTypes.NoConnect,
            _id: get_global_id(),
            point: this.coords(node.getAttribute('pos')),
          } as dsnNoConnect;
          break;
        case 'BUSSLASH':
          o = {
            NodeName: DocItemTypes.BusSlash,
            _id: get_global_id(),
            point: this.coords(node.getAttribute('pos')),
            rotation: parseInt(node.getAttribute('direction'), 10),
          } as dsnBusSlash;
          break;
        case 'JUNCTION':
          o = {
            NodeName: DocItemTypes.Junction,
            _id: get_global_id(),
            point: this.coords(node.getAttribute('pos')),
          } as dsnJunction;
          break;
        case 'POWER':
          {
            let rotation = 0;
            switch (parseInt(node.getAttribute('direction'), 10)) {
              case 0: // Up
                rotation = 2;
                break;
              case 1: // Down
                rotation = 0;
                break;
              case 2: // Left
                rotation = 1;
                break;
              case 3: // Right
                rotation = 3;
                break;
            }
            o = {
              NodeName: DocItemTypes.Power,
              _id: get_global_id(),
              point: this.coords(node.getAttribute('pos')),
              rotation: this.rotation(node.getAttribute('direction')),
              which: parseInt(node.getAttribute('which'), 10),
              text: this.nodeText(node),
              // The power's default style
              font_name: 'Arial',
              font_colour: '#000000',
              font_bold: false,
              font_italic: false,
              font_size: 10,
              hints: [],
            } as dsnPower;
            let powerHints = node.getElementsByTagName('HINT');
            for (let j = 0; j < powerHints.length; ++j) {
              o.hints.push({
                pin: powerHints[j].getAttribute('pin') || '',
                net: powerHints[j].getAttribute('net') || '',
              });
            }
            o = new updatePower(o).post_construction();
          }
          break;
        case 'PIN':
          let show = parseInt(node.getAttribute('show'), 10);
          o = {
            NodeName: DocItemTypes.Pin,
            _id: get_global_id(),
            point: this.coords(node.getAttribute('pos')),
            rotation: this.rotation2(node.getAttribute('direction')),
            name: this.nodeText(node) ?? '',
            number: node.getAttribute('number'),
            length: parseInt(node.getAttribute('length'), 10),
            number_pos: parseInt(node.getAttribute('number_pos'), 10),
            centre_name: !!parseInt(node.getAttribute('centre_name'), 10),
            which: parseInt(node.getAttribute('which'), 10),
            elec: parseInt(node.getAttribute('elec'), 10),
            // tslint:disable-next-line: no-bitwise
            show_name: (show & 1) !== 0,
            // tslint:disable-next-line: no-bitwise
            show_number: (show & 2) !== 0,
            part: parseInt(node.getAttribute('part'), 10),
            // The label's default style
            font_name: 'Arial',
            font_colour: '#000000',
            font_bold: false,
            font_italic: false,
            font_size: 10,
          } as dsnPin;
          o = new updatePin(o).post_construction();
          // ?? o.centre_name='0'
          break;
        case 'LABEL':
          {
            let rotation = 0;
            switch (parseInt(node.getAttribute('direction'), 10)) {
              case 0: // Up
                rotation = 3;
                break;
              case 1: // Down
                rotation = 1;
                break;
              case 2: // Left
                rotation = 2;
                break;
              case 3: // Right
                rotation = 0;
                break;
            }
            o = {
              NodeName: DocItemTypes.Label,
              _id: get_global_id(),
              point: this.coords(node.getAttribute('pos')),
              rotation: rotation,
              which: parseInt(node.getAttribute('style'), 10),
              text: this.nodeText(node),
              ...this.font(root, node.getAttribute('font')),
              font_colour: newSheet.options.color_label,
              ...this.font_colour(node.getAttribute('color')),
              hints: [],
            } as dsnLabel;
            let labelHints = node.getElementsByTagName('HINT');
            for (let j = 0; j < labelHints.length; ++j) {
              o.hints.push({
                pin: labelHints[j].getAttribute('pin') || '',
                net: labelHints[j].getAttribute('net') || '',
              });
            }
            o = new updateLabel(o).post_construction();
          }
          break;
        case 'BUSNAME':
          {
            let rotation = 0;
            switch (parseInt(node.getAttribute('direction'), 10)) {
              case 0: // Up
                rotation = 3;
                break;
              case 1: // Down
                rotation = 1;
                break;
              case 2: // Left
                rotation = 2;
                break;
              case 3: // Right
                rotation = 0;
                break;
            }
            o = {
              NodeName: DocItemTypes.BusLabel,
              _id: get_global_id(),
              point: this.coords(node.getAttribute('pos')),
              rotation: rotation,
              ...this.font(root, node.getAttribute('font')),
              font_colour: newSheet.options.color_label,
              ...this.font_colour(node.getAttribute('color')),
              text: this.nodeText(node),
            } as dsnBusLabel;
            o = new updateBusLabel(o).post_construction();
          }
          break;
        case 'ruler':
          // o = <DesignRuler;
          break;
        case 'SYMBOL':
          {
            let rot = parseInt(node.getAttribute('rotate'), 10);
            // tslint:disable-next-line: no-bitwise
            let mirror = (rot & 4) !== 0;
            let rotation = 0;
            // tslint:disable-next-line: no-bitwise
            switch (rot & 3) {
              case 0: // Up
                // tslint:disable-next-line: no-bitwise
                rotation = 0 | (mirror ? 4 : 0);
                break;
              case 1: // Down
                // tslint:disable-next-line: no-bitwise
                rotation = 2 | (mirror ? 0 : 4);
                break;
              case 2: // Left
                // tslint:disable-next-line: no-bitwise
                rotation = 3 | (mirror ? 0 : 4);
                break;
              case 3: // Right
                // tslint:disable-next-line: no-bitwise
                rotation = 1 | (mirror ? 4 : 0);
                break;
            }
            o = {
              NodeName: DocItemTypes.Symbol,
              _id: get_global_id(),
              point: this.coords(node.getAttribute('pos')),
              show_power: parseInt(node.getAttribute('show_power'), 10) !== 0,
              allow_resize: parseInt(node.getAttribute('can_scale'), 10) !== 0,
              scale_x: parseFloat(node.getAttribute('scale_x') ?? '1.0'),
              scale_y: parseFloat(node.getAttribute('scale_y') ?? '1.0'),
              part: parseInt(node.getAttribute('part'), 10),
              rotation: rotation,
              _symbol: this.symboldef(root, newSheet, node.getAttribute('id')),
              text: [],
              font_name: 'Arial',
              font_colour: '#FF0000',
              font_bold: false,
              font_italic: false,
              font_size: 10,
              hints: [],
            } as dsnSymbol;
            let fields = node.getElementsByTagName('FIELD');
            for (let j = 0; j < fields.length; ++j) {
              let field = {
                position: this.coords(fields[j].getAttribute('pos')),
                value: fields[j].getAttribute('value'),
                description: fields[j].getAttribute('description'),
                type: parseInt(fields[j].getAttribute('type'), 10),
                show: parseInt(fields[j].getAttribute('show'), 10) !== 0,
                display: parseInt(fields[j].getAttribute('type'), 10),
              };
              field.position[1] -= o.font_size;
              o.text.push(field);
            }
            let hints = node.getElementsByTagName('HINT');
            for (let j = 0; j < hints.length; ++j) {
              let hint = {
                pin: hints[j].getAttribute('pin'),
                net: hints[j].getAttribute('net'),
              };
              o.hints.push(hint);
            }
            o = new updateSymbol(o).post_construction();
          }
          break;
        case '#text':
          // Ignore
          break;
        default:
          console.log(nodes[i].nodeName);
          break;
      }

      if (o != null) {
        r.push(o);
      }
    }

    const update_view = new updateView();
    return update_view.rebuildHatches(newSheet);
  }

  private rotation(s: string) {
    let a = parseInt(s, 10);
    switch (a) {
      case 0: // Up
        return 2;
      case 1: // Down
        return 0;
      case 2: // Left
        return 3;
      case 3: // Right
        return 1;
    }
    return 0;
  }

  private rotation2(s: string) {
    let a = parseInt(s, 10);
    switch (a) {
      case 0: // Up
        return 3;
      case 1: // Down
        return 1;
      case 2: // Left
        return 2;
      case 3: // Right
        return 0;
    }
    return 0;
  }

  // Convert Co-ordinate string to an array
  private coords(s: string): Coordinate {
    let a = s.split(',');
    if (a.length === 2) {
      return [parseFloat(a[0]) * 5, parseFloat(a[1]) * 5];
    }
  }

  private nodeText(n: any): string {
    let children = n.childNodes;
    let text = '';
    for (let i = 0; i < children.length; ++i) {
      if (children[i].nodeType === 3 && children[i].nodeValue) {
        text += children[i].nodeValue;
      }
    }
    return text;
  }

  private multiLineNodeText(n: any) {
    let children = n.childNodes;
    if (children.length === 1) {
      let s = children[0].nodeValue;
      s = s.replace(/\r\n/g, '\r');
      s = s.replace(/\n\r/g, '\r');
      s = s.replace(/\n/g, '\r');
      return s;
    }
    return '';
  }

  private nodeNumber(n: any) {
    let children = n.childNodes;
    if (children.length === 1) {
      return parseInt(children[0].nodeValue, 10);
    }
    return 0;
  }

  private writeSettings(dsn: XMLBuilder, settings: DsnSettings | null | undefined) {
    const nextSettings: DsnSettings = {
      showRulers: settings?.showRulers !== false,
    };
    const root = dsn.appendChild('DSNSETTINGS');
    root.appendChild('SHOW_RULERS', nextSettings.showRulers ? '1' : '0');
  }

  private readSettings(node: any): DsnSettings {
    const settings: DsnSettings = {
      showRulers: true,
    };

    const childNodes = node.childNodes || [];
    for (let i = 0; i < childNodes.length; ++i) {
      const child = childNodes[i];
      if (child.nodeName === 'SHOW_RULERS') {
        settings.showRulers = this.nodeText(child) !== '0';
      }
    }

    return settings;
  }

  private writeNetlistTypes(dsn: XMLBuilder, drawing: dsnDrawing) {
    const types = ensureNetlistTypes(drawing.netlistTypes);
    const assignments = drawing.netTypeAssignments || {};
    const root = dsn.appendChild('NETLIST_TYPES');

    for (const name in types) {
      if (!types.hasOwnProperty(name)) {
        continue;
      }
      const t = types[name];
      const typeAttrs: any = {
        name: t.name,
      };
      if (t.wireColor != null) {
        typeAttrs.wireColor = t.wireColor;
      }
      if (t.labelColor != null) {
        typeAttrs.labelColor = t.labelColor;
      }
      if (t.powerColor != null) {
        typeAttrs.powerColor = t.powerColor;
      }
      if (t.wireThickness != null) {
        typeAttrs.wireThickness = t.wireThickness;
      }

      const typeNode = root.appendChild('TYPE', null, typeAttrs);
      for (const key in t.attributes) {
        if (!t.attributes.hasOwnProperty(key)) {
          continue;
        }
        typeNode.appendChild('ATTR', null, {
          key,
          value: t.attributes[key],
        });
      }
    }

    for (const net in assignments) {
      if (!assignments.hasOwnProperty(net)) {
        continue;
      }
      root.appendChild('NET', null, {
        name: net,
        type: assignments[net],
      });
    }
  }

  private readNetlistTypes(node: any): {
    types: { [name: string]: NetlistTypeDefinition };
    assignments: { [net: string]: string };
  } {
    const types: { [name: string]: NetlistTypeDefinition } = {};
    const assignments: { [net: string]: string } = {};

    const childNodes = node.childNodes || [];
    for (let i = 0; i < childNodes.length; ++i) {
      const child = childNodes[i];
      if (child.nodeName === 'TYPE') {
        const typeName = child.getAttribute('name') || DEFAULT_NETLIST_TYPE_NAME;
        const wireThicknessRaw = child.getAttribute('wireThickness');
        const wireThicknessParsed =
          wireThicknessRaw != null ? parseFloat(wireThicknessRaw) : NaN;
        const netType: NetlistTypeDefinition = {
          name: typeName,
          wireColor: child.getAttribute('wireColor'),
          labelColor: child.getAttribute('labelColor'),
          powerColor: child.getAttribute('powerColor'),
          wireThickness:
            !isNaN(wireThicknessParsed) && wireThicknessParsed > 1
              ? wireThicknessParsed
              : null,
          attributes: {},
        };

        const attrs = child.getElementsByTagName('ATTR');
        for (let j = 0; j < attrs.length; ++j) {
          const key = attrs[j].getAttribute('key');
          if (!key) {
            continue;
          }
          netType.attributes[key] = attrs[j].getAttribute('value') || '';
        }

        types[typeName] = netType;
      } else if (child.nodeName === 'NET') {
        const netName = child.getAttribute('name');
        const typeName = child.getAttribute('type');
        if (netName && typeName) {
          assignments[netName] = typeName;
        }
      }
    }

    return {
      types: ensureNetlistTypes(types),
      assignments,
    };
  }

  private componentToHex(c: number) {
    let hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }

  private rgbToHex(h: string) {
    let d = parseInt(h, 16);
    // tslint:disable-next-line: no-bitwise
    let bc = (d >> 16) & 255;
    // tslint:disable-next-line: no-bitwise
    let gc = (d >> 8) & 255;
    // tslint:disable-next-line: no-bitwise
    let rc = d & 255;
    return (
      '#' +
      this.componentToHex(rc) +
      this.componentToHex(gc) +
      this.componentToHex(bc)
    );
  }

  private font(root: XMLDocument, fs: string) {
    const o: Text = {
      font_name: '',
      font_size: 0,
      font_bold: false,
      font_italic: false,
    };
    let f = parseInt(fs, 10);
    let fonts = root.getElementsByTagName('FONT');
    for (let k = 0; k < fonts.length; ++k) {
      let selected_font = fonts[k];
      if (parseInt(selected_font.getAttribute('id'), 10) === f) {
        o.font_size = this.fontSizeFromHeight(
          this.nodeNumber(selected_font.getElementsByTagName('HEIGHT')[0]),
        );
        // let width = nodeNumber( font.getElementsByTagName( "WIDTH" )[0] );
        // let underline = nodeNumber( font.getElementsByTagName( "UNDERLINE" )[0] );
        // let strikeout = nodeNumber( font.getElementsByTagName( "STRIKEOUT" )[0] );
        // let charset = nodeNumber( font.getElementsByTagName( "CHARSET" )[0] );
        o.font_bold =
          this.nodeNumber(selected_font.getElementsByTagName('WEIGHT')[0]) >
          400;
        o.font_italic =
          this.nodeNumber(selected_font.getElementsByTagName('ITALIC')[0]) > 0;
        o.font_name = this.nodeText(
          selected_font.getElementsByTagName('FACENAME')[0],
        );
        break;
      }
    }
    return o;
  }

  private fontSizeFromHeight(height: number) {
    const absoluteHeight = Math.abs(height);

    if (height < 0) {
      return Math.max(1, Math.round((absoluteHeight * 72) / 96));
    }

    return absoluteHeight;
  }

  private font_colour(f: string) {
    if (f) {
      return { font_colour: this.rgbToHex(f) };
    }
    return {};
  }

  private style(root: any, sId: string) {
    const s = parseInt(sId, 10);
    const o: Stroked = {
      stroked: false,
      line_colour: 'black',
      line_width: 0,
      line_pattern: 0,
      style_id: null,
    };
    o.stroked = false;
    let styles = root.getElementsByTagName('STYLE');
    for (let k = 0; k < styles.length; ++k) {
      let selected_style = styles[k];
      if (parseInt(selected_style.getAttribute('id'), 10) === s) {
        let pattern = this.nodeNumber(
          selected_style.getElementsByTagName('STYLE')[0],
        );
        o.stroked = pattern !== 5;
        o.line_pattern = o.stroked ? pattern : 0;
        o.line_colour = this.rgbToHex(
          this.nodeText(selected_style.getElementsByTagName('COLOR')[0]),
        );
        o.line_width = this.nodeNumber(
          selected_style.getElementsByTagName('THICKNESS')[0],
        );
        break;
      }
    }
    return o;
  }

  private fill(root: any, fId: string) {
    const f = parseInt(fId, 10);
    const o: Filled = {
      filled: false,
      fill_colour: 'black',
      hatch: 0,
      rounded_rect: null,
      fill_id: null,
    };
    o.filled = false;
    let fills = root.getElementsByTagName('FILL');
    for (let k = 0; k < fills.length; ++k) {
      let selected_fill = fills[k];
      if (parseInt(selected_fill.getAttribute('id'), 10) === f) {
        o.filled =
          this.nodeNumber(selected_fill.getElementsByTagName('INDEX')[0]) !==
          -1;
        o.hatch = this.nodeNumber(
          selected_fill.getElementsByTagName('INDEX')[0],
        );
        o.fill_colour = this.rgbToHex(
          this.nodeText(selected_fill.getElementsByTagName('COLOR')[0]),
        );
        break;
      }
    }
    return o;
  }

  private details(selected_details: any) {
    const r: SheetDetails = {
      author: '',
      date: '',
      docnumber: '',
      organisation: '',
      revision: '',
      sheets: '1 of 1',
      title: '',
      show_details: true,
      show_guides: false,
      horiz_guide: 7,
      vert_guide: 5,
      filename: '',
      page_size: [1485, 1050],
      grid_snap: true,
      grid: 5,
    };
    for (let k = 0; k < selected_details.length; ++k) {
      if (selected_details[k].nodeName === 'Size') {
        r.page_size = [
          selected_details[k].getAttribute('width') * 1.0,
          selected_details[k].getAttribute('height') * 1.0,
        ];
      } else if (selected_details[k].nodeName === 'GUIDES') {
        r.horiz_guide = parseInt(selected_details[k].getAttribute('horiz'), 10);
        r.vert_guide = parseInt(selected_details[k].getAttribute('vert'), 10);
      } else if (selected_details[k].nodeName === 'TITLE') {
        r.title = this.nodeText(selected_details[k]);
      } else if (selected_details[k].nodeName === 'AUTHOR') {
        r.author = this.nodeText(selected_details[k]);
      } else if (selected_details[k].nodeName === 'REVISION') {
        r.revision = this.nodeText(selected_details[k]);
      } else if (selected_details[k].nodeName === 'DOCNUMBER') {
        r.docnumber = this.nodeText(selected_details[k]);
      } else if (selected_details[k].nodeName === 'ORGANISATION') {
        r.organisation = this.nodeText(selected_details[k]);
      } else if (selected_details[k].nodeName === 'SHEETS') {
        r.sheets = this.nodeText(selected_details[k]);
      } else if (selected_details[k].nodeName === 'DATE') {
        r.date = this.nodeText(selected_details[k]);
      } else if (selected_details[k].nodeName === 'SHOWS') {
        let shows = parseInt(this.nodeText(selected_details[k]), 10);
        // tslint:disable-next-line: no-bitwise
        r.show_details = (shows & 1) !== 0;
        // tslint:disable-next-line: no-bitwise
        r.show_guides = (shows & 2) !== 0;
      } else if (selected_details[k].nodeName === 'GRID') {
        r.grid = selected_details[k].getAttribute('spacing') / 10.0;
        r.grid_snap =
          parseInt(selected_details[k].getAttribute('snap'), 10) !== 0;
      }
    }

    return r;
  }

  private options(selected_options: any) {
    const r: SheetOptions = {
      ...defaultSheetOption,
    };
    for (let k = 0; k < selected_options.length; ++k) {
      if (selected_options[k].nodeName === 'GRID') {
        r.show_grid = this.nodeNumber(selected_options[k]) !== 0;
      } else if (selected_options[k].nodeName === 'UNITS') {
        r.units = this.nodeNumber(selected_options[k]);
      } else if (selected_options[k].nodeName === 'SHOW_LABEL_CONNECTION_POINT') {
        r.show_label_connection_point = this.nodeNumber(selected_options[k]) !== 0;
      } else if (selected_options[k].nodeName === 'COLOR_WIRE') {
        r.color_wire = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_BUS') {
        r.color_bus = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_JUNCTION') {
        r.color_junction = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_NOCONNECT') {
        r.color_noconnect = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_LABEL') {
        r.color_label = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_POWER') {
        r.color_power = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_PIN') {
        r.color_pin = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_HIDDEN_PIN') {
        r.color_hidden_pin = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_BACKGROUND') {
        r.color_background = this.rgbToHex(this.nodeText(selected_options[k]));
      } else if (selected_options[k].nodeName === 'COLOR_NOTETEXT_FILL') {
        r.color_notetext_fill = this.rgbToHex(
          this.nodeText(selected_options[k]),
        );
      } else if (selected_options[k].nodeName === 'COLOR_NOTETEXT_LINE') {
        r.color_notetext_line = this.rgbToHex(
          this.nodeText(selected_options[k]),
        );
      } else if (selected_options[k].nodeName === 'COLOR_NOTETEXT_TEXT') {
        r.color_notetext_text = this.rgbToHex(
          this.nodeText(selected_options[k]),
        );
      }
    }

    return r;
  }

  private imagedef(root: any, sheet: dsnSheet, sId: string) {
    const s = parseInt(sId, 10);
    if (s in sheet.images) {
      return sheet.images[s];
    }
    let images = root.getElementsByTagName('IMAGE');
    let selected_imagedef: libImage = {
      id: null,
      imageData: null,
      size: null,
      type: null,
    };
    for (let k = 0; k < images.length; ++k) {
      let image = images[k];
      if (parseInt(image.getAttribute('id'), 10) === s) {
        selected_imagedef.id = s;
        selected_imagedef.type = image.getAttribute('type');
        let selected_nodes = image.childNodes;
        for (let l = 0; l < selected_nodes.length; ++l) {
          if (selected_nodes[l].nodeName === 'UUENCODE') {
            const decoder = new uudecode();
            selected_imagedef.size = parseInt(
              selected_nodes[l].getAttribute('size'),
              10,
            );
            selected_imagedef.imageData =
              `data:image/${selected_imagedef.type.toLowerCase()};base64,` +
              decoder.decode(selected_nodes[l], selected_imagedef.size);
          }
        }
        break;
      }
    }

    sheet.images[selected_imagedef.id] = selected_imagedef;
    return selected_imagedef;
  }

  private symboldef(root: any, sheet: dsnSheet, sId: string) {
    const s = parseInt(sId, 10);
    if (s in sheet.symbols) {
      return sheet.symbols[s];
    }
    let symbols = root.getElementsByTagName('SYMBOLDEF');
    let selected_symboldef: libSymbol = {
      id: null,
      description: null,
      name: null,
      ref: null,
      outlines: [
        {
          active_points: [],
          items: [],
          ref_point: [0, 0],
          size: [0, 0],
        },
      ],
      parts: 1,
      uid: null,
      heterogeneous: false,
    };
    for (let k = 0; k < symbols.length; ++k) {
      let symbol = symbols[k];
      if (parseInt(symbol.getAttribute('id'), 10) === s) {
        let selected_nodes = symbol.childNodes;
        let ref_point = null;
        selected_symboldef.id = s;
        for (let l = 0; l < selected_nodes.length; ++l) {
          if (selected_nodes[l].nodeName === 'REF_POINT') {
            ref_point = this.coords(selected_nodes[l].getAttribute('pos'));
          } else if (selected_nodes[l].nodeName === 'GUID') {
            selected_symboldef.uid = this.nodeText(selected_nodes[l]);
          } else if (selected_nodes[l].nodeName === 'NAME') {
            selected_symboldef.name = {
              value: this.nodeText(selected_nodes[l]),
              type: parseInt(selected_nodes[l].getAttribute('type'), 10),
            };
          } else if (selected_nodes[l].nodeName === 'REF') {
            selected_symboldef.ref = {
              value: this.nodeText(selected_nodes[l]),
              type: parseInt(selected_nodes[l].getAttribute('type'), 10),
            };
          } else if (selected_nodes[l].nodeName === 'DESCRIPTION') {
            selected_symboldef.description = this.nodeText(selected_nodes[l]);
          } else if (selected_nodes[l].nodeName === 'PPP') {
            selected_symboldef.parts = parseInt(
              this.nodeText(selected_nodes[l]),
              10,
            );
          } else if (selected_nodes[l].nodeName === 'TinyCAD') {
            let def = this.from_tinycad(root, selected_nodes[l], false).items;
            if (def.length > 0) {
              const snap = new Snap(
                sheet.details.grid,
                sheet.details.grid_snap,
              );
              selected_symboldef.outlines = [
                this.normalize_symbol(def, snap, ref_point, false, false),
              ];
              selected_symboldef.heterogeneous = false;
            }
          } else if (selected_nodes[l].nodeName === 'TinyCADSheets') {
            let outlinesNodes = selected_nodes[l].childNodes;
            selected_symboldef.outlines = [];
            selected_symboldef.heterogeneous = true;
            for (let m = 0; m < outlinesNodes.length; ++m) {
              if (outlinesNodes[m].nodeName === 'TinyCAD') {
                let def = this.from_tinycad(
                  root,
                  selected_nodes[l],
                  false,
                ).items;
                if (def.length > 0) {
                  const snap = new Snap(
                    sheet.details.grid,
                    sheet.details.grid_snap,
                  );
                  selected_symboldef.outlines.push(
                    this.normalize_symbol(def, snap, ref_point, false, true),
                  );
                }
              }
            }
          }
        }

        // Do we have a UID?
        if (!selected_symboldef.uid) {
          let d = JSON.stringify(selected_symboldef.outlines);
          selected_symboldef.uid = md5(d);
        }
        break;
      }
    }

    sheet.symbols[selected_symboldef.id] = selected_symboldef;
    return selected_symboldef;
  }

  //
  // Calculate the origin so that it is the bottom right of the symbol
  // (this is the same as TinyCAD).
  // Also calculate the width and the height of the symbol.
  //
  public normalize_symbol(
    items: DocItem[],
    snap: Snap,
    ref_point: Coordinate,
    show_power: boolean,
    heterogeneous: boolean,
  ): libSymbolPart {
    // Snap the pins to the grid
    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;
    let first = true;
    let has_pins = false;
    let pin: Coordinate = null;

    const r: libSymbolPart = {
      items: items,
      size: null,
      ref_point: ref_point,
      active_points: [],
    };

    for (let i = 0; i < items.length; ++i) {
      const obj = items[i];

      // Normalize the _id for each item as this makes the outcome
      // of the md5 below (for uid) consistant.
      obj._id = i + 1;

      let r;
      const update_obj = updateFactory(obj);
      if (obj.NodeName === DocItemTypes.Pin) {
        const update_pin = new updatePin(obj);
        if (!update_pin.shown(show_power, false, heterogeneous)) {
          continue;
        }
        if (!has_pins) {
          has_pins = true;
          pin = obj.point;
        }
      }
      r = update_obj.getBoundingRect();

      if (first) {
        x1 = r.x1;
        y1 = r.y1;
        x2 = r.x2;
        y2 = r.y2;
        first = false;
      } else {
        x1 = Math.min(x1, r.x1);
        y1 = Math.min(y1, r.y1);
        x2 = Math.max(x2, r.x2);
        y2 = Math.max(y2, r.y2);
      }
    }

    let snapa: Coordinate = null;
    if (!!ref_point) {
      snapa = ref_point.slice();
    } else {
      snapa = snap.snap([x2, y2]);
      if (has_pins) {
        // Snap the co-ords of the pin to the grid
        const snap_pin = snap.snap(pin);
        snapa = [
          snapa[0] + pin[0] - snap_pin[0],
          snapa[1] + pin[1] - snap_pin[1],
        ];
      }
      // Make sure snapping is always positive
      if (snapa[0] < x2) {
        snapa[0] += snap._grid;
      }
      if (snapa[1] < y2) {
        snapa[1] += snap._grid;
      }
    }

    // Move the symbol to [0,0]
    r.ref_point = snapa.slice();

    x1 -= snapa[0];
    y1 -= snapa[1];
    x2 -= snapa[0];
    y2 -= snapa[1];

    let a = snap.snap_negative([x1, y1]);
    let b = snap.snap_positive([x2, y2]);
    r.size = [b[0] - a[0], b[1] - a[1]];

    for (let i = 0; i < items.length; ++i) {
      // If this is a pin then we need to store
      // the location of the connection point in our
      // active points
      let obj = items[i];
      if (obj.NodeName === DocItemTypes.Pin) {
        let active_point = {
          pos: obj.point.slice(),
          power: obj.which == 4,
          part: heterogeneous ? 0 : obj.part,
          pin: obj,
        };
        active_point.pos[0] -= r.ref_point[0];
        active_point.pos[1] -= r.ref_point[1];
        r.active_points.push(active_point);
      }
    }

    return r;
  }

  private lookup_item(a: any[], i: any) {
    for (let index = 0; index < a.length; ++index) {
      let ok = true;
      for (var k in a[index]) {
        if (a[index][k] !== i[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return index + 1;
      }
    }

    a.push(i);
    return a.length;
  }
}

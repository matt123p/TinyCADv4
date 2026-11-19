import { bundledLibraries } from '../io/bundledLibraries';
import { searchBundledSymbols } from './bundled-search';
import { bundledLibraryInstructions } from './prompt';
import { onlineLibraryUrl } from '../io/apiServer';
import { fetchOnlineLibrary } from '../io/onlineLibrary';
import { Store } from 'redux';
import { ioXML } from '../io/ioXml';
import { XMLBuilder } from '../util/xmlbuilder';
import { docDrawing } from '../state/undo/undo';
import { DocActionTypes } from '../state/actions/docActions';
import { toolSpecs, checkArguments } from './tool-specs';
import { ToolExecutor, ToolResult } from './types';
import { nativeCall } from './native-client';
import { rasterizeSvg } from './preview';
import resources from './skill/resources.json';
import { children } from './validation';
import {
  StoredComponent,
  librarySummary,
  prepareLibraryAddition,
} from './library-edit';

export interface ChatArtifact {
  name: string;
  blob: Blob;
}
export function createEditorTools(
  store: Store,
  artifact: (file: ChatArtifact) => void,
  native = nativeCall,
  send = fetchOnlineLibrary,
): ToolExecutor {
  const revisions = new WeakMap<
    object,
    { library: object; symbol: object; value: string }[]
  >();
  const components = new Map<string, StoredComponent>();
  const retain = (
    component: Omit<StoredComponent, 'componentId'>,
  ): StoredComponent => {
    if (components.size >= 2048)
      throw new Error('Component session is full. Start a new chat.');
    const saved = { ...component, componentId: crypto.randomUUID() };
    components.set(saved.componentId, saved);
    return saved;
  };
  let nextRevision = 1;
  const found = new Map<number, any>();
  const bundledFound = new Map<string, string>();
  const present = () => (store.getState() as docDrawing).docStore.present;
  const revision = () => {
    const { drawing, editLibrary: library, editSymbol: symbol } = present();
    const entries = revisions.get(drawing) || [];
    let entry = entries.find(
      (item) => item.library === library && item.symbol === symbol,
    );
    if (!entry) {
      entry = { library, symbol, value: String(nextRevision++) };
      entries.push(entry);
      revisions.set(drawing, entries);
    }
    return entry.value;
  };
  const currentXml = () => {
    const state = present(),
      xml = new ioXML().to_dsn(state.drawing, !state.editSymbol, true);
    if (state.editSymbol && state.drawing.sheets.length === 1) {
      // Symbol validators/tools use a standalone TinyCAD container.
      const sheet = children(xml.xmlDoc.documentElement).find(
        (n) => n.nodeName === 'TinyCAD',
      );
      const out = new XMLBuilder();
      out.createDoc('TinyCAD');
      for (const n of children(sheet))
        out.insert.appendChild(out.xmlDoc.importNode(n, true));
      return out.tostring();
    }
    return xml.tostring();
  };
  const current = () => {
    const state = present(),
      sheet = state.view.selected_sheet;
    return {
      definition: currentXml(),
      revision: revision(),
      mode: state.editLibrary ? 'library' : 'circuit',
      library: state.editLibrary ? librarySummary(state) : undefined,
      activeSheet: sheet + 1,
      // IDs are native to the exact serialized XML, not the live editor's IDs.
      selectedIndexes: (state.drawing.sheets[sheet]?.items || []).flatMap(
        (item, i) => (state.view._selected_array.includes(item._id) ? [i] : []),
      ),
      symbol: state.editSymbol,
    };
  };
  const emit = (name: string, content: string, mime: string) =>
    artifact({ name, blob: new Blob([content], { type: mime }) });
  const renderResult = async (
    data: any,
    args: any,
    signal: AbortSignal,
  ): Promise<ToolResult> => {
    if (!data.svg) return { data };
    const { svg, ...rest } = data;
    const format = args.format ?? 'both';
    const images =
      format !== 'svg'
        ? [await rasterizeSvg(svg, args.pixels ?? 512, signal)]
        : [];
    return {
      data: {
        ...rest,
        ...(format !== 'png' ? { svg } : {}),
        preview: 'Preview is available in the tool activity.',
      },
      images,
    };
  };
  const resolveComponent = async (componentId: string, signal: AbortSignal) => {
    const asset = components.get(componentId);
    if (!asset)
      throw new Error(
        'Unknown componentId. Use search_bundled_symbols, search_symbols, create_ic_symbol or store_component first.',
      );
    if (asset.definition) return asset;
    const source = asset.source;
    const response = await send(
      onlineLibraryUrl(`/api/search/copy?${new URLSearchParams({
        id: String(source.symbolId),
        name: source.name,
      })}`),
      { signal, credentials: 'omit' },
    );
    if (!response.ok) throw new Error(`Library fetch HTTP ${response.status}.`);
    const clipboardDefinition = await response.text();
    const xml = new XMLBuilder();
    xml.fromText(clipboardDefinition);
    const root = xml.xmlDoc.documentElement;
    const def = children(root).find((n) => n.nodeName === 'SYMBOLDEF');
    const artwork = children(def).find((n) => n.nodeName === 'TinyCAD');
    if (!artwork)
      throw new Error('Library response has no standalone symbol artwork.');
    const output = new XMLBuilder();
    output.createDoc('TinyCAD');
    for (const n of [
      ...children(root).filter((n) =>
        ['FONT', 'STYLE', 'FILL'].includes(n.nodeName),
      ),
      ...children(artwork),
    ])
      output.insert.appendChild(output.xmlDoc.importNode(n, true));
    const definition = output.tostring();
    const ppp = Number(
      children(def).find((n) => n.nodeName === 'PPP')?.textContent || 1,
    );
    if (ppp !== 1)
      throw new Error(
        'This library part has multiple units. Choose a supported single-unit symbol.',
      );
    const fields = children(
      children(root).find((n) => n.nodeName === 'SYMBOL'),
    );
    asset.definition = definition;
    asset.reference =
      fields
        .find((n) => n.getAttribute('description') === 'Ref')
        ?.getAttribute('value') ||
      children(def).find((n) => n.nodeName === 'REF')?.textContent ||
      'U?';
    asset.attributes = fields
      .filter(
        (n) =>
          n.getAttribute('description') &&
          !['Name', 'Ref'].includes(n.getAttribute('description')),
      )
      .map((n) => ({
        name: n.getAttribute('description'),
        value: n.getAttribute('value') || '',
      }));
    return asset;
  };
  const compact = (asset: StoredComponent) => {
    const xml = new XMLBuilder();
    xml.fromText(asset.definition);
    const pins = Array.from<Element>(
      xml.xmlDoc.getElementsByTagName('PIN'),
    ).map((pin) => ({
      number: pin.getAttribute('number'),
      name: pin.textContent,
      electricalType: pin.getAttribute('elec'),
      part: pin.getAttribute('part'),
      position: pin.getAttribute('pos'),
    }));
    return {
      componentId: asset.componentId,
      ...(asset.source
        ? {
            symbolId: asset.source.symbolId,
            nameId: asset.source.nameId,
            ...(asset.source.libraryId
              ? {
                  libraryId: asset.source.libraryId,
                  libraryName: asset.source.libraryName,
                }
              : {}),
          }
        : {}),
      name: asset.name,
      reference: asset.reference,
      description: asset.description,
      attributes: asset.attributes,
      pins,
    };
  };
  return async (name, input, signal) => {
    const spec = toolSpecs.find((t) => t.name === name);
    if (!spec) throw new Error(`Unknown tool ${name}.`);
    checkArguments(input, spec.parameters);
    const args: any = { ...input };
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    if (name === 'read_skill_reference') {
      await bundledLibraries.initialize();
      return {
        data: {
          path: args.path,
          content:
            args.path === 'SKILL.md'
              ? bundledLibraryInstructions(
                  bundledLibraries.getSnapshot().catalog?.libraries,
                ) +
                '\n' +
                resources['references/editor-common.md'] +
                '\n' +
                resources[
                  present().editLibrary
                    ? 'references/editor-library.md'
                    : 'references/editor-drawing.md'
                ]
              : (resources as Record<string, string>)[args.path],
        },
      };
    }
    if (name === 'read_drawing' || name === 'read_metadata') {
      const snapshot = current();
      const info = await native(
        'inspect_drawing',
        { definition: snapshot.definition },
        signal,
      );
      const { selectedIndexes, ...context } = snapshot;
      const selectedIds = selectedIndexes
        .map((i) => info.metadata[snapshot.activeSheet - 1]?.items[i]?.id)
        .filter(Number.isInteger);
      return {
        data:
          name === 'read_drawing'
            ? { ...context, ...info, selectedIds }
            : {
                ...info,
                revision: snapshot.revision,
                mode: snapshot.mode,
                library: snapshot.library,
                activeSheet: snapshot.activeSheet,
                selectedIds,
              },
      };
    }
    if (name === 'search_bundled_symbols') {
      const { matches, ...result } = await searchBundledSymbols(
        bundledLibraries,
        args,
        signal,
      );
      const symbols = matches.map(({ library, entry, definition }) => {
        const key = JSON.stringify([library.id, entry.NameID]);
        let componentId = bundledFound.get(key);
        if (!componentId) {
          componentId = retain({
            name: entry.Name,
            reference: entry.Reference,
            description: entry.Description,
            definition,
            attributes: entry.Attributes.map((attribute) => ({
              name: attribute.AttName,
              value: attribute.AttValue,
            })),
            source: {
              libraryId: library.id,
              libraryName: library.name,
              symbolId: entry.SymbolID,
              nameId: entry.NameID,
            },
          }).componentId;
          bundledFound.set(key, componentId);
        }
        return {
          componentId,
          libraryId: library.id,
          libraryName: library.name,
          symbolId: entry.SymbolID,
          nameId: entry.NameID,
          name: entry.Name,
          description: entry.Description,
          reference: entry.Reference,
          partsPerPackage: entry.ppp,
        };
      });
      return { data: { ...result, symbols } };
    }
    if (name === 'search_symbols') {
      if (!args.query.trim())
        throw new Error('Enter a nonempty library query.');
      const page = args.page ?? 1,
        pageSize = args.pageSize ?? 5;
      // Existing library REST search has fixed 25-result pages. Re-page locally.
      const offset = (page - 1) * pageSize,
        first = Math.floor(offset / 25) + 1;
      const query = async (p: number) => {
        const response = await send(
          onlineLibraryUrl(`/api/search/search?${new URLSearchParams({
            key: args.query,
            page: String(p),
            orderBy: 'd',
          })}`),
          { signal, credentials: 'omit' },
        );
        if (!response.ok)
          throw new Error(`Library search HTTP ${response.status}.`);
        return response.json();
      };
      const data = await query(first);
      const list = [...(data.symbols || [])];
      if ((offset % 25) + pageSize > 25 && data.total > first * 25)
        list.push(...((await query(first + 1)).symbols || []));
      const symbols = list
        .slice(offset % 25, (offset % 25) + pageSize)
        .map((s) => {
          const previous = found.get(s.nameID);
          const componentId =
            previous?.componentId ||
            retain({
              name: s.name,
              description: s.description,
              source: { ...s, symbolId: s.symbolID, nameId: s.nameID },
            }).componentId;
          const symbol = {
            ...s,
            symbolId: s.symbolID,
            nameId: s.nameID,
            componentId,
          };
          found.set(symbol.nameId, symbol);
          return symbol;
        });
      return {
        data: {
          page,
          pageSize,
          hasMore: offset + symbols.length < data.total,
          symbols,
        },
      };
    }
    if (name === 'get_symbol') {
      const source = args.nameId
        ? found.get(args.nameId)
        : Array.from(found.values()).find(
            (item) => item.symbolId === args.symbolId,
          );
      const id =
        args.componentId ||
        (source && (!args.symbolId || source.symbolId === args.symbolId)
          ? source.componentId
          : undefined);
      const asset = await resolveComponent(id, signal);
      const validation = await native(
        'validate_component',
        {
          definition: asset.definition,
          librarySymbol: !!asset.source?.libraryId,
        },
        signal,
      );
      return renderResult(
        {
          ...compact(asset),
          validation,
          ...(args.includeDefinition ? { definition: asset.definition } : {}),
          ...(validation.valid
            ? await native(
                'render_component',
                {
                  definition: asset.definition,
                  librarySymbol: !!asset.source?.libraryId,
                },
                signal,
              )
            : {
                guidance:
                  'Request includeDefinition=true and repair this legacy artwork before placing it.',
              }),
        },
        args,
        signal,
      );
    }
    if (name === 'create_ic_symbol' || name === 'store_component') {
      const data =
        name === 'create_ic_symbol'
          ? await native(name, args, signal)
          : { definition: args.definition };
      const validation = await native(
        'validate_component',
        { definition: data.definition },
        signal,
      );
      if (!validation.valid) return { error: true, data: validation };
      const asset = retain({
        name: args.name,
        reference: args.reference || 'U?',
        description: args.description,
        definition: data.definition,
      });
      const { definition, ...rest } = data;
      return renderResult(
        {
          ...rest,
          ...compact(asset),
          validation,
          ...(args.includeDefinition ? { definition } : {}),
        },
        args,
        signal,
      );
    }
    if (name === 'read_library')
      return {
        data: {
          revision: revision(),
          mode: present().editLibrary ? 'library' : 'circuit',
          ...librarySummary(present()),
        },
      };
    if (name === 'add_library_components') {
      const before = present();
      if (args.baseRevision !== revision())
        throw new Error(
          'The editor changed. Read metadata again before editing.',
        );
      if (!before.editLibrary)
        throw new Error('Open a library before adding reusable components.');
      const additions: StoredComponent[] = [];
      for (const item of args.components) {
        const asset = await resolveComponent(item.componentId, signal);
        const component = { ...asset, ...item, name: item.name || asset.name };
        const validation = await native(
          'validate_component',
          {
            definition: component.definition,
            librarySymbol: !!component.source?.libraryId,
          },
          signal,
        );
        if (!validation.valid) return { error: true, data: validation };
        additions.push(component);
      }
      const staged = prepareLibraryAddition(before, additions);
      signal.throwIfAborted();
      if (
        present().drawing !== before.drawing ||
        present().editLibrary !== before.editLibrary ||
        present().editSymbol !== before.editSymbol
      )
        throw new Error(
          'The library changed during validation. No edit was applied.',
        );
      store.dispatch({
        type: DocActionTypes.ApplyChatLibrary,
        source: before.drawing,
        sourceLibrary: before.editLibrary,
        sourceSymbol: before.editSymbol,
        ...staged,
      });
      if (present().editLibrary !== staged.library)
        throw new Error('The editor rejected a stale library edit.');
      return {
        data: {
          applied: true,
          revision: revision(),
          added: staged.added.map((item) => ({
            nameId: item.NameID,
            symbolId: item.SymbolID,
            name: item.Name,
          })),
          undo: 'Undo restores the previous library and active symbol.',
        },
      };
    }
    if (
      [
        'set_drawing',
        'edit_drawing',
        'add_to_drawing',
        'insert_symbol',
        'place_component',
        'auto_layout',
      ].includes(name)
    ) {
      const before = present(),
        source = before.drawing;
      if (args.baseRevision !== revision())
        throw new Error(
          'The drawing changed. Call read_drawing again before editing.',
        );
      if (before.editLibrary && !before.editSymbol)
        throw new Error('Open a circuit or library symbol before editing.');
      if (
        ['insert_symbol', 'place_component', 'auto_layout'].includes(name) &&
        before.editLibrary
      )
        throw new Error(
          'Open a circuit drawing to insert a component instance.',
        );
      if (
        name === 'place_component' ||
        (name === 'insert_symbol' && args.componentId)
      ) {
        const asset = await resolveComponent(args.componentId, signal);
        args.componentDefinition = asset.definition;
        args.librarySymbol = !!asset.source?.libraryId;
        args.name ||= asset.name;
        args.description ||= asset.description;
        args.attributes ||= asset.attributes;
        if (!args.reference) {
          const prefix =
            (asset.reference || 'U?').replace(/[?*\d]+$/g, '') || 'U';
          const refs = new Set(
            before.drawing.sheets.flatMap((sheet) =>
              sheet.items.flatMap((item) =>
                item.NodeName === 'symbol'
                  ? item.text
                      .filter((field) => field.description === 'Ref')
                      .map((field) => field.value.toLowerCase())
                  : [],
              ),
            ),
          );
          let number = 1;
          while (refs.has(`${prefix}${number}`.toLowerCase())) number++;
          args.reference = `${prefix}${number}`;
        }
      }
      if (name === 'insert_symbol' || name === 'place_component') {
        if (!args.componentDefinition || !args.name)
          throw new Error(
            'Provide a componentId or componentDefinition and name.',
          );
        args.sheet ??= before.view.selected_sheet + 1;
        const items = before.drawing.sheets[args.sheet - 1]?.items || [];
        args.x ??=
          Math.ceil(
            Math.max(
              100,
              ...items.map((item: any) => Number(item.point?.[0] || 0)),
            ) / 10,
          ) *
            2 +
          20;
        args.y ??= 40;
      }
      let placement: any = {};
      let definition = args.definition;
      if (name !== 'set_drawing') {
        placement = await native(
          name === 'place_component'
            ? 'insert_symbol'
            : name === 'auto_layout'
            ? 'auto_tidy_drawing'
            : name,
          {
            ...args,
            sheet: args.sheet ?? before.view.selected_sheet + 1,
            definition: currentXml(),
            component: !!before.editSymbol,
          },
          signal,
        );
        if (
          name === 'auto_layout' &&
          (!placement.connectivityPreserved ||
            !placement.serializationConnectivityPreserved)
        )
          throw new Error(
            'Layout did not preserve connectivity. No edit was applied.',
          );
        definition = placement.definition;
      }
      const validation = await native(
        before.editSymbol ? 'validate_component' : 'validate_drawing',
        { definition },
        signal,
      );
      if (
        !(before.editSymbol ? validation.valid : validation.structurallyValid)
      )
        return { error: true, data: validation };
      const xml = new XMLBuilder();
      xml.fromText(definition);
      const drawing = new ioXML().from_dsn(xml);
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (
        present().drawing !== source ||
        present().editSymbol !== before.editSymbol ||
        present().editLibrary !== before.editLibrary
      )
        throw new Error(
          'The document changed during validation. Read it again; no edit was applied.',
        );
      store.dispatch({
        type: DocActionTypes.ApplyChatEdit,
        source,
        sourceSymbol: before.editSymbol,
        drawing,
      });
      if (present().drawing !== drawing)
        throw new Error(
          'The editor rejected a stale edit. Read the current document.',
        );
      return {
        data: {
          applied: true,
          ...(name === 'auto_layout'
            ? {
                layout: Object.fromEntries(
                  Object.entries(placement).filter(
                    ([key]) => key !== 'definition',
                  ),
                ),
              }
            : {}),
          ...(['insert_symbol', 'place_component'].includes(name)
            ? { reference: placement.reference, pins: placement.pins }
            : {}),
          revision: revision(),
          validation,
          undo: 'Use Edit → Undo to restore the previous drawing.',
        },
      };
    }
    if (name === 'export_file') {
      const definition = args.definition ?? currentXml(),
        component = args.kind !== 'drawing';
      const validation = await native(
        component ? 'validate_component' : 'validate_drawing',
        { definition },
        signal,
      );
      if (!(component ? validation.valid : validation.structurallyValid))
        return { data: validation, error: true };
      const safe =
        args.filename
          .replace(/[\\/\x00-\x1f]/g, '_')
          .replace(/\.(dsn|xml|tclib)$/i, '') || 'TinyCAD';
      if (args.kind === 'library') {
        if (!args.name?.trim())
          throw new Error('Library export requires the component name.');
        const { saveTcLibrary } = await import('../io/tclib');
        const bytes = await saveTcLibrary({
          name: args.name,
          fileId: null,
          modified: '',
          symbols: [{ SymbolId: 1, Data: definition }],
          names: [
            {
              NameID: 1,
              SymbolID: 1,
              Name: args.name,
              Reference: args.reference ?? 'U?',
              ppp: 1,
              Description: args.description ?? '',
              ShowName: 0,
              ShowRef: 0,
              Attributes: (args.attributes || []).map(
                (a: { name: string; value: string }) => ({
                  AttName: a.name,
                  AttValue: a.value,
                  ShowAtt: 1,
                }),
              ),
            },
          ],
        });
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        artifact({
          name: `${safe}.TCLib`,
          blob: new Blob([bytes], { type: 'application/octet-stream' }),
        });
      } else
        emit(
          `${safe}.${component ? 'xml' : 'dsn'}`,
          definition,
          'application/xml',
        );
      return {
        data: {
          exported: true,
          filename: `${safe}.${
            args.kind === 'library' ? 'TCLib' : component ? 'xml' : 'dsn'
          }`,
          validation,
        },
      };
    }
    if (
      [
        'validate_drawing',
        'render_drawing',
        'auto_tidy_drawing',
        'read_netlist',
      ].includes(name)
    )
      args.definition ??= currentXml();
    return renderResult(await native(name, args, signal), args, signal);
  };
}

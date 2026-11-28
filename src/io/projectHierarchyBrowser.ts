import { DocItemTypes } from '../model/dsnItem';
import type { dsnDrawing } from '../model/dsnDrawing';
import {
  activeSchematicTabKey,
  openSchematicTabs,
} from '../state/schematicTabs';
import type { docDrawing } from '../state/undo/undo';
import type { HierarchyLink, HierarchyScan } from './projectStorage';

export interface HierarchyDesign {
  key: string;
  id?: string;
  filename: string;
  path: string;
  tab?: string;
  hasSymbol: boolean;
  hasSymbolSheet?: boolean;
  unreadable?: boolean;
  drawing?: dsnDrawing;
  links: (HierarchyLink & { target?: string; owner?: string; error?: string; resolved?: boolean })[];
}

export interface HierarchyNode {
  key: string;
  design?: HierarchyDesign;
  filename: string;
  reference?: string;
  cycle?: boolean;
  error?: string;
  issue?: 'unavailable' | 'missingSymbolSheet' | 'unreadableLink';
  children: HierarchyNode[];
}

const slash = (name: string) => name.replaceAll('\\', '/');
const basename = (name: string) => slash(name).split('/').at(-1);

export function searchHierarchy(
  tree: HierarchyNode[],
  candidates: HierarchyDesign[],
  query: string,
) {
  const normalized = slash(query).trim().toLowerCase();
  if (!normalized) return { tree, candidates };
  const terms = normalized.split(/\s+/);
  const matches = (...fields: (string | undefined)[]) => {
    const text = slash(fields.join(' ')).toLowerCase();
    return terms.every((term) => text.includes(term));
  };

  function filter(nodes: HierarchyNode[]): HierarchyNode[] {
    return nodes.flatMap((node) => {
      const children = filter(node.children);
      return children.length ||
        matches(node.filename, node.design?.path, node.reference)
        ? [{ ...node, children }]
        : [];
    });
  }

  return {
    tree: filter(tree),
    candidates: candidates.filter(({ filename, path }) =>
      matches(filename, path),
    ),
  };
}

export function hierarchyBrowserModel(
  project: string,
  scan: HierarchyScan | undefined,
  state: docDrawing,
  showActive: boolean,
) {
  const windows = project.includes('\\');
  const separator = windows ? '\\' : '/';
  const root = slash(project).replace(/\/$/, '');
  const pathKey = (name: string) => (windows ? name.toLowerCase() : name);
  const pathInProject = (id: string) => {
    const value = slash(id);
    return pathKey(value).startsWith(pathKey(root + '/'))
      ? value.slice(root.length + 1)
      : undefined;
  };
  const targetKey = (filename: string, owner?: string) => {
    if (!/\.(?:dsn|dzn)$/i.test(filename) || filename.includes('\0'))
      return undefined;
    const target = slash(filename);
    const absolute = /^(?:\/|[A-Za-z]:)/.test(target);
    const relative = absolute ? pathInProject(target) : target;
    if (relative === undefined) return undefined;
    const ownerPath =
      owner && pathKey(slash(owner)) !== pathKey(root)
        ? pathInProject(owner)
        : '';
    if (!absolute && ownerPath === undefined) return undefined;
    const parts = absolute ? [] : (ownerPath || '').split('/').slice(0, -1);
    for (const part of relative.split('/')) {
      if (part === '..') {
        if (!parts.length) return undefined;
        parts.pop();
      } else if (part && part !== '.') parts.push(part);
    }
    return pathKey(parts.join('/'));
  };

  const designs = new Map<string, HierarchyDesign>();
  for (const file of scan?.drawings ?? []) {
    const key = pathKey(file.path);
    designs.set(key, {
      ...file,
      key,
      filename: basename(file.path),
      id:
        project.replace(/[\\/]$/, '') +
        separator +
        file.path.replaceAll('/', separator),
    });
  }
  const activeTab = showActive ? activeSchematicTabKey(state) : undefined;
  let active: HierarchyDesign;
  for (const { key: tab, tab: snapshot } of openSchematicTabs(state)) {
    const id =
      typeof snapshot.file.id === 'string' ? snapshot.file.id : undefined;
    const relative = id ? pathInProject(id) : undefined;
    if (id && relative === undefined) continue;
    const key = id ? pathKey(relative) : 'draft:' + tab;
    const drawing = snapshot.history.present.drawing;
    const design: HierarchyDesign = {
      key,
      id,
      tab,
      filename: snapshot.file.name,
      path: relative ?? snapshot.file.name,
      drawing,
      hasSymbol: !!drawing.sheets[0]?.hierarchicalSymbol,
      hasSymbolSheet: drawing.sheets.some((sheet) => sheet.hierarchicalSymbol),
      links: drawing.sheets.flatMap((sheet) =>
        sheet.hierarchicalSymbol
          ? []
          : sheet.items.flatMap((item) =>
              item.NodeName === DocItemTypes.Symbol &&
              item.hierarchicalFile !== undefined
                ? [
                    {
                      filename: item.hierarchicalFile,
                      owner: item._hierarchicalOwner,
                      error: item._hierarchicalError,
                      resolved: !!item._hierarchicalDrawing,
                      reference:
                        item.text.find((field) => field.description === 'Ref')
                          ?.value ?? '',
                    },
                  ]
                : [],
            ),
      ),
    };
    designs.set(key, design);
    if (tab === activeTab) active = design;
  }

  const parents = new Map<string, Set<string>>();
  for (const design of designs.values()) {
    design.links = design.links.map((link) => {
      const target = targetKey(link.filename, link.owner ?? design.id);
      if (target && designs.has(target)) {
        if (!parents.has(target)) parents.set(target, new Set());
        parents.get(target).add(design.key);
      }
      return { ...link, target };
    });
  }
  const ancestors = new Set<string>();
  const roots: string[] = [];
  if (active && (active.links.length || parents.has(active.key))) {
    const queue = [active.key];
    while (queue.length) {
      const key = queue.pop();
      if (ancestors.has(key)) continue;
      ancestors.add(key);
      const incoming = parents.get(key);
      if (incoming?.size) queue.push(...incoming);
      else roots.push(key);
    }
    if (!roots.length) roots.push(active.key);
  }

  let count = 0;
  let limited = false;
  function children(
    design: HierarchyDesign,
    prefix: string,
    seen: Set<string>,
  ): HierarchyNode[] {
    const result: HierarchyNode[] = [];
    for (const [index, link] of design.links.entries()) {
      if (count >= 1500 || seen.size > 64) {
        limited = true;
        break;
      }
      count++;
      const child = designs.get(link.target);
      const key = prefix + '/' + index;
      const cycle = !!child && seen.has(child.key);
      let issue: HierarchyNode['issue'];
      if (child?.unreadable) issue = 'unreadableLink';
      else if (child && !(child.hasSymbolSheet ?? child.hasSymbol))
        issue = 'missingSymbolSheet';
      else if (!child && !link.resolved && scan && !scan.limited) issue = 'unavailable';
      result.push({
        key,
        design: child,
        filename: child?.filename ?? basename(link.filename),
        reference: link.reference,
        cycle,
        error: link.error,
        issue,
        children:
          child && !cycle && !link.error && !issue
            ? children(child, key, new Set([...seen, child.key]))
            : [],
      });
    }
    return result;
  }
  const tree = roots.sort().map((key) => {
    const design = designs.get(key);
    const instance = JSON.stringify(key);
    return {
      key: instance,
      design,
      filename: design.filename,
      children: children(design, instance, new Set([key])),
    };
  });
  const candidates = [...designs.values()]
    .filter((design) => design.hasSymbol)
    .sort((a, b) => a.path.localeCompare(b.path));
  if (active) ancestors.add(active.key);
  return { tree, active, candidates, limited, placementCycles: ancestors };
}

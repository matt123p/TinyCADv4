import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import type { PluginPackage } from './types';
import { resolvePath } from './validation';
import { openExternalUrl } from '../util/navigation';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const markdown = new Marked({ renderer: {
  html: () => '',
  image: ({ href, text }) => `<span data-plugin-image="${escape(href)}" data-alt="${escape(text)}"></span>`,
} });
export function MarkdownDocumentation({ pkg, entry }: { pkg: PluginPackage; entry: string }) {
  const [page, setPage] = useState(entry); const [error, setError] = useState(''); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setPage(entry); setError(''); }, [entry, pkg.digest]);
  const content = useMemo(() => pkg.files[page] ? new TextDecoder().decode(pkg.files[page]) : '', [pkg, page]);
  useEffect(() => {
    if (!root.current) return;
    const urls: string[] = []; const template = document.createElement('template');
    template.innerHTML = DOMPurify.sanitize(markdown.parse(content, { async: false }) as string, {
      USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'style', 'iframe', 'object', 'form', 'input', 'button'],
      FORBID_ATTR: ['style', 'src', 'srcset'],
    });
    const slugs = new Map<string, number>();
    for (const heading of Array.from(template.content.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
      const slug = (heading.textContent || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
      const count = slugs.get(slug) || 0; slugs.set(slug, count + 1); heading.id = slug + (count ? '-' + count : '');
    }
    for (const span of Array.from(template.content.querySelectorAll<HTMLElement>('[data-plugin-image]'))) {
      try {
        const source = span.dataset.pluginImage!;
        if (/^[a-z]+:|^\/\//i.test(source)) { span.textContent = `[External image: ${span.dataset.alt || source}]`; continue; }
        const file = resolvePath(page, decodeURIComponent(source)); const bytes = pkg.files[file];
        const extension = file.split('.').pop()?.toLowerCase(); const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[extension!];
        if (!bytes || !mime) throw new Error('Unsupported documentation image.');
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })); urls.push(url);
        const image = document.createElement('img'); image.src = url; image.alt = span.dataset.alt || ''; image.style.maxWidth = '100%'; span.replaceWith(image);
      } catch { span.textContent = '[Image unavailable]'; }
    }
    root.current.replaceChildren(template.content);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [content, page, pkg]);
  const navigate = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest('a'); if (!anchor) return; event.preventDefault();
    const href = anchor.getAttribute('href'); if (!href) return;
    if (/^https:\/\//i.test(href)) { openExternalUrl(href); return; }
    if (/^[a-z]+:|^\/\//i.test(href)) { setError('This link type is not supported.'); return; }
    try {
      const [target, fragment] = href.split('#'); const file = target ? resolvePath(page, decodeURIComponent(target)) : page;
      if (!file.toLowerCase().endsWith('.md') || !pkg.files[file]) throw new Error('This Markdown page is not included in the plugin package.');
      setPage(file); setError('');
      if (fragment) setTimeout(() => { root.current?.querySelectorAll('[id]').forEach(node => { if (node.id === decodeURIComponent(fragment)) node.scrollIntoView(); }); }, 0);
    } catch (err) { setError((err as Error).message); }
  };
  return <div className="plugin-documentation">
    <div className="plugin-documentation-location">{pkg.manifest.name} {pkg.manifest.version} · {page}</div>
    {page !== entry && <button onClick={() => setPage(entry)}>Back to documentation contents</button>}
    {error && <p role="alert">{error}</p>}
    {!pkg.files[page] && <p role="alert">This documentation page is unavailable.</p>}
    <div ref={root} className="plugin-markdown" onClick={navigate} />
  </div>;
}

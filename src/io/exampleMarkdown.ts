import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ExampleContent } from '../../shared/bundledExamples';
import {
  exampleResourcePaths,
  resolveExampleResource,
  exampleImageExtensions,
  exampleMediaExtensions,
  exampleVideoExtensions,
} from '../../shared/bundledExamples';
import { exampleResources, ExampleImage } from './examples';

export interface ExampleMarkdown {
  html: string;
  dispose(): void;
}

/** Markdown is sanitized before any author-provided HTML enters the live page. */
export async function renderExampleMarkdown(
  item: ExampleContent,
  signal: AbortSignal,
): Promise<ExampleMarkdown> {
  const resources: ExampleImage[] = [];
  const pending = new Map<string, Promise<ExampleImage>>();
  const resourceFor = (path: string) => {
    if (!pending.has(path))
      pending.set(
        path,
        exampleResources.media(path, signal).then((resource) => {
          resources.push(resource);
          return resource;
        }),
      );
    return pending.get(path)!;
  };
  try {
    const markdown = await exampleResources.description(item, signal);
    const html = DOMPurify.sanitize(
      marked.parse(markdown, { async: false, gfm: true }),
      {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
        FORBID_ATTR: ['style', 'srcset'],
      },
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    const allowed = exampleResourcePaths(await exampleResources.catalog());
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
      if (!heading.id)
        heading.id = (heading.textContent || '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .trim()
          .replace(/\s+/g, '-');
    });
    await Promise.all(
      [...document.querySelectorAll('img, a, video')].map(async (node) => {
        const attribute = node.tagName === 'A' ? 'href' : 'src';
        const value = node.getAttribute(attribute) || '';
        node.removeAttribute(attribute);
        // Tutorial videos are catalogue-approved local assets. Never autoplay
        // or fetch author-provided external video URLs in the example browser.
        if (node.tagName === 'VIDEO') {
          const poster = resolveExampleResource(
            node.getAttribute('poster'),
            item.descriptionPath,
            allowed,
          );
          for (const attribute of ['autoplay', 'loop', 'poster'])
            node.removeAttribute(attribute);
          node.setAttribute('controls', '');
          node.setAttribute('preload', 'none');
          node
            .querySelectorAll('source, track')
            .forEach((child) => child.remove());
          if (
            poster &&
            exampleImageExtensions.includes(
              poster.split('.').pop()!.toLowerCase(),
            )
          ) {
            try {
              node.setAttribute('poster', (await resourceFor(poster)).url);
            } catch (error) {
              if (signal.aborted) throw error;
            }
          }
        }
        if (attribute === 'href' && value.startsWith('#'))
          node.setAttribute(attribute, value);
        else if (
          (node.tagName !== 'VIDEO' && /^https?:\/\//i.test(value)) ||
          (attribute === 'href' && /^mailto:/i.test(value))
        ) {
          node.setAttribute(attribute, value);
        } else {
          const path = resolveExampleResource(
            value,
            item.descriptionPath,
            allowed,
          );
          if (
            path &&
            (node.tagName === 'IMG'
              ? exampleImageExtensions
              : node.tagName === 'VIDEO'
              ? exampleVideoExtensions
              : exampleMediaExtensions
            ).includes(path.split('.').pop()!.toLowerCase())
          ) {
            try {
              const resource = await resourceFor(path);
              node.setAttribute(attribute, resource.url);
            } catch (error) {
              if (signal.aborted) throw error;
            }
          }
        }
        if (node.tagName === 'A') {
          node.setAttribute('rel', 'noopener noreferrer');
          if (node.getAttribute('href')?.startsWith('blob:'))
            node.setAttribute('download', '');
          else node.setAttribute('target', '_blank');
        }
      }),
    );
    if (signal.aborted) throw new Error('Example description cancelled.');
    return {
      html: document.body.innerHTML,
      dispose: () => resources.forEach((resource) => resource.dispose()),
    };
  } catch (error) {
    await Promise.allSettled(pending.values());
    resources.forEach((resource) => resource.dispose());
    throw error;
  }
}

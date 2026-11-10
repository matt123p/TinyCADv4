import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { ExampleContent } from '../../shared/bundledExamples';
import {
  exampleResourcePaths,
  resolveExampleResource,
  exampleImageExtensions,
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
      [...document.querySelectorAll('img, a')].map(async (node) => {
        const attribute = node.tagName === 'IMG' ? 'src' : 'href';
        const value = node.getAttribute(attribute) || '';
        node.removeAttribute(attribute);
        if (attribute === 'href' && value.startsWith('#'))
          node.setAttribute(attribute, value);
        else if (
          /^https?:\/\//i.test(value) ||
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
            exampleImageExtensions.includes(
              path.split('.').pop()!.toLowerCase(),
            )
          ) {
            try {
              const resource = await exampleResources.image(path, signal);
              resources.push(resource);
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
    resources.forEach((resource) => resource.dispose());
    throw error;
  }
}

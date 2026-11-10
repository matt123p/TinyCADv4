import DOMPurify from 'dompurify';
import { marked, Renderer } from 'marked';

/** Text boxes store Markdown source, never generated HTML. */
export function renderMarkdown(source: string): string {
  const renderer = new Renderer();
  // Read-only task lists: no interactive form controls on the drawing.
  renderer.checkbox = ({ checked }) => (checked ? '☑ ' : '☐ ');
  return DOMPurify.sanitize(
    marked.parse(source, {
      async: false,
      gfm: true,
      // Keep line breaks in existing drawing annotations.
      breaks: true,
      renderer,
    }),
    {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
      FORBID_ATTR: ['style', 'srcset', 'id', 'name'],
    },
  );
}

// Kept inside the foreignObject so standalone SVG and browser printing retain it.
export const markdownStyles = `
.tinycad-markdown { line-height:1.4; overflow:hidden; overflow-wrap:anywhere; box-sizing:border-box; }
.tinycad-markdown * { box-sizing:border-box; }
.tinycad-markdown p,.tinycad-markdown pre,.tinycad-markdown blockquote,.tinycad-markdown ul,.tinycad-markdown ol,.tinycad-markdown table { margin:0 0 .6em; }
.tinycad-markdown h1,.tinycad-markdown h2,.tinycad-markdown h3,.tinycad-markdown h4,.tinycad-markdown h5,.tinycad-markdown h6 { margin:0 0 .4em; line-height:1.2; font-weight:bold; }
.tinycad-markdown h1 { font-size:2em; } .tinycad-markdown h2 { font-size:1.5em; }
.tinycad-markdown h3 { font-size:1.25em; } .tinycad-markdown h4 { font-size:1em; }
.tinycad-markdown h5 { font-size:.875em; } .tinycad-markdown h6 { font-size:.85em; }
.tinycad-markdown ul,.tinycad-markdown ol { padding-left:1.8em; }
.tinycad-markdown blockquote { border-left:.2em solid #888; padding-left:.7em; }
.tinycad-markdown code { font-family:'Courier New',monospace; font-size:.9em; background:#eeeeee; color:#202020; padding:.1em .2em; }
.tinycad-markdown pre { padding:.5em; background:#eeeeee; color:#202020; white-space:pre; overflow:hidden; }
.tinycad-markdown pre code { padding:0; background:none; font-size:1em; }
.tinycad-markdown table { border-collapse:collapse; }
.tinycad-markdown th,.tinycad-markdown td { border:1px solid #888; padding:.2em .5em; }
.tinycad-markdown th { font-weight:bold; }
.tinycad-markdown img { max-width:100%; height:auto; }
.tinycad-markdown hr { border:0; border-top:1px solid #888; margin:.6em 0; }
.tinycad-markdown a { color:#005a9e; text-decoration:underline; }
`;

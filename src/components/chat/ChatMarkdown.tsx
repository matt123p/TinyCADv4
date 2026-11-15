import { tinycadUrl } from '../../io/apiServer';
import React, { useMemo } from 'react';
import { marked } from 'marked';

// Render tokens as React elements. Raw HTML stays text and cannot execute;
// Markdown images stay links so a reply cannot silently contact third parties.
export function safeChatLink(href: string): string | undefined {
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol)
      ? tinycadUrl(url.href)
      : undefined;
  } catch {
    return undefined;
  }
}
function tokens(nodes: any[]): React.ReactNode {
  return nodes.map((node, i) => {
    const nested = () => (node.tokens ? tokens(node.tokens) : node.text);
    switch (node.type) {
      case 'space':
      case 'def':
        return null;
      case 'heading':
        return React.createElement(`h${node.depth}`, { key: i }, nested());
      case 'paragraph':
        return <p key={i}>{nested()}</p>;
      case 'text':
      case 'escape':
        return <React.Fragment key={i}>{nested()}</React.Fragment>;
      case 'strong':
        return <strong key={i}>{nested()}</strong>;
      case 'em':
        return <em key={i}>{nested()}</em>;
      case 'del':
        return <del key={i}>{nested()}</del>;
      case 'codespan':
        return <code key={i}>{node.text}</code>;
      case 'code':
        return (
          <pre key={i}>
            <code>{node.text}</code>
          </pre>
        );
      case 'br':
        return <br key={i} />;
      case 'hr':
        return <hr key={i} />;
      case 'blockquote':
        return <blockquote key={i}>{nested()}</blockquote>;
      case 'list': {
        const items = node.items.map((item: any, j: number) => (
          <li key={j}>
            {item.task && (
              <input
                type="checkbox"
                disabled
                checked={!!item.checked}
                aria-label={item.checked ? 'Completed task' : 'Incomplete task'}
              />
            )}{' '}
            {tokens(item.tokens)}
          </li>
        ));
        return node.ordered ? (
          <ol key={i} start={node.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
      case 'link':
      case 'image': {
        const href = safeChatLink(node.href);
        const content =
          node.type === 'image' ? `Image: ${node.text || node.href}` : nested();
        return href ? (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer">
            {content}
          </a>
        ) : (
          <span key={i}>{content}</span>
        );
      }
      case 'table':
        return (
          <div key={i} className="chat-table">
            <table>
              <thead>
                <tr>
                  {node.header.map((cell: any, j: number) => (
                    <th key={j}>{tokens(cell.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row: any[], j: number) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k}>{tokens(cell.tokens)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return (
          <React.Fragment key={i}>{node.raw || node.text || ''}</React.Fragment>
        );
    }
  });
}
export const ChatMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const nodes = useMemo(
    () => marked.lexer(text, { gfm: true, breaks: true }),
    [text],
  );
  return <div className="chat-markdown">{tokens(nodes)}</div>;
};

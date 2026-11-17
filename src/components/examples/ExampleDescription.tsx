import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import type { ExampleContent } from '../../../shared/bundledExamples';
import {
  renderExampleMarkdown,
  ExampleMarkdown,
} from '../../io/exampleMarkdown';
import { openExternalUrl } from '../../util/navigation';

const useStyles = makeStyles({
  markdown: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    lineHeight: '1.6',
    '& > :first-child': { marginTop: 0 },
    '& img': { maxWidth: '100%', height: 'auto' },
    '& video': { display: 'block', maxWidth: '100%', height: 'auto' },
    '& pre': {
      overflowX: 'auto',
      padding: '12px',
      backgroundColor: tokens.colorNeutralBackground3,
      borderRadius: '6px',
    },
    '& code': { fontFamily: 'monospace' },
    '& table': {
      borderCollapse: 'collapse',
      display: 'block',
      overflowX: 'auto',
      maxWidth: '100%',
    },
    '& th, & td': {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: '6px 10px',
    },
    '& blockquote': {
      marginLeft: 0,
      paddingLeft: '16px',
      borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    },
    '& a': { color: tokens.colorBrandForegroundLink },
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
    overflowWrap: 'anywhere',
    margin: '8px 0',
  },
});

export function ExampleDescription(props: { item: ExampleContent }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  const [html, setHTML] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let description: ExampleMarkdown | undefined;
    setHTML(null);
    setError('');
    renderExampleMarkdown(props.item, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) result.dispose();
        else {
          description = result;
          setHTML(result.html);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(String(reason.message || reason));
      });
    return () => {
      controller.abort();
      description?.dispose();
    };
  }, [props.item, revision]);
  if (error)
    return (
      <div role="alert" className={styles.error}>
        {error}{' '}
        <Button onClick={() => setRevision((value) => value + 1)}>
          {t('examples.retry')}
        </Button>
      </div>
    );
  if (html === null)
    return <Spinner size="small" label={t('examples.loading')} />;
  return (
    <div
      ref={container}
      className={styles.markdown}
      onClick={(event) => {
        const anchor = (event.target as Element).closest('a');
        const href = anchor?.getAttribute('href');
        if (!href) return;
        if (href.startsWith('#')) {
          event.preventDefault();
          let id: string;
          try {
            id = decodeURIComponent(href.slice(1));
          } catch {
            return;
          }
          [...(container.current?.querySelectorAll('[id]') || [])]
            .find((node) => node.id === id)
            ?.scrollIntoView({ block: 'start' });
        } else if (/^(https?:|mailto:)/i.test(href)) {
          event.preventDefault();
          openExternalUrl(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

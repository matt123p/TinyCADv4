import React from 'react';
import { Toolbar, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ChevronLeftRegular, ChevronRightRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  toolbarContainer: {
    '& .fui-ToolbarButton': {
      fontFamily: tokens.fontFamilyBase,
      fontSize: tokens.fontSizeBase200,
      fontWeight: tokens.fontWeightRegular,
      lineHeight: tokens.lineHeightBase200,
    },
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgb(230, 230, 230)',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    borderTop: '1px solid white',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    },
  },
  toolbarContent: {
    fontFamily: tokens.fontFamilyBase,
    marginLeft: '-8px', // Shifts content left to reduce gap
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 'max-content',
  },
});

export const EditorToolbar: React.FC<{ children: React.ReactNode; label?: string; className?: string }> = ({ children, label, className }) => {
  const styles = useStyles();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = React.useState(false);
  const [showRightArrow, setShowRightArrow] = React.useState(false);

  const updateScrollButtons = React.useCallback(() => {
    const el = containerRef.current;
    if (el) {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setShowLeftArrow(scrollLeft > 2);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 2);
    }
  }, []);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Check initial scroll state
    updateScrollButtons();

    // Set up ResizeObserver to track container resizing
    const resizeObserver = new ResizeObserver(() => {
      updateScrollButtons();
    });
    resizeObserver.observe(el);

    // Also observe the child (FluentToolbar) resize to handle dynamic content loading
    const child = el.firstElementChild;
    if (child) {
      resizeObserver.observe(child);
    }

    window.addEventListener('resize', updateScrollButtons);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [updateScrollButtons]);

  const scroll = (direction: 'left' | 'right') => {
    const el = containerRef.current;
    if (el) {
      const amount = direction === 'left' ? -200 : 200;
      el.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  return (
    <div className={mergeClasses('editor-toolbar', className)} style={{ width: '100%', overflow: 'hidden', flexShrink: 0 }}>
      <div
        ref={containerRef}
        onScroll={updateScrollButtons}
        className={mergeClasses('toolbar-container', styles.toolbarContainer)}
      >
        <Toolbar aria-label={label} className={styles.toolbarContent}>{children}</Toolbar>
      </div>
      
      {showLeftArrow && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '48px',
            background: 'linear-gradient(to right, rgb(230, 230, 230) 40%, rgba(230, 230, 230, 0) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingLeft: '6px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <button
            onClick={() => scroll('left')}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.75)',
              border: '1px solid rgba(0, 0, 0, 0.15)',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              pointerEvents: 'all',
              padding: 0,
              color: '#333',
              transition: 'background-color 0.2s, box-shadow 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.75)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
            }}
          >
            <ChevronLeftRegular style={{ fontSize: '16px' }} />
          </button>
        </div>
      )}

      {showRightArrow && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '48px',
            background: 'linear-gradient(to left, rgb(230, 230, 230) 40%, rgba(230, 230, 230, 0) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: '6px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <button
            onClick={() => scroll('right')}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.75)',
              border: '1px solid rgba(0, 0, 0, 0.15)',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              pointerEvents: 'all',
              padding: 0,
              color: '#333',
              transition: 'background-color 0.2s, box-shadow 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.75)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
            }}
          >
            <ChevronRightRegular style={{ fontSize: '16px' }} />
          </button>
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { Button } from '@fluentui/react-components';
import {
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
} from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';

export function SidePanelToggle({
  expanded,
  onToggle,
  controls,
  className,
}: {
  expanded: boolean;
  onToggle(): void;
  controls?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t(
    expanded ? 'library.hideSidePanel' : 'designApp.showSidePanel',
  );
  return (
    <Button
      appearance="subtle"
      className={className}
      icon={
        expanded ? <PanelLeftContractRegular /> : <PanelLeftExpandRegular />
      }
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      title={label}
      onClick={onToggle}
    />
  );
}

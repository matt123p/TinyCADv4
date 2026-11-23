import React from 'react';
import { makeStyles, tokens, ToolbarButton } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import textImage from 'url:../../../images/text.png';

const useStyles = makeStyles({ active: { backgroundColor: tokens.colorBrandBackground2 } });

export function TextToolButton({ onClick, disabled, active }:
  { onClick(): void; disabled?: boolean; active?: boolean }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return <ToolbarButton aria-label={t('toolbar.text')} title={t('toolbar.text')} aria-pressed={active}
    icon={<img src={textImage} width={18} height={18} alt="" />} onClick={onClick}
    disabled={disabled} className={active ? styles.active : undefined} />;
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@fluentui/react-components';
import type { BoardFinding } from '../../pcb/boardFindings';

const measurementFormats = new Map<string, {
  length: Intl.NumberFormat;
  ratio: Intl.NumberFormat;
}>();

function formatsFor(language: string) {
  let formats = measurementFormats.get(language);
  if (!formats) {
    formats = {
      length: new Intl.NumberFormat(language, { useGrouping: false, maximumFractionDigits: 12 }),
      ratio: new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 12 }),
    };
    measurementFormats.set(language, formats);
  }
  return formats;
}

export function FindingSeverityLabel({ severity }: { severity: BoardFinding['severity'] }) {
  const { t } = useTranslation();
  return <>{t(`pcbChecks.severity.${severity}`)}</>;
}

export function BoardFindingDetails({
  finding,
  onProbe,
}: {
  finding: BoardFinding;
  onProbe?: (pin: BoardFinding['sourcePins'][number]) => void;
}) {
  const { t, i18n } = useTranslation();
  const formats = formatsFor(i18n.resolvedLanguage ?? i18n.language);
  const mm = (value: number) => t('pcbChecks.millimetres', { value: formats.length.format(value / 1_000_000) });
  const { measurement, clearanceRules, advisory, layers, location, ruleIds, sourcePins } = finding;
  const format = (value: number) =>
    measurement?.unit === 'permille' ? formats.ratio.format(value / 1_000) : mm(value);
  return (
    <>
      {measurement?.measured !== undefined && ' ' + t('pcbChecks.measured', { value: format(measurement.measured) })}
      {measurement?.required !== undefined && ' ' + t('pcbChecks.required', { value: format(measurement.required) })}
      {!!clearanceRules?.length && (
        <ul aria-label={t('pcbChecks.matchedClearance')}>
          {clearanceRules.map(({ id, name, clearanceNm }) => (
            <li key={id}>{name} · {mm(clearanceNm)}</li>
          ))}
        </ul>
      )}
      {advisory?.waiver && <p>{t('pcbChecks.waivedReason', { reason: advisory.waiver.reason })}</p>}
      <details>
        <summary>{t('pcbChecks.details')}</summary>
        {layers.length > 0 && <div>{t('pcbChecks.layers', { layers: layers.join(', ') })}</div>}
        {location && <div>{t('pcbChecks.position', { x: mm(location.x), y: mm(location.y) })}</div>}
        <div>{t('pcbChecks.rules', { rules: ruleIds.join(', ') })}</div>
        {!!sourcePins.length && (
          <ul aria-label={t('pcbChecks.pins')}>
            {sourcePins.map((pin) => (
              <li key={pin.unitId + ':' + pin.pinId}>
                {onProbe ? (
                  <Button size="small" onClick={() => onProbe(pin)}>
                    {t('pcbChecks.showPin', { pin: pin.label })}
                  </Button>
                ) : pin.label}
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}

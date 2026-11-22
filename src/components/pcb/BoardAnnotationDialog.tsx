import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { annotationLengthNm } from '../../pcb/boardAnnotations';
import type { BoardDimension } from '../../pcb/boardAnnotations';
import { canonicalBoardDecimal } from './boardNumberInput';
import type { BoardPoint } from '../../pcb/geometry';

export type AnnotationDraft =
  | { type: 'datum'; point: BoardPoint }
  | { type: 'dimension'; dimension: BoardDimension };

const origin: BoardPoint = { x: 0, y: 0 };
const mm = (nm: number) => String(nm / 1_000_000);

export default function BoardAnnotationDialog({
  draft,
  datum,
  onApply,
  onClose,
}: {
  draft: AnnotationDraft;
  datum?: BoardPoint;
  onApply(annotation: AnnotationDraft): void;
  onClose(): void;
}) {
  const dimension = draft.type === 'dimension' ? draft.dimension : undefined;
  const base = dimension ? datum ?? origin : origin;
  const start = draft.type === 'datum' ? draft.point : draft.dimension.start;
  const [x, setX] = useState(mm(start.x - base.x));
  const [y, setY] = useState(mm(start.y - base.y));
  const [endX, setEndX] = useState(mm((dimension?.end.x ?? 0) - base.x));
  const [endY, setEndY] = useState(mm((dimension?.end.y ?? 0) - base.y));
  const [kind, setKind] = useState(dimension?.kind ?? 'aligned');
  const [offset, setOffset] = useState(mm(dimension?.offsetNm ?? 0));
  const [unit, setUnit] = useState(dimension?.unit ?? 'mm');
  const [label, setLabel] = useState(dimension?.label ?? '');
  const [error, setError] = useState('');

  function at(x: string, y: string) {
    return {
      x: base.x + annotationLengthNm(canonicalBoardDecimal(x)),
      y: base.y + annotationLengthNm(canonicalBoardDecimal(y)),
    };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (dimension) {
        onApply({
          type: 'dimension',
          dimension: {
            id: dimension.id,
            start: at(x, y),
            end: at(endX, endY),
            kind,
            offsetNm: annotationLengthNm(canonicalBoardDecimal(offset)),
            unit,
            ...(label.trim() && { label: label.trim() }),
          },
        });
      } else onApply({ type: 'datum', point: at(x, y) });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>
              {dimension ? 'PCB dimension' : 'Measurement datum'}
            </DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <p>
                {dimension && datum
                  ? 'Coordinates are relative to the measurement datum. '
                  : ''}
                Enter millimetres or include a unit such as 100 mil.
              </p>
              <label>
                {dimension ? 'Start X' : 'Datum X'}
                <input
                  required
                  value={x}
                  onChange={(event) => setX(event.target.value)}
                />
              </label>
              <label>
                {dimension ? 'Start Y' : 'Datum Y'}
                <input
                  required
                  value={y}
                  onChange={(event) => setY(event.target.value)}
                />
              </label>
              {dimension && (
                <>
                  <label>
                    End X
                    <input
                      required
                      value={endX}
                      onChange={(event) => setEndX(event.target.value)}
                    />
                  </label>
                  <label>
                    End Y
                    <input
                      required
                      value={endY}
                      onChange={(event) => setEndY(event.target.value)}
                    />
                  </label>
                  <label>
                    Dimension direction
                    <select
                      value={kind}
                      onChange={(event) =>
                        setKind(event.target.value as BoardDimension['kind'])
                      }
                    >
                      <option value="aligned">Aligned</option>
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </label>
                  <label>
                    Line offset
                    <input
                      required
                      value={offset}
                      onChange={(event) => setOffset(event.target.value)}
                    />
                  </label>
                  <label>
                    Display unit
                    <select
                      value={unit}
                      onChange={(event) =>
                        setUnit(event.target.value as BoardDimension['unit'])
                      }
                    >
                      <option value="mm">Millimetres</option>
                      <option value="mil">Mils</option>
                    </select>
                  </label>
                  <label>
                    Dimension label
                    <input
                      maxLength={120}
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                    />
                  </label>
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button appearance="primary" type="submit">
                Apply
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

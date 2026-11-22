import { Input, Select } from '@fluentui/react-components';
import React, { useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import type { BoardMechanicalHole } from '../../pcb/boardMechanical';
import { boardInputLength } from './boardNumberInput';

const nm = (value: string) => boardInputLength(value, 'mm');

export default function BoardHoleDialog({
  x,
  y,
  onApply,
  onClose,
}: {
  x: string;
  y: string;
  onApply(hole: BoardMechanicalHole): void;
  onClose(): void;
}) {
  const [positionX, setPositionX] = useState(x);
  const [positionY, setPositionY] = useState(y);
  const [width, setWidth] = useState('3.2');
  const [length, setLength] = useState('');
  const [direction, setDirection] = useState('horizontal');
  const [plated, setPlated] = useState(false);
  const [land, setLand] = useState('4');
  const [clearance, setClearance] = useState('0');
  const [headDiameter, setHeadDiameter] = useState('');
  const [headSide, setHeadSide] = useState<BoardMechanicalHole['screwHeadSide']>('top');
  const [bodyClearance, setBodyClearance] = useState('0');
  const [error, setError] = useState('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const centre = { x: nm(positionX), y: nm(positionY) };
      const widthNm = nm(width);
      const span = length.trim() ? nm(length) - widthNm : 0;
      if (span < 0) throw new Error('Slot length must be at least its width.');
      const half = Math.floor(span / 2);
      const horizontal = direction === 'horizontal';
      onApply({
        id: crypto.randomUUID(),
        widthNm,
        plated,
        start: {
          x: centre.x - (horizontal ? half : 0),
          y: centre.y - (horizontal ? 0 : half),
        },
        end: {
          x: centre.x + (horizontal ? span - half : 0),
          y: centre.y + (horizontal ? 0 : span - half),
        },
        clearanceNm: nm(clearance),
        ...(plated ? { landWidthNm: nm(land) } : {}),
        ...(headDiameter.trim() && {
          screwHeadDiameterNm: nm(headDiameter),
          screwHeadSide: headSide,
          bodyClearanceNm: nm(bodyClearance),
        }),
      });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface className="pcb-dialog">
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>Add hole or slot</DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <label>
                Centre X (mm)
                <Input
                  value={positionX}
                  onChange={(e) => setPositionX(e.target.value)}
                />
              </label>
              <label>
                Centre Y (mm)
                <Input
                  value={positionY}
                  onChange={(e) => setPositionY(e.target.value)}
                />
              </label>
              <label>
                Hole width (mm)
                <Input
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                />
              </label>
              <label>
                Slot length (mm)
                <Input
                  value={length}
                  placeholder="Round hole"
                  onChange={(e) => setLength(e.target.value)}
                />
              </label>
              {!!length && (
                <label>
                  Slot direction
                  <Select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                  >
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                  </Select>
                </label>
              )}
              <Checkbox
                label="Plated"
                checked={plated}
                onChange={(_, data) => setPlated(data.checked === true)}
              />
              {plated && (
                <label>
                  Copper land width (mm)
                  <Input
                    value={land}
                    onChange={(e) => setLand(e.target.value)}
                  />
                </label>
              )}
              <label>
                Extra routing clearance (mm)
                <Input
                  value={clearance}
                  onChange={(e) => setClearance(e.target.value)}
                />
              </label>
              <label>
                Screw-head diameter (mm)
                <Input
                  value={headDiameter}
                  onChange={(e) => setHeadDiameter(e.target.value)}
                />
              </label>
              {headDiameter.trim() && (
                <>
                  <label>
                    Screw-head side
                    <Select
                      value={headSide}
                      onChange={(e) => setHeadSide(e.target.value as BoardMechanicalHole['screwHeadSide'])}
                    >
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                      <option value="both">Both</option>
                    </Select>
                  </label>
                  <label>
                    Extra component clearance (mm)
                    <Input
                      value={bodyClearance}
                      onChange={(e) => setBodyClearance(e.target.value)}
                    />
                  </label>
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary">
                Add
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

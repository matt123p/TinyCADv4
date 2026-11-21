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
import type { PlacementArea } from '../../pcb/placementAreas';
import { outlineText, outlineVertices } from './boardOutlineInput';

export default function PlacementAreaDialog({
  area,
  onApply,
  onClose,
}: {
  area?: PlacementArea;
  onApply(area: PlacementArea): void;
  onClose(): void;
}) {
  const [error, setError] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      onApply({
        id: area?.id ?? crypto.randomUUID(),
        name: String(data.get('name')).trim(),
        kind: data.get('kind') as PlacementArea['kind'],
        side: data.get('side') as PlacementArea['side'],
        outline: outlineVertices(String(data.get('outline'))),
      });
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
              {area ? 'Edit placement area' : 'Add placement area'}
            </DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength={128}
                  defaultValue={area?.name}
                />
              </label>
              <label>
                Rule
                <select
                  name="kind"
                  aria-label="Rule"
                  defaultValue={area?.kind ?? 'keep-out'}
                >
                  <option value="keep-out">Keep out</option>
                  <option value="keep-in">Keep in</option>
                </select>
              </label>
              <label>
                Assembly side
                <select
                  name="side"
                  aria-label="Assembly side"
                  defaultValue={area?.side ?? 'both'}
                >
                  <option value="both">Both sides</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
              <label>
                Outline (X, Y in mm)
                <textarea
                  name="outline"
                  rows={5}
                  required
                  defaultValue={area && outlineText(area.outline)}
                />
              </label>
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

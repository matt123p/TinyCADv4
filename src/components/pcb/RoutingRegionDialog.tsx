import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import type { BoardDocument } from '../../pcb/board';
import { lengthInNanometres } from '../../pcb/geometry';
import { routingRegionKinds } from '../../pcb/routingRegions';
import type { RoutingRegion } from '../../pcb/routingRegions';
import { outlineText, outlineVertices } from './boardOutlineInput';

export default function RoutingRegionDialog({ board, region, onApply, onClose }: {
  board: BoardDocument;
  region?: RoutingRegion;
  onApply(region: RoutingRegion): void;
  onClose(): void;
}) {
  const [error, setError] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '').trim();
    const classId = value('classId');
    const minWidth = value('minWidth');
    const maxWidth = value('maxWidth');
    const clearance = value('clearance');
    try {
      onApply({
        id: region?.id ?? crypto.randomUUID(),
        name: value('name'),
        side: value('side') as RoutingRegion['side'],
        ...(classId ? { classId } : {}),
        outline: outlineVertices(value('outline')),
        exclusions: routingRegionKinds.filter((kind) => form.has(kind)),
        ...(minWidth ? { minWidthNm: lengthInNanometres(minWidth, 'mm') } : {}),
        ...(maxWidth ? { maxWidthNm: lengthInNanometres(maxWidth, 'mm') } : {}),
        ...(clearance ? { clearanceNm: lengthInNanometres(clearance, 'mm') } : {}),
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
            <DialogTitle>{region ? 'Edit routing region' : 'Add routing region'}</DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <label>Name <input name="name" required maxLength={128} defaultValue={region?.name} /></label>
              <label>
                Copper layers
                <select name="side" aria-label="Copper layers" defaultValue={region?.side ?? 'both'}>
                  <option value="both">Both layers</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
              <label>
                Net class
                <select name="classId" aria-label="Net class" defaultValue={region?.classId ?? ''}>
                  <option value="">Any class</option>
                  <option value="default">No assigned class</option>
                  {board.netClasses?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label>
                Outline (X, Y in mm)
                <textarea name="outline" rows={5} required defaultValue={region && outlineText(region.outline)} />
              </label>
              <fieldset>
                <legend>Exclude copper</legend>
                {routingRegionKinds.map((kind) => (
                  <label key={kind}>
                    <span>Exclude {kind}s</span>
                    <input name={kind} type="checkbox" defaultChecked={region?.exclusions.includes(kind)} />
                  </label>
                ))}
              </fieldset>
              <label>
                Minimum track width (mm)
                <input name="minWidth" defaultValue={region?.minWidthNm === undefined ? '' : String(region.minWidthNm / 1e6)} />
              </label>
              <label>
                Maximum track width (mm)
                <input name="maxWidth" defaultValue={region?.maxWidthNm === undefined ? '' : String(region.maxWidthNm / 1e6)} />
              </label>
              <label>
                Copper clearance (mm)
                <input name="clearance" defaultValue={region?.clearanceNm === undefined ? '' : String(region.clearanceNm / 1e6)} />
              </label>
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary">Apply</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

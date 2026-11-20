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
import type { BoardProbeMatch } from '../../io/projectPcbProbe';
import { DeviceFootprintPreview } from './DeviceMappingPreview';

type ShowBoard = (match: BoardProbeMatch, padId?: string) => void;

function BoardProbeResult({
  match,
  onShow,
}: {
  match: BoardProbeMatch;
  onShow: ShowBoard;
}) {
  const [pad, setPad] = useState(match.pads[0]?.id);
  const { path, reference, footprint, placement, pads } = match;
  return (
    <section aria-label={path}>
      <h3>
        {path} · {reference}
      </h3>
      {footprint && <p>{footprint.name}</p>}
      <p>
        {placement
          ? `${placement.side === 'top' ? 'Top' : 'Bottom'} · ${
              placement.positionNm.x / 1_000_000
            }, ${placement.positionNm.y / 1_000_000} mm`
          : 'Unplaced component'}
      </p>
      {footprint && (
        <DeviceFootprintPreview footprint={footprint} selected={pad} />
      )}
      {!!pads.length && (
        <ul aria-label="Mapped pads">
          {pads.map(({ id, label, signal, net }) => (
            <li key={id}>
              <Button
                size="small"
                appearance={id === pad ? 'primary' : 'subtle'}
                onClick={() => setPad(id)}
              >
                {label} · {signal}
                {net ? ' · ' + net : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => onShow(match, pad)}>Show on board</Button>
    </section>
  );
}

export default function ProjectPcbProbeDialog({
  matches,
  onClose,
  onShow,
}: {
  matches: readonly BoardProbeMatch[];
  onClose: () => void;
  onShow: ShowBoard;
}) {
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Find in PCB</DialogTitle>
          <DialogContent style={{ maxHeight: '68vh', overflowY: 'auto' }}>
            {matches.length ? (
              matches.map((match) => (
                <BoardProbeResult
                  key={match.path}
                  match={match}
                  onShow={onShow}
                />
              ))
            ) : (
              <p role="status">
                The selected schematic component has no applied board link.
              </p>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

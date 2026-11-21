import React, { useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import type { BoardDocument } from '../../pcb/board';
import type { BoardProfile, ContourEdge } from '../../pcb/contours';
import {
  circleContour,
  editableProfile,
  rectangleContour,
  straightContour,
} from '../../pcb/boardProfiles';
import { lengthInNanometres, OutlineTopologyError } from '../../pcb/geometry';
import { ProfileTopologyError, profileRegion } from '../../pcb/contours';
import BoardContourEditor, {
  contourRow,
  ProfilePreview,
  readContourRows,
} from './BoardContourEditor';

type Shape = 'rectangle' | 'rounded' | 'circle' | 'polygon' | 'custom';
const nm = (value: string) => lengthInNanometres(value, 'mm');
const mm = (value: number) => String(value / 1_000_000);

export default function BoardProfileDialog({
  board,
  cutout,
  cutoutIndex,
  onApply,
  onClose,
}: {
  board: BoardDocument;
  cutout: boolean;
  cutoutIndex?: number;
  onApply(profile: BoardProfile): void;
  onClose(): void;
}) {
  const { profile, bounds } = useMemo(() => {
    const profile = editableProfile(board);
    const bounds = profileRegion(profile).outer.reduce(
      (area, { x, y }) => ({
        minX: Math.min(area.minX, x),
        minY: Math.min(area.minY, y),
        maxX: Math.max(area.maxX, x),
        maxY: Math.max(area.maxY, y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    return { profile, bounds };
  }, [board]);
  const cutoutNumber = cutout
    ? cutoutIndex ?? profile.cutouts.length
    : undefined;
  const initial =
    cutoutIndex !== undefined
      ? profile.cutouts[cutoutIndex] ?? []
      : cutout
      ? rectangleContour(
          { x: bounds.minX + 5_000_000, y: bounds.minY + 5_000_000 },
          5_000_000,
          5_000_000,
        )
      : profile.outline;
  const rectangle =
    initial.length === 4 &&
    initial.every(
      ({ start, end, kind }) =>
        kind === 'line' && (start.x === end.x || start.y === end.y),
    );
  const [shape, setShape] = useState<Shape>(
    cutoutIndex === undefined && rectangle ? 'rectangle' : 'custom',
  );
  const [rows, setRows] = useState(() => initial.map(contourRow));
  const [x, setX] = useState(
    mm(cutout ? bounds.minX + 5_000_000 : bounds.minX),
  );
  const [y, setY] = useState(
    mm(cutout ? bounds.minY + 5_000_000 : bounds.minY),
  );
  const [width, setWidth] = useState(
    mm(cutout ? 5_000_000 : bounds.maxX - bounds.minX),
  );
  const [height, setHeight] = useState(
    mm(cutout ? 5_000_000 : bounds.maxY - bounds.minY),
  );
  const [radius, setRadius] = useState('2');
  const [vertices, setVertices] = useState('');
  const [error, setError] = useState<Error>();
  const [attempted, setAttempted] = useState<readonly ContourEdge[]>();
  const background = [
    ...(cutout ? profile.outline : []),
    ...profile.cutouts.filter((_, index) => index !== cutoutIndex).flat(),
  ];
  const issue =
    error instanceof OutlineTopologyError
      ? error instanceof ProfileTopologyError &&
        error.cutoutIndex !== cutoutNumber
        ? new OutlineTopologyError(error.message, -1, error.location)
        : error
      : undefined;
  const issueLabel =
    error instanceof ProfileTopologyError && error.cutoutIndex !== undefined
      ? 'Cutout ' + (error.cutoutIndex + 1)
      : issue && issue.edgeIndex >= 0
      ? 'Edge ' +
        (issue.edgeIndex + 1) +
        (issue.otherEdgeIndex !== undefined &&
        issue.otherEdgeIndex !== issue.edgeIndex
          ? ' and edge ' + (issue.otherEdgeIndex + 1)
          : '')
      : '';
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(undefined);
    try {
      if (cutoutIndex !== undefined && !profile.cutouts[cutoutIndex])
        throw new Error('This cutout is no longer on the board.');
      const contour =
        shape === 'custom'
          ? readContourRows(rows)
          : shape === 'circle'
          ? circleContour({ x: nm(x), y: nm(y) }, nm(radius))
          : shape === 'polygon'
          ? straightContour(
              vertices
                .trim()
                .split(/\r?\n/)
                .map((row) => {
                  const values = row.trim().split(/\s*,\s*|\s+/);
                  if (values.length !== 2)
                    throw new Error('Enter one X and Y pair per line.');
                  return { x: nm(values[0]), y: nm(values[1]) };
                }),
            )
          : rectangleContour(
              { x: nm(x), y: nm(y) },
              nm(width),
              nm(height),
              shape === 'rounded' ? nm(radius) : 0,
            );
      setAttempted(contour);
      const cutouts = [...profile.cutouts];
      if (cutout) cutouts[cutoutNumber] = contour;
      onApply({ outline: cutout ? profile.outline : contour, cutouts });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface
        className={shape === 'custom' ? 'pcb-profile-draft' : undefined}
      >
        <form onSubmit={submit} onChange={() => setError(undefined)}>
          <DialogBody>
            <DialogTitle>
              {cutoutIndex !== undefined
                ? 'Edit board cutout'
                : cutout
                ? 'Add board cutout'
                : 'Set board outline'}
            </DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <label>
                Shape
                <select
                  aria-label="Shape"
                  value={shape}
                  onChange={(event) => setShape(event.target.value as Shape)}
                >
                  <option value="rectangle">Rectangle</option>
                  <option value="rounded">Rounded rectangle</option>
                  <option value="circle">Circle</option>
                  <option value="polygon">Polygon</option>
                  <option value="custom">Custom lines and arcs</option>
                </select>
              </label>
              {shape === 'custom' ? (
                <BoardContourEditor
                  rows={rows}
                  background={background}
                  issue={issue}
                  onChange={(next) => {
                    setRows(next);
                    setError(undefined);
                  }}
                />
              ) : shape === 'polygon' ? (
                <label>
                  Vertices in millimetres, one X and Y pair per line
                  <textarea
                    rows={5}
                    value={vertices}
                    onChange={(event) => setVertices(event.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label>
                    {shape === 'circle' ? 'Centre X (mm)' : 'Origin X (mm)'}
                    <input
                      value={x}
                      onChange={(event) => setX(event.target.value)}
                    />
                  </label>
                  <label>
                    {shape === 'circle' ? 'Centre Y (mm)' : 'Origin Y (mm)'}
                    <input
                      value={y}
                      onChange={(event) => setY(event.target.value)}
                    />
                  </label>
                  {shape !== 'circle' && (
                    <>
                      <label>
                        Width (mm)
                        <input
                          value={width}
                          onChange={(e) => setWidth(e.target.value)}
                        />
                      </label>
                      <label>
                        Height (mm)
                        <input
                          value={height}
                          onChange={(e) => setHeight(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  {shape !== 'rectangle' && (
                    <label>
                      Radius (mm)
                      <input
                        value={radius}
                        onChange={(event) => setRadius(event.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              {shape !== 'custom' && attempted && issue && (
                <ProfilePreview
                  edges={attempted}
                  background={background}
                  issue={issue}
                />
              )}
              {error && (
                <p role="alert">
                  {issueLabel && issueLabel + ' · '}
                  {error.message}
                </p>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary">
                Apply
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

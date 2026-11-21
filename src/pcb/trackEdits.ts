import type { BoardDocument } from './board';
import type { BoardTrack } from './boardRouting';
import { isBoardPoint, samePoint } from './geometry';
import type { BoardPoint } from './geometry';

export type ManualTrackEdit =
  | {
      readonly kind: 'drag';
      readonly trackId: string;
      readonly target: BoardPoint;
    }
  | {
      readonly kind: 'corner';
      readonly trackId: string;
      readonly endpoint: 'start' | 'end';
      readonly target: BoardPoint;
    };

export function trackMidpoint({ start, end }: BoardTrack): BoardPoint {
  return {
    x: Math.round((start.x + end.x) / 2),
    y: Math.round((start.y + end.y) / 2),
  };
}

/** A split or branch anchor must lie on the integer centreline. */
export function trackBranchPoint({ start, end }: BoardTrack): BoardPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let divisions = Math.abs(dx);
  let remainder = Math.abs(dy);
  while (remainder) [divisions, remainder] = [remainder, divisions % remainder];
  const step = Math.floor(divisions / 2);
  return step
    ? {
        x: start.x + (dx / divisions) * step,
        y: start.y + (dy / divisions) * step,
      }
    : start;
}

export function cornerTrack(
  board: BoardDocument,
  track: BoardTrack,
  endpoint: 'start' | 'end',
) {
  const junction = track[endpoint];
  const neighbours = (board.tracks ?? []).filter(
    ({ id, netId, layerId, start, end }) =>
      id !== track.id &&
      netId === track.netId &&
      layerId === track.layerId &&
      (samePoint(start, junction) || samePoint(end, junction)),
  );
  return !track.locked && neighbours.length === 1 && !neighbours[0].locked ? neighbours[0] : undefined;
}

type TrackPiece = Omit<BoardTrack, 'id'> & { readonly id?: string };

export function planTrackEdit(board: BoardDocument, edit: ManualTrackEdit) {
  const track = board.tracks?.find(({ id }) => id === edit.trackId);
  if (!track?.netId) throw new Error('Choose a track assigned to a PCB net.');
  if (track.locked) throw new Error('Unlock this track before moving it.');
  const { target } = edit;
  if (!isBoardPoint(target))
    throw new Error('Choose a point inside the PCB coordinate range.');

  let replace: BoardTrack[];
  let pieces: TrackPiece[];
  if (edit.kind === 'drag') {
    const midpoint = trackMidpoint(track);
    const dx = target.x - midpoint.x;
    const dy = target.y - midpoint.y;
    if (!dx && !dy) throw new Error('Move the track handle to a new point.');
    const start = { x: track.start.x + dx, y: track.start.y + dy };
    const end = { x: track.end.x + dx, y: track.end.y + dy };
    const { id, ...properties } = track;
    replace = [track];
    pieces = [
      { ...properties, end: start },
      { ...track, start, end },
      { ...properties, start: end },
    ];
  } else {
    const neighbour = cornerTrack(board, track, edit.endpoint);
    if (!neighbour)
      throw new Error(
        'Choose a corner shared by exactly two tracks on this net and layer.',
      );
    const junction = track[edit.endpoint];
    if (samePoint(junction, target))
      throw new Error('Move the corner handle to a new point.');
    const neighbourEnd = samePoint(neighbour.start, junction) ? 'start' : 'end';
    replace = [track, neighbour];
    pieces = [
      { ...track, [edit.endpoint]: target },
      { ...neighbour, [neighbourEnd]: target },
    ];
  }
  if (
    pieces.some(
      ({ start, end }) =>
        !isBoardPoint(start) || !isBoardPoint(end) || samePoint(start, end),
    )
  )
    throw new Error(
      'The edit must keep each track inside the coordinate range with distinct endpoints.',
    );
  return { replace, pieces, netId: track.netId };
}

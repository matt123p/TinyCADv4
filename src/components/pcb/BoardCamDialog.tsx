import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { saveAs } from 'file-saver';
import type { BoardDocument } from '../../pcb/board';
import type { BoardWorkspaceSession } from '../../io/boardWorkspace';
import type { BoardCamPreview } from '../../pcb/boardCam';
import {
  archiveBoardReleaseReview,
  manufacturingReadiness,
  prepareBoardManufacturingRelease,
  prepareBoardReleaseReview,
  unreviewedCamFiles,
} from '../../pcb/boardReleaseReview';
import type { PolygonRegion } from '../../pcb/contours';
import { createBoardWorker } from '../../pcb/boardWorker';
import { fabricationDocumentation } from '../../pcb/fabricationDrawing';
import { homeEtchDrawings } from '../../pcb/homeEtchDrawing';
import type { HomeEtchOrientation } from '../../pcb/homeEtchDrawing';
import { SvgViewport } from '../svg/SvgViewport';

function regionPath({ outer, holes }: PolygonRegion) {
  return [outer, ...holes]
    .map((ring) => 'M' + ring.map(({ x, y }) => x + ',' + -y).join(' L') + ' Z')
    .join(' ');
}

export default function BoardCamDialog({
  board,
  projectId,
  readProjectCircuit,
  onChecked,
  onClose,
}: {
  board: BoardDocument;
  projectId?: string;
  readProjectCircuit?: BoardWorkspaceSession['readProjectCircuit'];
  onChecked(revision: number): void;
  onClose(): void;
}) {
  const [preview, setPreview] = useState<BoardCamPreview>();
  const [error, setError] = useState('');
  const [layer, setLayer] = useState('copper-top');
  const [reviewedFiles, setReviewedFiles] = useState<string[]>([]);
  const [deterministic, setDeterministic] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [creatingPdf, setCreatingPdf] = useState(false);
  const releaseWorker = useRef<ReturnType<typeof createBoardWorker>>();
  const [etchOrientation, setEtchOrientation] =
    useState<HomeEtchOrientation>('unmirrored');
  useEffect(() => {
    setPreview(undefined);
    setReviewedFiles([]);
    setError('');
    setArchiving(false);
    let active = true;
    let worker: ReturnType<typeof createBoardWorker>;
    const run = async () => {
      const projectCircuit = await readProjectCircuit?.(board);
      if (!active) return;
      worker = createBoardWorker();
      return worker.cam(board, projectCircuit);
    };
    void run().then(
      (result) => {
        if (active) {
          setPreview(result);
          onChecked(result.report.revision);
        }
        worker?.dispose();
      },
      (failure: Error) => {
        if (active) setError(failure.message);
        worker?.dispose();
      },
    );
    return () => {
      active = false;
      worker?.dispose();
      releaseWorker.current?.dispose();
      releaseWorker.current = undefined;
    };
  }, [board, readProjectCircuit, onChecked]);

  const current =
    preview?.manifest.boardId === board.boardId &&
    preview.manifest.revision === board.revision;
  async function download() {
    try {
      const { ZipWriter, Uint8ArrayWriter, TextReader } = await import(
        '@zip.js/zip.js'
      );
      const writer = new ZipWriter(new Uint8ArrayWriter(), {
        useWebWorkers: false,
      });
      const files = {
        ...preview.files,
        'manifest.json': JSON.stringify(preview.manifest, null, 2),
      };
      for (const [name, value] of Object.entries(files))
        await writer.add(name, new TextReader(value), { level: 0 });
      const bytes = new Uint8Array(await writer.close());
      saveAs(
        new Blob([bytes.buffer], { type: 'application/zip' }),
        'pcb-cam-preview.zip',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  async function downloadReview() {
    setError('');
    setArchiving(true);
    try {
      const review = await prepareBoardReleaseReview(board, preview, {
        projectId,
        reviewedFiles,
        deterministic,
      });
      const bytes = new Uint8Array(await archiveBoardReleaseReview(review));
      saveAs(
        new Blob([bytes.buffer], { type: 'application/zip' }),
        'pcb-release-review-r' + board.revision + '.zip',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setArchiving(false);
    }
  }

  async function downloadFabricationPdf() {
    setError('');
    setCreatingPdf(true);
    try {
      const { fabricationPdf } = await import('../../pcb/fabricationPdf');
      const { 'fabrication.svg': svg } = fabricationDocumentation(board, preview.files);
      saveAs(await fabricationPdf(svg, board.title), 'pcb-fabrication-r' + board.revision + '.pdf');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCreatingPdf(false);
    }
  }

  async function releaseBoard() {
    if (releaseWorker.current) return;
    setError('');
    let worker: ReturnType<typeof createBoardWorker>;
    try {
      worker = createBoardWorker();
      releaseWorker.current = worker;
      setArchiving(true);
      const projectCircuit = await readProjectCircuit?.(board, 'saved');
      if (releaseWorker.current !== worker) return;
      const fresh = await worker.cam(board, projectCircuit);
      const release = await prepareBoardManufacturingRelease(board, preview, fresh, {
        projectId, reviewedFiles, deterministic,
      });
      const bytes = new Uint8Array(await archiveBoardReleaseReview(release));
      if (releaseWorker.current !== worker) return;
      saveAs(
        new Blob([bytes.buffer], { type: 'application/zip' }),
        'pcb-release-r' + board.revision + '-' + release.manifest.reviewId.slice(0, 12) + '.zip',
      );
    } catch (error) {
      if (releaseWorker.current === worker) {
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (worker && releaseWorker.current === worker) {
        worker.dispose();
        releaseWorker.current = undefined;
        setArchiving(false);
      }
    }
  }

  function downloadHomeEtch(template: 'copper' | 'drill') {
    try {
      setError('');
      const payload = homeEtchDrawings(board, preview, etchOrientation)[
        template
      ];
      saveAs(
        new Blob([payload], { type: 'image/svg+xml' }),
        'pcb-home-etch-' +
          template +
          '-' +
          etchOrientation +
          '-r' +
          board.revision +
          '.svg',
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  const box = preview?.profile.outer.reduce(
    ([minX, minY, maxX, maxY], { x, y }) => [
      Math.min(minX, x),
      Math.min(minY, -y),
      Math.max(maxX, x),
      Math.max(maxY, -y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const width = box ? box[2] - box[0] : 0;
  const height = box ? box[3] - box[1] : 0;
  const margin = Math.max(width, height) / 20;

  const layers = preview && [
    ...preview.layers.map(({ id, copper }) => ({
      key: 'copper-' + id,
      name: id === 'top' ? 'Top copper' : 'Bottom copper',
      regions: copper,
      color: '#a57635',
    })),
    ...preview.artwork.map(({ kind, side, regions }) => ({
      key: kind + '-' + side,
      name:
        (side === 'top' ? 'Top ' : 'Bottom ') +
        (kind === 'mask'
          ? 'mask openings'
          : kind === 'paste'
          ? 'paste'
          : 'silkscreen'),
      regions,
      color:
        kind === 'mask' ? '#126353' : kind === 'paste' ? '#6049a2' : '#304869',
    })),
  ];
  const selectedLayer = layers?.find(({ key }) => key === layer) ?? layers?.[0];
  const selectedFile = selectedLayer && selectedLayer.key + '.gbr';
  const blockers = current ? manufacturingReadiness(board, preview) : [];
  const unreviewed = current ? unreviewedCamFiles(preview, reviewedFiles) : [];
  const holeFiles = ['profile.gbr', 'plated.xnc', 'non-plated.xnc'];
  const reviewedHoles = holeFiles.every((name) => reviewedFiles.includes(name));
  function setReviewed(names: readonly string[], checked: boolean) {
    setReviewedFiles((previous) =>
      checked
        ? [...new Set([...previous, ...names])]
        : previous.filter((name) => !names.includes(name)),
    );
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>CAM read-back preview</DialogTitle>
          <DialogContent>
            {error && <p role="alert">{error}</p>}
            {!current && !error && (
              <p role="status">Building preview from Gerber and drill files…</p>
            )}
            {current && (
              <>
                <p role="status">
                  Gerber and drill read-back matched revision {board.revision}.
                </p>
                <p>
                  NOT RELEASED · CAM preview
                </p>
                {preview.report.schematic?.state === 'pending' && (
                  <p>
                    The project schematic has changes awaiting a PCB update.
                  </p>
                )}
                {preview.report.schematic?.state === 'unavailable' && (
                  <p>
                    Schematic parity is unavailable.{' '}
                    {preview.report.schematic.detail}
                  </p>
                )}
                <label>
                  CAM layer{' '}
                  <select
                    value={selectedLayer.key}
                    onChange={(event) => setLayer(event.target.value)}
                  >
                    {layers.map(({ key, name }) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pcb-svg pcb-cam-preview">
                  <SvgViewport
                    label="CAM read-back"
                    fit={[
                      box[0] - margin,
                      box[1] - margin,
                      width + 2 * margin,
                      height + 2 * margin,
                    ]}
                  >
                    <path
                      d={regionPath(preview.profile)}
                      fill="#d9e5da"
                      fillRule="evenodd"
                    />
                    {selectedLayer.regions.map((region, i) => (
                      <path
                        key={i}
                        d={regionPath(region)}
                        fill={selectedLayer.color}
                        fillRule="evenodd"
                      />
                    ))}
                    {preview.drills.map(({ polygon, plated }, i) => (
                      <path
                        key={i}
                        data-plating={plated ? 'plated' : 'non-plated'}
                        d={regionPath({ outer: polygon, holes: [] })}
                        fill={plated ? '#fdf9f0' : '#fff'}
                        stroke="#40514a"
                        strokeWidth={margin / 20}
                      />
                    ))}
                  </SvgViewport>
                </div>
                <details>
                  <summary>Home-etch print templates</summary>
                  {board.copperLayers.length === 1 ? (
                    <>
                      <p>
                        Print both templates at 100% using the same orientation.
                        Check the 10 mm mark and transfer direction first. The
                        sheets assume one copper face and unplated holes.
                      </p>
                      <p>
                        Start with 0.50 mm tracks and gaps for the teaching
                        exercise, and confirm the limits on a sample of the
                        chosen process. The current design check profile remains
                        in effect.
                      </p>
                      <label>
                        Print orientation{' '}
                        <select
                          aria-label="Print orientation"
                          value={etchOrientation}
                          onChange={(event) =>
                            setEtchOrientation(
                              event.target.value as HomeEtchOrientation,
                            )
                          }
                        >
                          <option value="unmirrored">
                            Unmirrored (board top view)
                          </option>
                          <option value="mirrored">
                            Mirrored (X reflected)
                          </option>
                        </select>
                      </label>{' '}
                      <Button onClick={() => downloadHomeEtch('copper')}>
                        Download copper artwork
                      </Button>{' '}
                      <Button onClick={() => downloadHomeEtch('drill')}>
                        Download drill template
                      </Button>
                    </>
                  ) : (
                    <p>
                      Home-etch templates require a single copper layer without
                      vias.
                    </p>
                  )}
                </details>
                <details>
                  <summary>
                    Manufacturing review · {blockers.length} release blockers
                  </summary>
                  <Button onClick={downloadFabricationPdf} disabled={creatingPdf}>
                    Download 1:1 fabrication PDF…
                  </Button>
                  {blockers.length > 0 && (
                    <ul aria-label="Release blockers">
                      {blockers.map(({ detail }, index) => (
                        <li key={index}>{detail}</li>
                      ))}
                    </ul>
                  )}
                  {unreviewed.length > 0 && (
                    <p>{unreviewed.length} Gerber or drill files still need review.</p>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewedFiles.includes(selectedFile)}
                      onChange={(event) =>
                        setReviewed([selectedFile], event.target.checked)
                      }
                    />
                    {selectedLayer.name} reviewed
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewedHoles}
                      onChange={(event) =>
                        setReviewed(holeFiles, event.target.checked)
                      }
                    />
                    Outline and both drill files reviewed
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={deterministic}
                      onChange={(event) =>
                        setDeterministic(event.target.checked)
                      }
                    />
                    Normalize archive timestamps for reproducible builds
                  </label>
                  <Button onClick={releaseBoard} disabled={archiving || !!blockers.length || !!unreviewed.length}>
                    Release and download…
                  </Button>
                </details>
              </>
            )}
          </DialogContent>
          <DialogActions>
            {current && (
              <Button onClick={download}>Download preview bundle…</Button>
            )}
            {current && (
              <Button onClick={downloadReview} disabled={archiving}>
                Download release review…
              </Button>
            )}
            <Button appearance="primary" onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

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
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Path,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material, Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BoardDocument } from '../../pcb/board';
import type { BoardInspection } from '../../pcb/boardInspection';
import { createBoardWorker } from '../../pcb/boardWorker';
import type { Polygon, PolygonRegion } from '../../pcb/contours';
import {
  boardMountMatrix,
  modelLocalMatrix,
} from '../../pcb/modelPlacementMatrix';

function ring(path: Path, [first, ...rest]: Polygon) {
  path.moveTo(first.x / 1e6, first.y / 1e6);
  rest.forEach(({ x, y }) => path.lineTo(x / 1e6, y / 1e6));
  path.closePath();
}

function shape({ outer, holes }: PolygonRegion) {
  const result = new Shape();
  ring(result, outer);
  for (const polygon of holes) {
    const hole = new Path();
    ring(hole, polygon);
    result.holes.push(hole);
  }
  return result;
}

type View = 'angle' | 'top' | 'bottom';
type Viewer = {
  move(view: View): void;
  highlight(id: string): void;
};

function startScene(
  container: HTMLDivElement,
  onPick: (id: string) => void,
  onContextLost: () => void,
) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true });
  if (!context)
    throw new Error(
      'WebGL 2 is unavailable. The board remains editable in 2D.',
    );
  const renderer = new WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Interactive 3D PCB');
  canvas.addEventListener('webglcontextlost', onContextLost);
  container.append(canvas);

  const scene = new Scene();
  scene.background = new Color('#e2e9ed');
  scene.add(new HemisphereLight(0xeaf4ff, 0x666052, 2.1));
  const light = new DirectionalLight(0xffffff, 2.1);
  light.position.set(-15, -20, 35);
  scene.add(light);
  const camera = new PerspectiveCamera(42, 1, 0.01, 10_000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  const world = new Group();
  scene.add(world);

  const render = () => renderer.render(scene, camera);
  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  controls.addEventListener('change', render);

  const meshBuffers = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const material = (color: number | Color, extra = {}) => {
    const value = new MeshStandardMaterial({ color, ...extra });
    materials.add(value);
    return value;
  };
  const mesh = (geometry: BufferGeometry, style: Material) => {
    meshBuffers.add(geometry);
    return new Mesh(geometry, style);
  };
  const partGroups = new Map<string, Group>();
  const centre = new Vector3();
  let distance = 10;
  let pointer: [number, number];
  canvas.onpointerdown = (event) => {
    pointer = [event.clientX, event.clientY];
  };
  canvas.onpointerup = (event) => {
    if (
      !pointer ||
      Math.hypot(pointer[0] - event.clientX, pointer[1] - event.clientY) > 5
    )
      return;
    const rect = canvas.getBoundingClientRect();
    const ray = new Raycaster();
    ray.setFromCamera(
      new Vector2(
        (2 * (event.clientX - rect.left)) / rect.width - 1,
        1 - (2 * (event.clientY - rect.top)) / rect.height,
      ),
      camera,
    );
    const hit = ray.intersectObject(world).find(({ object }) => object.visible);
    if (!hit) return;
    let node: Object3D | null = hit.object;
    while (node && !node.userData.componentId) node = node.parent;
    if (node?.userData.componentId) onPick(node.userData.componentId);
  };

  const highlightBox = new Group();
  scene.add(highlightBox);
  const outlineStyle = material(0x2368ef, {
    wireframe: true,
    depthTest: false,
  });
  const marker = mesh(new BoxGeometry(1, 1, 1), outlineStyle);
  marker.visible = false;
  marker.renderOrder = 3;
  highlightBox.add(marker);

  const view: Viewer = {
    move(kind) {
      const direction =
        kind === 'angle'
          ? new Vector3(0.85, -1, 1.3)
          : new Vector3(0, -0.00001, kind === 'top' ? 1 : -1);
      camera.position
        .copy(centre)
        .addScaledVector(direction.normalize(), distance);
      controls.target.copy(centre);
      controls.update();
      render();
    },
    highlight(id) {
      const part = partGroups.get(id);
      marker.visible = !!part;
      if (part) {
        const box = new Box3().setFromObject(part);
        box.getCenter(marker.position);
        box.getSize(marker.scale).addScalar(0.15);
      }
      render();
    },
  };
  function load(data: BoardInspection) {
    const depth = data.thicknessMm;
    const laminate = material(0x2d5341);
    const copper = material(0xb68034, { side: DoubleSide, metalness: 0.4 });
    const mask = material(0x398451, {
      side: DoubleSide,
      transparent: true,
      opacity: 0.43,
      depthWrite: false,
    });
    const silk = material(0xf7edcf, { side: DoubleSide });
    for (const region of data.substrate) {
      const body = mesh(
        new ExtrudeGeometry(shape(region), { depth, bevelEnabled: false }),
        laminate,
      );
      body.position.z = -depth / 2;
      world.add(body);
    }
    for (const face of data.faces) {
      const exposure = face.side === 'top' ? 1 : -1;
      for (const [patterns, style, offset] of [
        [face.copper, copper, 0.015],
        [face.mask, mask, 0.03],
        [face.silk, silk, 0.045],
      ] as const) {
        if (!patterns.length) continue;
        const layers = mesh(new ShapeGeometry(patterns.map(shape)), style);
        layers.position.z = exposure * (depth / 2 + offset);
        world.add(layers);
      }
    }
    const placeholderStyle = material(0xb07136, { wireframe: true });
    const assetMeshes = new Map<
      string,
      { geometry: BufferGeometry; style: Material }[]
    >();
    for (const part of data.parts) {
      const group = new Group();
      group.userData.componentId = part.placement.componentId;
      group.applyMatrix4(boardMountMatrix(part.placement, depth));
      for (const model of part.models) {
        const triangles = data.models[model.assetId];
        if (!triangles) continue;
        if (!assetMeshes.has(model.assetId)) {
          assetMeshes.set(
            model.assetId,
            triangles.map(({ positions, normals, indices, color }) => {
              const geometry = new BufferGeometry();
              geometry.setAttribute(
                'position',
                new BufferAttribute(positions, 3),
              );
              geometry.setIndex(new BufferAttribute(indices, 1));
              if (normals)
                geometry.setAttribute(
                  'normal',
                  new BufferAttribute(normals, 3),
                );
              else geometry.computeVertexNormals();
              return {
                geometry,
                style: material(color ? new Color(...color) : 0x555762),
              };
            }),
          );
        }
        const attachment = new Group();
        attachment.applyMatrix4(modelLocalMatrix(model));
        for (const { geometry, style } of assetMeshes.get(model.assetId)) {
          attachment.add(mesh(geometry, style));
        }
        group.add(attachment);
      }
      if (!group.children.length) {
        const { widthMm, lengthMm, centreXmm, centreYmm } = part.envelope;
        const placeholder = mesh(
          new BoxGeometry(widthMm, lengthMm, 1.4),
          placeholderStyle,
        );
        placeholder.position.set(centreXmm, centreYmm, 0.7);
        group.add(placeholder);
      }
      partGroups.set(part.placement.componentId, group);
      world.add(group);
    }
    const box = new Box3().setFromObject(world);
    box.getCenter(centre);
    distance = Math.max(1, box.getSize(new Vector3()).length()) * 1.35;
    resize();
    view.move('angle');
  }

  return {
    view,
    load,
    dispose() {
      observer.disconnect();
      controls.dispose();
      canvas.onpointerdown = null;
      canvas.onpointerup = null;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      meshBuffers.forEach((geometry) => geometry.dispose());
      materials.forEach((style) => style.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      world.clear();
    },
  };
}

export default function BoardInspectionDialog({
  board,
  selected,
  onClose,
  onInspect,
}: {
  board: BoardDocument;
  selected: string;
  onClose(): void;
  onInspect(componentId: string): void;
}) {
  const [data, setData] = useState<BoardInspection>();
  const [error, setError] = useState('');
  const [selection, setSelection] = useState(selected);
  const container = useRef<HTMLDivElement>();
  const viewer = useRef<Viewer>();
  useEffect(() => {
    let scene: ReturnType<typeof startScene>;
    let worker: ReturnType<typeof createBoardWorker>;
    let active = true;
    const showError = (message: string) => {
      if (active) setError(message);
    };
    try {
      scene = startScene(container.current, setSelection, () =>
        showError(
          'The graphics context was lost. Reopen 3D inspection to try again.',
        ),
      );
      viewer.current = scene.view;
      worker = createBoardWorker();
      void worker.inspect(board).then(
        (result) => {
          worker.dispose();
          if (!active) return;
          try {
            scene.load(result);
            setData(result);
          } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
          }
        },
        (error: Error) => {
          worker.dispose();
          showError(error.message);
        },
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
    return () => {
      active = false;
      viewer.current = undefined;
      worker?.dispose();
      scene?.dispose();
    };
  }, [board]);
  useEffect(() => {
    if (data) viewer.current?.highlight(selection);
  }, [data, selection]);

  return (
    <Dialog open onOpenChange={(_, state) => !state.open && onClose()}>
      <DialogSurface className="pcb-dialog pcb-dialog-wide">
        <DialogBody>
          <DialogTitle>3D board inspection</DialogTitle>
          <DialogContent>
            {error && <p role="alert">{error}</p>}
            {!data && !error && (
              <p role="status">Preparing board geometry and STEP models…</p>
            )}
            <div ref={container} className="pcb-3d-canvas" hidden={!!error} />
            {data && !error && (
              <>
                <p>
                  Revision {board.revision}.{' '}
                  {board.fabrication
                    ? 'Board thickness'
                    : 'Assumed board thickness'}{' '}
                  {data.thicknessMm} mm.
                </p>
                <div role="group" aria-label="3D orientation">
                  <Button onClick={() => viewer.current?.move('angle')}>
                    Isometric
                  </Button>
                  <Button onClick={() => viewer.current?.move('top')}>
                    Top
                  </Button>
                  <Button onClick={() => viewer.current?.move('bottom')}>
                    Bottom
                  </Button>
                </div>
                {!!data.parts.length && (
                  <ul aria-label="3D components">
                    {data.parts.map(({ placement, label, models }) => (
                      <li key={placement.id}>
                        <Button
                          appearance={
                            selection === placement.componentId
                              ? 'primary'
                              : 'subtle'
                          }
                          onClick={() => setSelection(placement.componentId)}
                        >
                          {label}
                        </Button>
                        {models.length
                          ? models.map((model, index) => (
                              <span key={index}>
                                {' · '}
                                {data.models[model.assetId]
                                  ? model.quality === 'generated-envelope'
                                    ? 'Generated STEP envelope'
                                    : 'Imported STEP'
                                  : data.issues[model.assetId] ??
                                    'Missing STEP model · ' + model.source}
                              </span>
                            ))
                          : ' · Placeholder'}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            {selection && data && (
              <Button onClick={() => onInspect(selection)}>
                Show on 2D board
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

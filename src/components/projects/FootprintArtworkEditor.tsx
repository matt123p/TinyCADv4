import React, { useState } from 'react';
import { Button } from '@fluentui/react-components';
import { boardLayerById } from '../../pcb/boardLayers';
import {
  footprintGraphicLayers,
  validateFootprintDetails,
} from '../../pcb/footprintDetails';
import type {
  FootprintGraphic,
  FootprintGraphicLayer,
} from '../../pcb/footprintDetails';
import { orientation, samePoint } from '../../pcb/geometry';
import { boardCoordinateFields, boardInputLength } from '../pcb/boardNumberInput';

type Kind = FootprintGraphic['kind'];
const initial = {
  kind: 'line' as Kind,
  layer: 'F.SilkS' as FootprintGraphicLayer,
  points: '0,0\n1,0',
  stroke: '0.15',
  filled: false,
  text: '',
  height: '1',
  width: '1',
  rotation: '0',
  visible: true,
  align: [] as readonly string[],
};
const nm = (text: string) => boardInputLength(text, 'mm');
const mm = (value: number) => String(value / 1_000_000);
const kindLabels: Record<Kind, string> = {
  line: 'Line',
  rect: 'Rectangle',
  arc: 'Arc',
  circle: 'Circle',
  polygon: 'Polygon',
  text: 'Text',
};

export default function FootprintArtworkEditor({
  graphics,
  onChange,
  run,
  busy,
  legend = 'Footprint artwork',
  initiallyExpanded = false,
}: {
  graphics: readonly FootprintGraphic[];
  onChange(items: readonly FootprintGraphic[]): void;
  run(task: () => void): Promise<void>;
  busy: boolean;
  legend?: string;
  initiallyExpanded?: boolean;
}) {
  const [index, setIndex] = useState<number>();
  const [draft, setDraft] = useState(initial);
  const [expanded, setExpanded] = useState(initiallyExpanded);

  function select(i: number) {
    setIndex(i);
    const item = graphics[i];
    if (!item) return setDraft(initial);
    const points =
      item.kind === 'polygon'
        ? item.points
        : item.kind === 'text'
        ? [item.at]
        : item.kind === 'arc'
        ? [item.start, item.mid, item.end]
        : item.kind === 'circle'
        ? [item.center, item.end]
        : [item.start, item.end];
    setDraft({
      ...initial,
      kind: item.kind,
      layer: item.layer,
      filled: item.filled,
      stroke: mm(item.strokeNm),
      points: points.map(({ x, y }) => `${mm(x)},${mm(y)}`).join('\n'),
      ...(item.kind === 'text'
        ? {
            text: item.text,
            visible: item.visible,
            align: item.align,
            width: mm(item.sizeNm.x),
            height: mm(item.sizeNm.y),
            rotation: mm(item.rotationMicrodegree),
          }
        : {}),
    });
  }

  function save() {
    const points = draft.points
      .trim()
      .split(/\n+/)
      .map((line) => {
        const [x, y] = boardCoordinateFields(line, 2);
        return { x: nm(x), y: nm(y) };
      });
    const [start, second, end] = points;
    const style = {
      layer: draft.layer,
      strokeNm: nm(draft.stroke),
      filled: draft.filled,
    };
    let graphic: FootprintGraphic;
    switch (draft.kind) {
      case 'polygon':
        graphic = { ...style, kind: 'polygon', points };
        break;
      case 'text':
        if (points.length !== 1 || !draft.text.trim())
          throw new Error('Enter one position and text.');
        graphic = {
          ...style,
          kind: 'text',
          at: start,
          text: draft.text,
          sizeNm: { x: nm(draft.width), y: nm(draft.height) },
          rotationMicrodegree: nm(draft.rotation),
          visible: draft.visible,
          align: draft.align,
        };
        break;
      case 'arc':
        if (points.length !== 3 || orientation(start, second, end) === 0)
          throw new Error('An arc needs three non-collinear points.');
        graphic = { ...style, kind: 'arc', start, mid: second, end };
        break;
      case 'circle':
        if (points.length !== 2 || samePoint(start, second))
          throw new Error(
            'A circle needs a centre and a point on the circumference.',
          );
        graphic = { ...style, kind: 'circle', center: start, end: second };
        break;
      default:
        if (
          points.length !== 2 ||
          samePoint(start, second) ||
          (draft.kind === 'rect' &&
            (start.x === second.x || start.y === second.y))
        )
          throw new Error('Enter two distinct endpoints or opposite corners.');
        graphic = { ...style, kind: draft.kind, start, end: second };
    }
    validateFootprintDetails([graphic]);
    if (index === undefined) {
      onChange([...graphics, graphic]);
      setIndex(graphics.length);
    } else onChange(graphics.map((item, i) => (i === index ? graphic : item)));
  }

  return (
    <fieldset disabled={busy}>
      <legend>{legend}</legend>
      {!initiallyExpanded && <Button size="small" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide artwork tools' : 'Edit artwork'}
      </Button>}
      {expanded && (
        <>
          <p>
            <label>
              Graphic{' '}
              <select
                aria-label="Graphic"
                value={index ?? ''}
                onChange={(e) =>
                  select(
                    e.target.value === '' ? undefined : Number(e.target.value),
                  )
                }
              >
                <option value="">New graphic</option>
                {graphics.map((item, i) => (
                  <option key={i} value={i}>
                    {i + 1} · {item.layer} · {kindLabels[item.kind]}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Graphic shape{' '}
              <select
                aria-label="Graphic shape"
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as Kind })
                }
              >
                {Object.entries(kindLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              Layer{' '}
              <select
                aria-label="Layer"
                value={draft.layer}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    layer: e.target.value as FootprintGraphicLayer,
                  })
                }
              >
                {footprintGraphicLayers.map((layer) => (
                  <option key={layer} value={layer}>{boardLayerById.get(layer).label}</option>
                ))}
              </select>
            </label>{' '}
            <label>
              Stroke (mm){' '}
              <input
                size={5}
                value={draft.stroke}
                onChange={(e) => setDraft({ ...draft, stroke: e.target.value })}
              />
            </label>{' '}
            <label>
              <input
                type="checkbox"
                checked={draft.filled}
                onChange={(e) =>
                  setDraft({ ...draft, filled: e.target.checked })
                }
              />{' '}
              Filled
            </label>
          </p>
          <p>
            <label>
              Graphic points (one X Y pair per line in mm)
              <br />
              <textarea
                value={draft.points}
                onChange={(e) => setDraft({ ...draft, points: e.target.value })}
              />
            </label>
          </p>
          {draft.kind === 'text' && (
            <p>
              <label>
                Artwork text{' '}
                <input
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
              </label>{' '}
              <p>
                Use <code>{'$' + '{REFERENCE}'}</code> or{' '}
                <code>{'$' + '{VALUE}'}</code> for text from the placed component.
              </p>
              <label>
                Text width (mm){' '}
                <input
                  value={draft.width}
                  size={5}
                  onChange={(e) =>
                    setDraft({ ...draft, width: e.target.value })
                  }
                />
              </label>{' '}
              <label>
                Text height (mm){' '}
                <input
                  value={draft.height}
                  size={5}
                  onChange={(e) =>
                    setDraft({ ...draft, height: e.target.value })
                  }
                />
              </label>{' '}
              <label>
                Text rotation (°){' '}
                <input
                  value={draft.rotation}
                  size={5}
                  onChange={(e) =>
                    setDraft({ ...draft, rotation: e.target.value })
                  }
                />
              </label>
            </p>
          )}
          <Button
            onClick={(): void => {
              void run(save);
            }}
          >
            {index === undefined ? 'Add graphic' : 'Update graphic'}
          </Button>{' '}
          <Button
            disabled={index === undefined}
            onClick={() => {
              onChange(graphics.filter((_, i) => i !== index));
              select(undefined);
            }}
          >
            Remove graphic
          </Button>
        </>
      )}
    </fieldset>
  );
}

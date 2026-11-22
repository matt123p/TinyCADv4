import React from 'react';
import { Button, Select } from '@fluentui/react-components';

const steps = [
  'Review parts',
  'Set up the board',
  'Place footprints',
  'Route connections',
  'Check the board',
  'Review manufacturing output',
];

interface FirstBoardGuideProps {
  step: number;
  onStepChange(step: number): void;
  onClose(): void;
  onUpdate?: () => void;
  onOutline(): void;
  onFabrication(): void;
  onPlacement(): void;
  onRouting(): void;
  onChecks(): void;
  onPreview(): void;
  components: number;
  unplaced: number;
  withoutDevices: number;
  hasNets: boolean;
  routing: boolean;
  measuring: boolean;
  busy: boolean;
  dirty: boolean;
  geometryAvailable: boolean;
}

export default function FirstBoardGuide({
  step,
  onStepChange,
  onClose,
  onUpdate,
  onOutline,
  onFabrication,
  onPlacement,
  onRouting,
  onChecks,
  onPreview,
  components,
  unplaced,
  withoutDevices,
  hasNets,
  routing,
  measuring,
  busy,
  dirty,
  geometryAvailable,
}: FirstBoardGuideProps) {
  return (
    <section className="pcb-guide" aria-label="First board guide">
      <h3>First board guide</h3>
      <p role="status">
        Step {step + 1} of {steps.length} · {steps[step]}
      </p>
      {step === 0 && (
        <>
          <p>
            A schematic symbol shows a part’s function. A device maps its pins
            to the pads of a footprint, which defines how the physical part fits
            on the board. Compare the pad numbers and polarity with the part
            drawing before accepting the mapping.
          </p>
          {onUpdate ? (
            <>
              {withoutDevices > 0 && (
                <p>
                  {withoutDevices}{' '}
                  {withoutDevices === 1 ? 'component needs' : 'components need'}{' '}
                  a reviewed device.
                </p>
              )}
              <Button disabled={busy || dirty || routing} onClick={onUpdate}>
                Review schematic changes…
              </Button>
              {dirty && <p>Save the PCB to review schematic changes.</p>}
            </>
          ) : (
            <p>
              To start from a schematic, open its project folder and choose
              <strong> Create PCB from Schematic…</strong> from the schematic’s
              actions.
            </p>
          )}
        </>
      )}
      {step === 1 && (
        <>
          <p>
            Set the board outline and copper layer count. For a two-sided
            exercise, choose two layers. Then select the fabrication profile for
            the exercise and review the track and hole limits.
          </p>
          <Button disabled={busy || routing} onClick={onOutline}>
            PCB Size & Shape…
          </Button>{' '}
          <Button disabled={busy || routing} onClick={onFabrication}>
            Choose fabrication settings…
          </Button>
        </>
      )}
      {step === 2 && (
        <>
          <p>
            Choose a footprint in <strong>Unplaced components</strong>. Drag
            its preview onto the drawing or choose <strong>Place on board</strong>.
            Check the orientation and click the board to place it. Use the file
            commands when you are ready to save.
          </p>
          {components > 0 ? (
            <>
              <p>
                {unplaced
                  ? unplaced +
                    (unplaced === 1
                      ? ' component to place.'
                      : ' components to place.')
                  : 'Every component has a placement.'}
              </p>
              {unplaced > 0 && (
                <Button
                  disabled={busy || routing || measuring}
                  onClick={onPlacement}
                >
                  Go to unplaced components
                </Button>
              )}
            </>
          ) : (
            <p>
              This board has no components yet. See Review parts to start from a
              schematic.
            </p>
          )}
        </>
      )}
      {step === 3 && (
        <>
          <p>
            An airwire shows an electrical connection to make. Start a track on
            a pad and click to add corners. On a two-layer board, a via connects
            the copper layers. End at another pad on the same net and choose
            <strong> Finish route</strong>.
          </p>
          <p>
            On a single-sided board, use <strong>Add wire jumper…</strong> when
            a wire must bridge a gap. Route to each drilled land separately.
          </p>
          {!hasNets && (
            <p>Transfer a schematic with connected nets to route this board.</p>
          )}
          <Button
            disabled={busy || routing || !hasNets || !geometryAvailable}
            onClick={onRouting}
          >
            Start routing
          </Button>
        </>
      )}
      {step === 4 && (
        <>
          <p>
            Run design checks after placement and routing. Select a finding to
            locate it on the board. Compare the measured and required values
            where given, fix the issue, and run the checks again.
          </p>
          <Button
            disabled={busy || routing || !geometryAvailable}
            onClick={onChecks}
          >
            Check this revision…
          </Button>
        </>
      )}
      {step === 5 && (
        <>
          <p>
            Inspect the read-back copper, board edges and holes. Print the
            footprint check at 1:1 scale and compare it with the physical parts.
            Review the release blockers before downloading a manufacturing
            review.
          </p>
          <Button
            disabled={busy || routing || !geometryAvailable}
            onClick={onPreview}
          >
            Open manufacturing preview…
          </Button>
        </>
      )}
      <div className="pcb-guide-actions">
        <Select
          aria-label="Guide step"
          value={step}
          onChange={(event) => onStepChange(Number(event.target.value))}
        >
          {steps.map((title, index) => (
            <option key={title} value={index}>
              {title}
            </option>
          ))}
        </Select>
        <Button disabled={step === 0} onClick={() => onStepChange(step - 1)}>
          Previous step
        </Button>
        <Button
          disabled={step === steps.length - 1}
          onClick={() => onStepChange(step + 1)}
        >
          Next step
        </Button>
        <Button onClick={onClose}>Close guide</Button>
      </div>
    </section>
  );
}

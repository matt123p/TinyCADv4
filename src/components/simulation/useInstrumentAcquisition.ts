import { useEffect, useMemo, useState } from 'react';
import { dsnDrawing } from '../../model/dsnDrawing';
import { getResult } from '../../simulation/resultStore';
import { NetlistWorkerState } from '../../web-worker/netlistState';
import { applyBindings } from '../../simulation/bindings';
import { digest } from '../../io/dsnContainer';
import { buildDeck } from '../../simulation/deck';
import { subscribeSession } from '../../simulation/session';

export function useInstrumentAcquisition(
  drawing: dsnDrawing,
  selected: string,
) {
  const [, refresh] = useState(0);
  useEffect(() => subscribeSession(() => refresh((n) => n + 1)), []);
  const available = drawing.sheets
    .flatMap((sheet) =>
      (sheet.simulation?.runs || [])
        .filter((run) => run.dataState === 'available' && getResult(run.id))
        .map((run) => ({ sheet, run })),
    )
    .sort((a, b) => b.run.created.localeCompare(a.run.created));
  const chosen = available.find((a) => a.run.id === selected) || available[0];
  const net = useMemo(() => {
    try {
      return new NetlistWorkerState().init({
        ...drawing,
        sheets: drawing.sheets.filter((s) => s.kind !== 'simulation'),
      });
    } catch {
      return;
    }
  }, [drawing]);
  const [verified, setVerified] = useState<{
    drawing: dsnDrawing;
    runId: string;
    matches: boolean;
  }>();
  useEffect(() => {
    let alive = true;
    if (net && chosen)
      try {
        const setup = {
          ...chosen.sheet.simulation,
          analysis: chosen.run.analysis,
          parameters: chosen.run.parameters,
          measurements:
            chosen.run.explorer?.definitions ||
            chosen.sheet.simulation.measurements,
        };
        const configured = chosen.run.explorer
          ? applyBindings(
              drawing,
              { ...setup, bindings: chosen.run.explorer.bindings },
              chosen.run.explorer.overrides,
            )
          : { drawing, setup };
        const capturedNet =
          configured.drawing === drawing
            ? net
            : new NetlistWorkerState().init({
                ...configured.drawing,
                sheets: configured.drawing.sheets.filter(
                  (s) => s.kind !== 'simulation',
                ),
              });
        digest(
          new TextEncoder().encode(
            buildDeck(capturedNet, configured.setup) +
              JSON.stringify(configured.setup.models),
          ),
        ).then(
          (hash) => {
            if (alive)
              setVerified({
                drawing,
                runId: chosen.run.id,
                matches:
                  hash ===
                  (chosen.run.resistanceTest?.baseHash ||
                    chosen.run.circuitHash),
              });
          },
          () => {
            if (alive)
              setVerified({ drawing, runId: chosen.run.id, matches: false });
          },
        );
      } catch {
        setVerified({ drawing, runId: chosen.run.id, matches: false });
      }
    return () => {
      alive = false;
    };
  }, [drawing, net, chosen?.run.id]);
  const fresh =
    verified?.drawing === drawing &&
    verified.runId === chosen?.run.id &&
    verified.matches;
  return {
    available,
    chosen,
    net,
    fresh,
    data:
      fresh && chosen?.run.state === 'complete'
        ? getResult(chosen.run.id)
        : undefined,
  };
}

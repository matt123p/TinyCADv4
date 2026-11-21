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
import {
  boardOutputDirectory,
  boardOutputFilename,
  projectBoardOutputFormats,
  projectNetlistFormats,
} from '../../pcb/projectSettings';
import type {
  ProjectBoardOutputFormat,
  ProjectBoardOutputRecipe,
  ProjectLink,
  ProjectNetlistFormat,
  ProjectOutputRecipe,
} from '../../pcb/projectSettings';
import {
  runProjectOutputRecipe,
  saveProjectOutputRecipes,
} from '../../io/projectOutputs';
import { readProject } from '../../io/projects';

function PcbRecipeFields({
  recipe,
  boards,
  busy,
  onChange,
}: {
  recipe: ProjectBoardOutputRecipe;
  boards: readonly ProjectLink[];
  busy: boolean;
  onChange(recipe: ProjectBoardOutputRecipe): void;
}) {
  const spec = projectBoardOutputFormats[recipe.format];
  return (
    <>
      <label>
        Source PCB
        <select
          value={recipe.board}
          disabled={busy}
          onChange={(event) =>
            onChange({ ...recipe, board: event.target.value })
          }
        >
          {boards.map(({ id, path }) => (
            <option key={id} value={id}>
              {path}
            </option>
          ))}
        </select>
      </label>
      <label>
        PCB output format
        <select
          value={recipe.format}
          disabled={busy}
          onChange={(event) => {
            const format = event.target.value as ProjectBoardOutputFormat;
            const next = projectBoardOutputFormats[format];
            const layer = next.sided ? recipe.layer ?? 'top' : undefined;
            onChange({
              ...recipe,
              format,
              layer,
              decimals: next.precision ? recipe.decimals : undefined,
              csvText: next.extension === 'csv' ? recipe.csvText : undefined,
              filename: boardOutputFilename(format, layer),
            });
          }}
        >
          {Object.entries(projectBoardOutputFormats).map(
            ([format, { label }]) => (
              <option key={format} value={format}>
                {label}
              </option>
            ),
          )}
        </select>
      </label>
      {spec.sided && (
        <label>
          Board side
          <select
            value={recipe.layer}
            disabled={busy}
            onChange={(event) => {
              const layer = event.target.value === 'bottom' ? 'bottom' : 'top';
              const currentDefault = boardOutputFilename(
                recipe.format,
                recipe.layer,
              );
              onChange({
                ...recipe,
                layer,
                filename:
                  recipe.filename === currentDefault
                    ? boardOutputFilename(recipe.format, layer)
                    : recipe.filename,
              });
            }}
          >
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
      )}
      {spec.extension === 'csv' && (
        <label>
          CSV text
          <select value={recipe.csvText ?? ''} disabled={busy} onChange={(event) =>
            onChange({ ...recipe, csvText: event.target.value === 'raw' ? 'raw' : undefined })}>
            <option value="">Spreadsheet text</option>
            <option value="raw">Raw text for machine import</option>
          </select>
        </label>
      )}
      {spec.precision && (
        <label>
          Decimal places
          <select
            value={recipe.decimals ?? ''}
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...recipe,
                decimals:
                  event.target.value === ''
                    ? undefined
                    : Number(event.target.value),
              })
            }
          >
            <option value="">Full precision</option>
            {[0, 1, 2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

export default function ProjectOutputsDialog({
  initialProject,
  location,
  boardId,
  onClose,
}: {
  initialProject: Awaited<ReturnType<typeof readProject>>;
  location: { id: string; rootId: string };
  boardId?: string;
  onClose(): void;
}) {
  const [project, setProject] = useState(initialProject);
  const [editing, setEditing] = useState<ProjectOutputRecipe>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const recipes = project.settings.outputRecipes ?? [];
  const schematics = project.settings.entries.filter(
    ({ kind }) => kind === 'schematic',
  );

  const boards = project.settings.entries.filter(
    ({ kind }) => kind === 'board',
  );
  const associatedBoards = boards.filter(({ id }) =>
    project.settings.associations?.some(({ board }) => board === id),
  );

  function defaultDirectory(board: string | undefined, pcb = false) {
    const link = boards.find(({ id }) => id === board);
    return boardOutputDirectory(link?.path ?? '', pcb);
  }

  function changeCircuitSource(recipe: Exclude<ProjectOutputRecipe, ProjectBoardOutputRecipe>, value: string) {
    const [kind, id] = value.split(':');
    const directory = recipe.directory === defaultDirectory(recipe.board)
      ? defaultDirectory(kind === 'board' ? id : undefined) : recipe.directory;
    const { board, schematic, ...fields } = recipe;
    setEditing({ ...fields, directory, ...(kind === 'board' ? { board: id } : { schematic: id }) });
  }

  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save(next: readonly ProjectOutputRecipe[]) {
    await saveProjectOutputRecipes(location, project, next);
    setProject(await readProject(location.id, location.rootId));
    setEditing(undefined);
  }

  function newRecipe(kind: ProjectOutputRecipe['kind']) {
    const id = crypto.randomUUID();
    if (kind === 'pcb') {
      const board = boardId ?? project.settings.primaryBoard ?? boards[0]?.id;
      if (board)
        setEditing({
          id,
          directory: defaultDirectory(board, true),
          kind,
          board,
          format: 'board-bom',
          filename: 'bom.csv',
        });
      return;
    }
    const board = associatedBoards.find(({ id }) => id === boardId)?.id;
    const schematic = project.settings.primarySchematic ?? schematics[0]?.id;
    if (!board && !schematic) return;
    const base = { id, directory: defaultDirectory(board), ...(board ? { board } : { schematic }) };
    setEditing(
      kind === 'bom'
        ? { ...base, kind, filename: 'bom.csv' }
        : { ...base, kind, filename: 'circuit.net', format: 'PADS-PCB' },
    );
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && !busy && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Project outputs</DialogTitle>
          <DialogContent>
            <p>
              Circuit recipes expand saved schematics and their linked child sheets.
              Choose a PCB to use its associated schematic and board folder.
            </p>
            <Button
              disabled={busy || !schematics.length}
              onClick={() => newRecipe('bom')}
            >
              Add BOM recipe
            </Button>
            <Button
              disabled={busy || !schematics.length}
              onClick={() => newRecipe('netlist')}
            >
              Add netlist recipe
            </Button>
            <Button
              disabled={busy || !boards.length}
              onClick={() => newRecipe('pcb')}
            >
              Add PCB output recipe
            </Button>
            <ul aria-label="Output recipes">
              {recipes.map((recipe) => (
                <li key={recipe.id}>
                  {recipe.directory}/{recipe.filename}{' '}
                  {recipe.board && (
                    <span>· {boards.find(({ id }) => id === recipe.board)?.path}{' '}</span>
                  )}
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => setEditing(recipe)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      void action(async () => {
                        const path = await runProjectOutputRecipe(
                          location,
                          recipe.id,
                        );
                        setStatus('Generated ' + path);
                      });
                    }}
                  >
                    Run
                  </Button>
                </li>
              ))}
            </ul>
            {editing && (
              <form
                className="pcb-profile-fields"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = recipes.some(({ id }) => id === editing.id)
                    ? recipes.map((recipe) =>
                        recipe.id === editing.id ? editing : recipe,
                      )
                    : [...recipes, editing];
                  void action(() => save(next));
                }}
              >
                {editing.kind === 'pcb' ? (
                  <PcbRecipeFields
                    recipe={editing}
                    boards={boards}
                    busy={busy}
                    onChange={(next) => setEditing({
                      ...next,
                      directory: editing.directory === defaultDirectory(editing.board, true)
                        ? defaultDirectory(next.board, true) : editing.directory,
                    })}
                  />
                ) : (
                  <label>
                    Circuit source
                    <select
                      aria-label="Circuit source"
                      value={editing.board ? 'board:' + editing.board : 'schematic:' + editing.schematic}
                      disabled={busy}
                      onChange={(event) => changeCircuitSource(editing, event.target.value)}
                    >
                      {!!associatedBoards.length && (
                        <optgroup label="PCBs with an associated schematic">
                          {associatedBoards.map(({ id, path }) => (
                            <option key={id} value={'board:' + id}>{path}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Schematics">
                        {schematics.map(({ id, path }) => (
                          <option key={id} value={'schematic:' + id}>{path}</option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                )}
                <label>
                  Output folder
                  <input
                    required
                    value={editing.directory}
                    disabled={busy}
                    onChange={(event) =>
                      setEditing({ ...editing, directory: event.target.value })
                    }
                  />
                </label>
                <label>
                  Filename
                  <input
                    required
                    value={editing.filename}
                    disabled={busy}
                    onChange={(event) =>
                      setEditing({ ...editing, filename: event.target.value })
                    }
                  />
                </label>
                {editing.kind === 'netlist' && (
                  <label>
                    Netlist format
                    <select
                      value={editing.format}
                      disabled={busy}
                      onChange={(event) => {
                        const format = event.target
                          .value as ProjectNetlistFormat;
                        const filename =
                          editing.filename.replace(/\.(?:net|scr)$/i, '') +
                          (format === 'Eagle SCR' ? '.scr' : '.net');
                        setEditing({ ...editing, format, filename });
                      }}
                    >
                      {projectNetlistFormats.map((format) => (
                        <option key={format}>{format}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div>
                  <Button appearance="primary" type="submit" disabled={busy}>
                    Save recipe
                  </Button>
                  <Button disabled={busy} onClick={() => setEditing(undefined)}>
                    Cancel edit
                  </Button>
                  {recipes.some(({ id }) => id === editing.id) && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        void action(() =>
                          save(recipes.filter(({ id }) => id !== editing.id)),
                        );
                      }}
                    >
                      Remove recipe
                    </Button>
                  )}
                </div>
              </form>
            )}
            {status && <p role="status">{status}</p>}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

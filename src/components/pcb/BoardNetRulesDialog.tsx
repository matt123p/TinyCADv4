import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import type { BoardDocument, BoardOperation } from '../../pcb/board';
import { boardRuleResolver, clearanceKinds, preferredTrackWidth } from '../../pcb/boardRules';
import type { CopperClearanceRule } from '../../pcb/boardRules';
import { lengthInNanometres } from '../../pcb/geometry';

const fields = [
  ['minWidthNm', 'Minimum track width'],
  ['preferredWidthNm', 'Preferred track width'],
  ['maxWidthNm', 'Maximum track width'],
  ['clearanceNm', 'Copper clearance'],
  ['edgeClearanceNm', 'Copper to edge'],
  ['minViaAnnulusNm', 'Minimum via annular ring'],
] as const;

export default function BoardNetRulesDialog({ board, selectedNet, onApply, onClose }: {
  board: BoardDocument;
  selectedNet: string;
  onApply(operation: BoardOperation): void;
  onClose(): void;
}) {
  const [selection, setSelection] = useState(selectedNet ? 'net:' + selectedNet : 'new');
  const [error, setError] = useState('');
  const net = board.nets?.find(({ id }) => selection === 'net:' + id);
  const netClass = board.netClasses?.find(({ id }) => selection === 'class:' + id);
  const pairRule = board.clearanceRules?.find(({ id }) => selection === 'clearance:' + id);
  const editingClearance = selection === 'new-clearance' || !!pairRule;
  const stored = net?.routingRules ?? netClass?.rules;
  const effective = net && boardRuleResolver(board).net(net.id);
  const formatMm = (value: number) => value / 1e6 + ' mm';

  function apply(operation: BoardOperation) {
    try {
      onApply(operation);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (field: string) => String(form.get(field) ?? '').trim();
    try {
      if (editingClearance) {
        const firstClass = value('firstClass');
        const secondClass = value('secondClass');
        const firstKind = value('firstKind') as CopperClearanceRule['firstKind'];
        const secondKind = value('secondKind') as CopperClearanceRule['secondKind'];
        apply({
          type: 'setClearanceRule',
          rule: {
            id: pairRule?.id ?? crypto.randomUUID(),
            name: value('name'),
            clearanceNm: lengthInNanometres(value('clearanceNm'), 'mm'),
            ...(firstClass ? { firstClass } : {}),
            ...(secondClass ? { secondClass } : {}),
            ...(firstKind ? { firstKind } : {}),
            ...(secondKind ? { secondKind } : {}),
          },
        });
        return;
      }
      const rules = Object.fromEntries(fields.flatMap(([id]) => {
        const text = value(id);
        return text ? [[id, lengthInNanometres(text, 'mm')]] : [];
      }));
      if (net) apply({ type: 'setNetRouting', id: net.id, classId: String(form.get('classId')) || undefined, rules });
      else apply({
        type: 'setNetClass',
        netClass: { id: netClass?.id ?? crypto.randomUUID(), name: String(form.get('name')).trim(), rules },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function clearanceSelector(side: 'first' | 'second', label: string) {
    const classField = side === 'first' ? 'firstClass' : 'secondClass';
    const kindField = side === 'first' ? 'firstKind' : 'secondKind';
    return (
      <fieldset key={side}>
        <legend>{label} copper object</legend>
        <label>
          {label} net class
          <select aria-label={label + ' net class'} name={classField} defaultValue={pairRule?.[classField] ?? ''}>
            <option value="">Any class</option>
            <option value="default">No assigned class</option>
            {board.netClasses?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>
          {label} object type
          <select aria-label={label + ' object type'} name={kindField} defaultValue={pairRule?.[kindField] ?? ''}>
            <option value="">Any type</option>
            {clearanceKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
      </fieldset>
    );
  }

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>PCB net rules</DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <label>
                Edit rules for
                <select aria-label="Edit rules for" value={selection} onChange={(event) => {
                  setSelection(event.target.value);
                  setError('');
                }}>
                  <option value="new">New net class</option>
                  <option value="new-clearance">New clearance rule</option>
                  <optgroup label="Net classes">
                    {board.netClasses?.map(({ id, name }) => <option key={id} value={'class:' + id}>{name}</option>)}
                  </optgroup>
                  <optgroup label="PCB nets">
                    {board.nets?.map(({ id, name }) => <option key={id} value={'net:' + id}>{name}</option>)}
                  </optgroup>
                  <optgroup label="Clearance rules">
                    {board.clearanceRules?.map(({ id, name }) => <option key={id} value={'clearance:' + id}>{name}</option>)}
                  </optgroup>
                </select>
              </label>
              {editingClearance ? (
                <React.Fragment key={selection}>
                  <label>Rule name<input name="name" required defaultValue={pairRule?.name ?? ''} /></label>
                  <label>
                    Minimum clearance (mm)
                    <input name="clearanceNm" required defaultValue={pairRule ? String(pairRule.clearanceNm / 1e6) : ''} />
                  </label>
                  {clearanceSelector('first', 'First')}
                  {clearanceSelector('second', 'Second')}
                </React.Fragment>
              ) : <React.Fragment key={selection}>
                {net ? (
                  <label>
                    Net class
                    <select aria-label="Net class" name="classId" defaultValue={net.classId ?? ''}>
                      <option value="">Board defaults</option>
                      {board.netClasses?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </label>
                ) : (
                  <label>Class name<input name="name" required defaultValue={netClass?.name ?? ''} /></label>
                )}
                <p>Leave a field blank to inherit it.</p>
                {fields.map(([id, label]) => (
                  <label key={id}>
                    {label} (mm)
                    <input name={id} defaultValue={stored?.[id] === undefined ? '' : String(stored[id] / 1e6)} />
                    {effective && (effective[id] !== undefined || id === 'preferredWidthNm') && (
                      <span>Saved effective value {formatMm(
                        id === 'preferredWidthNm' ? preferredTrackWidth(effective, 250_000) : effective[id],
                      )}</span>
                    )}
                  </label>
                ))}
              </React.Fragment>}
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              {netClass && <Button onClick={() => apply({ type: 'removeNetClass', id: netClass.id })}>Remove class</Button>}
              {pairRule && <Button onClick={() => apply({ type: 'removeClearanceRule', id: pairRule.id })}>Remove rule</Button>}
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" appearance="primary">Apply</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

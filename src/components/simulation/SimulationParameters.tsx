import React from 'react';
import { EditablePropertyTable } from '../controls/EditablePropertyTable';

export function SimulationParameters({
  parameters,
  disabled,
  change,
}: {
  parameters: Record<string, string>;
  disabled: boolean;
  change: (parameters: Record<string, string>) => void;
}) {
  const entries = Object.entries(parameters);
  return (
    <section className="simulation-parameters" aria-label="Parameters">
      <h3>Parameters</h3>
      <fieldset disabled={disabled}>
        <EditablePropertyTable
          title="Parameters"
          addLabel="Add parameter"
          showColumn={false}
          items={entries.map(([name, value], id) => ({
            id,
            name,
            value,
            show: false,
            editable: true,
            deletable: true,
          }))}
          onNameChange={(id, name) => {
            if (
              entries.some(
                ([existing], index) =>
                  index !== Number(id) && existing === name,
              )
            )
              return;
            change(
              Object.fromEntries(
                entries.map((entry, index) =>
                  index === Number(id) ? [name, entry[1]] : entry,
                ),
              ),
            );
          }}
          onValueChange={(id, value) =>
            change(
              Object.fromEntries(
                entries.map((entry, index) =>
                  index === Number(id) ? [entry[0], value] : entry,
                ),
              ),
            )
          }
          onDelete={(id) =>
            change(
              Object.fromEntries(
                entries.filter((_, index) => index !== Number(id)),
              ),
            )
          }
          onShowChange={() => {}}
          onAdd={() => {
            let index = 1;
            while (Object.hasOwn(parameters, `parameter${index}`)) index++;
            change({ ...parameters, [`parameter${index}`]: '1' });
          }}
        />
      </fieldset>
    </section>
  );
}

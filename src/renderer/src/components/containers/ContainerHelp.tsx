import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNativeSurfaceBlock } from '../../native-surface';
import type { CommandGroup } from '../../kube-commands';
import { CONTAINER_COMMANDS, type ContainerCommandContext } from '../../container-commands';
import { CHIPS } from '../../container-status';
import { FILTER_HELP, columnsFor, groupOptionsFor, primaryFilterColumn, type ColumnFilterKind } from '../../container-columns';
import { currentColumns, type ContainerViewState } from '../../container-view';

const GROUPS: CommandGroup[] = ['Navigation', 'Ansicht', 'Aktionen'];
const KIND_LABEL: Record<ColumnFilterKind, string> = {
  text: 'Text', select: 'Auswahl', number: 'Zahl', size: 'Größe', age: 'Alter',
};
const KIND_TITLE = { containers: 'Container', images: 'Images', volumes: 'Volumes', networks: 'Netzwerke' } as const;

interface ContainerHelpProps {
  state: ContainerViewState;
  context: ContainerCommandContext;
  onClose: () => void;
}

/** Modal with every key and the filters of the current tab; unavailable entries stay visible with the reason. */
export function ContainerHelp({ state, context, onClose }: ContainerHelpProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useNativeSurfaceBlock(true);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const needle = search.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const kind = state.kind;
  const label = KIND_TITLE[kind];
  const runtime = state.inventory?.runtime ?? 'docker';
  const hotkeys = CONTAINER_COMMANDS.filter(command => matches([command.description, command.keys.join(' '), command.bindings.join(' ')].join(' ')));
  const nameColumn = columnsFor(kind, runtime).find(column => column.key === primaryFilterColumn(kind))?.label ?? 'Name';
  const intro = `Unter jedem Spaltenkopf steht ein Filterfeld. / springt in das Feld „${nameColumn}“.`;
  const forms = FILTER_HELP.filter(item => matches([item.form, item.description, item.example].join(' ')));
  const columns = currentColumns(state).filter(column => matches(`${column.label} ${KIND_LABEL[column.filter]}`));
  const chips = CHIPS[kind];
  const chipText = chips.map(chip => chip.label).join(' · ');
  const noChips = chips.length === 0;
  const showChips = matches(noChips ? 'Keine Status-Filter.' : chipText);
  const groupText = ['keine', ...groupOptionsFor(kind, runtime).map(option => option.label)].join(' · ');

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The view also listens for keys; Escape must only close this dialog.
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
  };

  return (
    <div className="kube-modal-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Hilfe zur Container-Ansicht" className="kube-modal kube-help"
        onMouseDown={event => event.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="kube-help-head">
          <h2>Tasten und Filter</h2>
          <input ref={inputRef} type="search" placeholder="Suchen …" aria-label="Hilfe durchsuchen" value={search}
            onChange={event => setSearch(event.target.value)} />
          <button type="button" onClick={onClose}>Schließen</button>
        </div>
        <div className="kube-help-columns">
          <div>
            <h3>Tasten</h3>
            {GROUPS.map(group => {
              const entries = hotkeys.filter(command => command.group === group);
              if (entries.length === 0) return null;
              return (
                <section key={group}>
                  <h4>{group}</h4>
                  <dl>
                    {entries.map(command => {
                      const reason = command.unavailable?.(context);
                      return (
                        <div key={command.id} className={`kube-help-row${reason ? ' kube-help-off' : ''}`} title={reason}>
                          <dt>{command.keys.map(key => <kbd key={key}>{key}</kbd>)}</dt>
                          <dd>{command.description}{reason && <span className="kube-muted"> – {reason}</span>}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              );
            })}
          </div>
          <div>
            <h3>Filter</h3>
            {matches(intro) && <p className="kube-muted">{intro}</p>}
            <dl>
              {forms.map(item => (
                <div key={item.form} className="kube-help-row">
                  <dt><code>{item.form}</code></dt>
                  <dd>
                    {item.description}
                    <span className="kube-muted"> · Beispiel: <code>{item.example}</code></span>
                  </dd>
                </div>
              ))}
            </dl>
            {columns.length > 0 && (
              <section>
                <h4>Spaltenfilter für {label}</h4>
                <dl>
                  {columns.map(column => (
                    <div key={column.key} className="kube-help-row">
                      <dt>{column.label}</dt>
                      <dd>{KIND_LABEL[column.filter]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {showChips && (
              <section>
                <h4>Status-Filter für {label}</h4>
                <p>{noChips ? 'Keine Status-Filter.' : chipText}</p>
              </section>
            )}
            {matches(groupText) && (
              <section>
                <h4>Gruppieren für {label}</h4>
                <p>{groupText}</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

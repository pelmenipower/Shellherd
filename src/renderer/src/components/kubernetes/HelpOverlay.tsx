import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNativeSurfaceBlock } from '../../native-surface';
import { KUBE_COMMANDS, type CommandGroup, type KubeCommand } from '../../kube-commands';
import { columnsOf, type KubeViewState } from '../../kube-view';
import { FILTER_HELP, FILTER_KIND_LABEL, FILTER_NOTE, GROUP_NOTE, GROUP_OPTIONS, TEXT_FILTER_NOTE, columnFilterKind, primaryFilterColumn } from '../../kube-columns';
import { CHIPS } from '../../../../shared/kube-status';
import { KIND_INFO } from '../../../../shared/kubernetes';

const GROUPS: CommandGroup[] = ['Navigation', 'Ansicht', 'Aktionen'];

interface HelpOverlayProps {
  state: KubeViewState;
  readOnly: boolean;
  onClose: () => void;
}

/** Modal with every key and the filters of the current kind; unavailable entries stay visible with the reason. */
export function HelpOverlay({ state, readOnly, onClose }: HelpOverlayProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useNativeSurfaceBlock(true);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const needle = search.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const reasonOf = (command: KubeCommand) => command.unavailable?.({ state, readOnly });
  const hotkeys = KUBE_COMMANDS.filter(command => command.keys.length > 0
    && matches([command.description, command.keys.join(' '), command.bindings.join(' ')].join(' ')));
  const kind = state.query.kind;
  const label = KIND_INFO[kind].label;
  const nameColumn = primaryFilterColumn(kind) === 'message' ? 'Meldung' : 'Name';
  const intro = `Unter jedem Spaltenkopf steht ein Filterfeld. / springt in das Feld „${nameColumn}“.`;
  const showIntro = matches(intro);
  const forms = FILTER_HELP.filter(item => matches([item.form, item.description, item.example].join(' ')));
  const showNote = matches(FILTER_NOTE);
  const columns = columnsOf(state).map(column => ({ column, art: columnFilterKind(kind, column) }))
    .filter(item => item.art !== 'none' && matches(`${item.column.label} ${FILTER_KIND_LABEL[item.art as keyof typeof FILTER_KIND_LABEL]}`));
  const chipText = CHIPS[kind].map(chip => chip.label).join(' · ');
  const noChips = CHIPS[kind].length === 0;
  const showChips = matches(noChips ? 'Keine Status-Filter.' : chipText);
  const groupText = ['keine', ...GROUP_OPTIONS[kind].map(option => option.label)].join(' · ');
  const showGroups = matches(groupText);
  const showGroupNote = matches(GROUP_NOTE);
  const showText = matches(TEXT_FILTER_NOTE);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The view also listens for keys; Escape must only close this dialog.
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
  };

  return (
    <div className="kube-modal-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Hilfe zur Cluster-Ansicht" className="kube-modal kube-help"
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
                      const reason = reasonOf(command);
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
            {showIntro && <p className="kube-muted">{intro}</p>}
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
            {showNote && <p className="kube-muted">{FILTER_NOTE}</p>}
            {columns.length > 0 && (
              <section>
                <h4>Spaltenfilter für {label}</h4>
                <dl>
                  {columns.map(({ column, art }) => (
                    <div key={column.key} className="kube-help-row">
                      <dt>{column.label}</dt>
                      <dd>{FILTER_KIND_LABEL[art as keyof typeof FILTER_KIND_LABEL]}</dd>
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
            {(showGroups || showGroupNote) && (
              <section>
                <h4>Gruppieren für {label}</h4>
                {showGroups && <p>{groupText}</p>}
                {showGroupNote && <p className="kube-muted">{GROUP_NOTE}</p>}
              </section>
            )}
            {showText && (
              <section>
                <h4>Textfilter</h4>
                <p className="kube-muted">{TEXT_FILTER_NOTE}</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

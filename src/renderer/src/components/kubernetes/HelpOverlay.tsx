import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNativeSurfaceBlock } from '../../native-surface';
import { KUBE_COMMANDS, type CommandGroup, type KubeCommand } from '../../kube-commands';
import type { KubeViewState } from '../../kube-view';
import { SEARCH_HELP } from '../../../../shared/kube-filter';
import { CHIPS } from '../../../../shared/kube-status';
import { KIND_INFO } from '../../../../shared/kubernetes';

const GROUPS: CommandGroup[] = ['Navigation', 'Ansicht', 'Aktionen'];

interface HelpOverlayProps {
  state: KubeViewState;
  readOnly: boolean;
  onClose: () => void;
}

/** Modal with every key and `:` command; unavailable entries stay visible with the reason. */
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
  const commands = KUBE_COMMANDS.filter(command => command.command
    && matches([command.command?.syntax, command.command?.example, command.description].join(' ')));

  const kind = state.query.kind;
  const label = KIND_INFO[kind].label;
  const forms = SEARCH_HELP.forms.filter(item => matches([item.form, item.description, item.example].join(' ')));
  const qualifiers = SEARCH_HELP.qualifiers[kind].filter(item => matches(`${item.name}: ${item.description}`));
  const numeric = SEARCH_HELP.numeric[kind];
  const numericText = numeric ? `Zahlen: ${numeric.join(', ')}` : '';
  const showNumeric = numericText !== '' && matches(numericText);
  const chips = CHIPS[kind].filter(chip => matches(`${chip.id} ${chip.label}`));
  const noChips = CHIPS[kind].length === 0 && matches('Keine Status-Filter.');
  const showSyntax = matches(SEARCH_HELP.syntax);
  const showNote = matches(SEARCH_HELP.note);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The view also listens for keys; Escape must only close this dialog.
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
  };

  return (
    <div className="kube-modal-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Hilfe zur Cluster-Ansicht" className="kube-modal kube-help"
        onMouseDown={event => event.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="kube-help-head">
          <h2>Tasten und Befehle</h2>
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
            <h3>Befehle (:)</h3>
            <dl>
              {commands.map(command => {
                const reason = reasonOf(command);
                return (
                  <div key={command.id} className={`kube-help-row${reason ? ' kube-help-off' : ''}`} title={reason}>
                    <dt><code>{command.command?.syntax}</code></dt>
                    <dd>
                      {command.description}
                      <span className="kube-muted"> · Beispiel: <code>{command.command?.example}</code></span>
                      {reason && <span className="kube-muted"> – {reason}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
          <div>
            <h3>Suche</h3>
            {showSyntax && <p><code>{SEARCH_HELP.syntax}</code></p>}
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
            {showNote && <p className="kube-muted">{SEARCH_HELP.note}</p>}
            {(qualifiers.length > 0 || showNumeric) && (
              <section>
                <h4>Qualifier für {label}</h4>
                <dl>
                  {qualifiers.map(item => (
                    <div key={item.name} className="kube-help-row">
                      <dt><code>{item.name}:</code></dt>
                      <dd>{item.description}</dd>
                    </div>
                  ))}
                </dl>
                {showNumeric && <p className="kube-muted">{numericText}</p>}
              </section>
            )}
            {(chips.length > 0 || noChips) && (
              <section>
                <h4>Status-Filter für {label}</h4>
                {noChips ? <p className="kube-muted">Keine Status-Filter.</p> : (
                  <dl>
                    {chips.map(chip => (
                      <div key={chip.id} className="kube-help-row">
                        <dt><code>{chip.id}</code></dt>
                        <dd>{chip.label}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

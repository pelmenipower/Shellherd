import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNativeSurfaceBlock } from '../../native-surface';
import { KUBE_COMMANDS, commandDescription, type CommandGroup, type KubeCommand } from '../../kube-commands';
import { useT } from '../../i18n';
import { chipLabel, columnLabel } from '../../kube-labels';
import { columnsOf, type KubeViewState } from '../../kube-view';
import { FILTER_HELP, FILTER_KIND_LABEL, GROUP_OPTIONS, columnFilterKind, filterNote, groupNote, primaryFilterColumn, textFilterNote } from '../../kube-columns';
import { CHIPS } from '../../../../shared/kube-status';
import { KIND_INFO } from '../../../../shared/kubernetes';

const GROUPS: CommandGroup[] = ['navigation', 'view', 'actions'];
const GROUP_LABEL_KEYS = {
  navigation: 'common:commandGroups.navigation', view: 'common:commandGroups.view', actions: 'common:commandGroups.actions',
} as const satisfies Record<CommandGroup, string>;

interface HelpOverlayProps {
  state: KubeViewState;
  readOnly: boolean;
  onClose: () => void;
}

/** Modal with every key and the filters of the current kind; unavailable entries stay visible with the reason. */
export function HelpOverlay({ state, readOnly, onClose }: HelpOverlayProps) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useNativeSurfaceBlock(true);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const needle = search.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const reasonOf = (command: KubeCommand) => command.unavailable?.({ state, readOnly });
  const hotkeys = KUBE_COMMANDS.filter(command => command.keys.length > 0
    && matches([commandDescription(command), command.keys.join(' '), command.bindings.join(' ')].join(' ')));
  const kind = state.query.kind;
  const label = KIND_INFO[kind].label;
  const nameColumn = columnLabel(primaryFilterColumn(kind));
  const intro = t('kubernetes:help.intro', { column: nameColumn });
  const showIntro = matches(intro);
  const forms = FILTER_HELP.filter(item => matches([item.form, item.description, item.example].join(' ')));
  const showNote = matches(filterNote());
  const columns = columnsOf(state).map(column => ({ column, art: columnFilterKind(kind, column) }))
    .filter(item => item.art !== 'none' && matches(`${columnLabel(item.column.key)} ${FILTER_KIND_LABEL[item.art as keyof typeof FILTER_KIND_LABEL]}`));
  const chipText = CHIPS[kind].map(chip => chipLabel(chip.id, kind)).join(' · ');
  const noChips = CHIPS[kind].length === 0;
  const showChips = matches(noChips ? t('kubernetes:help.noChips') : chipText);
  const groupText = [t('common:none'), ...GROUP_OPTIONS[kind].map(option => option.label)].join(' · ');
  const showGroups = matches(groupText);
  const showGroupNote = matches(groupNote());
  const showText = matches(textFilterNote());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The view also listens for keys; Escape must only close this dialog.
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
  };

  return (
    <div className="kube-modal-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('kubernetes:help.label')} className="kube-modal kube-help"
        onMouseDown={event => event.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="kube-help-head">
          <h2>{t('kubernetes:help.title')}</h2>
          <input ref={inputRef} type="search" placeholder={t('kubernetes:help.searchPlaceholder')} aria-label={t('kubernetes:help.searchLabel')} value={search}
            onChange={event => setSearch(event.target.value)} />
          <button type="button" onClick={onClose}>{t('common:actions.close')}</button>
        </div>
        <div className="kube-help-columns">
          <div>
            <h3>{t('kubernetes:help.keys')}</h3>
            {GROUPS.map(group => {
              const entries = hotkeys.filter(command => command.group === group);
              if (entries.length === 0) return null;
              return (
                <section key={group}>
                  <h4>{t(GROUP_LABEL_KEYS[group])}</h4>
                  <dl>
                    {entries.map(command => {
                      const reason = reasonOf(command);
                      return (
                        <div key={command.id} className={`kube-help-row${reason ? ' kube-help-off' : ''}`} title={reason}>
                          <dt>{command.keys.map(key => <kbd key={key}>{key}</kbd>)}</dt>
                          <dd>{commandDescription(command)}{reason && <span className="kube-muted"> – {reason}</span>}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              );
            })}
          </div>
          <div>
            <h3>{t('kubernetes:help.filters')}</h3>
            {showIntro && <p className="kube-muted">{intro}</p>}
            <dl>
              {forms.map(item => (
                <div key={item.form} className="kube-help-row">
                  <dt><code>{item.form}</code></dt>
                  <dd>
                    {item.description}
                    <span className="kube-muted"> {t('kubernetes:help.example')} <code>{item.example}</code></span>
                  </dd>
                </div>
              ))}
            </dl>
            {showNote && <p className="kube-muted">{filterNote()}</p>}
            {columns.length > 0 && (
              <section>
                <h4>{t('kubernetes:help.columnFilters', { kind: label })}</h4>
                <dl>
                  {columns.map(({ column, art }) => (
                    <div key={column.key} className="kube-help-row">
                      <dt>{columnLabel(column.key)}</dt>
                      <dd>{FILTER_KIND_LABEL[art as keyof typeof FILTER_KIND_LABEL]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {showChips && (
              <section>
                <h4>{t('kubernetes:help.chipFilters', { kind: label })}</h4>
                <p>{noChips ? t('kubernetes:help.noChips') : chipText}</p>
              </section>
            )}
            {(showGroups || showGroupNote) && (
              <section>
                <h4>{t('kubernetes:help.groupBy', { kind: label })}</h4>
                {showGroups && <p>{groupText}</p>}
                {showGroupNote && <p className="kube-muted">{groupNote()}</p>}
              </section>
            )}
            {showText && (
              <section>
                <h4>{t('kubernetes:help.textFilter')}</h4>
                <p className="kube-muted">{textFilterNote()}</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

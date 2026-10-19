import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNativeSurfaceBlock } from '../../native-surface';
import type { CommandGroup } from '../../kube-commands';
import { useT } from '../../i18n';
import { foldCase } from '../../../../shared/format';
import { CONTAINER_COMMANDS, type ContainerCommandContext } from '../../container-commands';
import { CHIPS } from '../../container-status';
import { FILTER_HELP, columnLabel, groupOptionsFor, primaryFilterColumn, type ColumnFilterKind } from '../../container-columns';
import { currentColumns, type ContainerViewState } from '../../container-view';

const GROUPS: CommandGroup[] = ['navigation', 'view', 'actions'];
const GROUP_LABEL_KEYS = {
  navigation: 'common:commandGroups.navigation', view: 'common:commandGroups.view', actions: 'common:commandGroups.actions',
} as const satisfies Record<CommandGroup, string>;
const KIND_LABEL_KEYS = {
  text: 'containers:filterHelp.text.form', select: 'containers:filterHelp.select.form', number: 'containers:filterHelp.number.form',
  size: 'containers:filterHelp.size.form', age: 'containers:filterHelp.age.form',
} as const satisfies Record<ColumnFilterKind, string>;
const KIND_TITLE_KEYS = {
  containers: 'containers:kinds.containers', images: 'containers:kinds.images', volumes: 'containers:kinds.volumes', networks: 'containers:kinds.networks',
} as const;

interface ContainerHelpProps {
  state: ContainerViewState;
  context: ContainerCommandContext;
  onClose: () => void;
}

/** Modal with every key and the filters of the current tab; unavailable entries stay visible with the reason. */
export function ContainerHelp({ state, context, onClose }: ContainerHelpProps) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useNativeSurfaceBlock(true);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const needle = foldCase(search.trim());
  const matches = (text: string) => !needle || foldCase(text).includes(needle);
  const kind = state.kind;
  const label = t(KIND_TITLE_KEYS[kind]);
  const runtime = state.inventory?.runtime ?? 'docker';
  const hotkeys = CONTAINER_COMMANDS.filter(command => matches([command.description, command.keys.join(' '), command.bindings.join(' ')].join(' ')));
  const nameColumn = columnLabel(primaryFilterColumn(kind));
  const intro = t('containers:help.intro', { column: nameColumn });
  const forms = FILTER_HELP.filter(item => matches([item.form, item.description, item.example].join(' ')));
  const columns = currentColumns(state).filter(column => matches(`${column.label} ${t(KIND_LABEL_KEYS[column.filter])}`));
  const chips = CHIPS[kind];
  const chipText = chips.map(chip => chip.label).join(' · ');
  const noChips = chips.length === 0;
  const showChips = matches(noChips ? t('containers:help.noStatusFilters') : chipText);
  const groupText = [t('common:none'), ...groupOptionsFor(kind, runtime).map(option => option.label)].join(' · ');

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The view also listens for keys; Escape must only close this dialog.
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
  };

  return (
    <div className="kube-modal-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('containers:help.aria')} className="kube-modal kube-help"
        onMouseDown={event => event.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="kube-help-head">
          <h2>{t('containers:help.title')}</h2>
          <input ref={inputRef} type="search" placeholder={t('containers:help.searchPlaceholder')} aria-label={t('containers:help.searchAria')} value={search}
            onChange={event => setSearch(event.target.value)} />
          <button type="button" onClick={onClose}>{t('common:actions.close')}</button>
        </div>
        <div className="kube-help-columns">
          <div>
            <h3>{t('containers:help.keys')}</h3>
            {GROUPS.map(group => {
              const entries = hotkeys.filter(command => command.group === group);
              if (entries.length === 0) return null;
              return (
                <section key={group}>
                  <h4>{t(GROUP_LABEL_KEYS[group])}</h4>
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
            <h3>{t('containers:help.filters')}</h3>
            {matches(intro) && <p className="kube-muted">{intro}</p>}
            <dl>
              {forms.map(item => (
                <div key={item.form} className="kube-help-row">
                  <dt><code>{item.form}</code></dt>
                  <dd>
                    {item.description}
                    <span className="kube-muted">{t('containers:help.example')}<code>{item.example}</code></span>
                  </dd>
                </div>
              ))}
            </dl>
            {columns.length > 0 && (
              <section>
                <h4>{t('containers:help.columnFilters', { kind: label })}</h4>
                <dl>
                  {columns.map(column => (
                    <div key={column.key} className="kube-help-row">
                      <dt>{column.label}</dt>
                      <dd>{t(KIND_LABEL_KEYS[column.filter])}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {showChips && (
              <section>
                <h4>{t('containers:help.statusFilters', { kind: label })}</h4>
                <p>{noChips ? t('containers:help.noStatusFilters') : chipText}</p>
              </section>
            )}
            {matches(groupText) && (
              <section>
                <h4>{t('containers:help.grouping', { kind: label })}</h4>
                <p>{groupText}</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

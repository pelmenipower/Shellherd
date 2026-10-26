import type { ForwardKind } from '../../../shared/ssh';
import { MAX_FORWARDS } from '../../../shared/vault/schema';
import { newForwardDraft, type ForwardDraft } from '../forward-form';
import { useT } from '../i18n';
import './editor-ui.css';

const FORWARD_KINDS: ForwardKind[] = ['local', 'remote', 'dynamic'];
const KIND_KEYS = {
  local: 'connection:form.forwards.kinds.local',
  remote: 'connection:form.forwards.kinds.remote',
  dynamic: 'connection:form.forwards.kinds.dynamic',
} as const;
const HINT_KEYS = {
  local: 'connection:form.forwards.hintLocal',
  remote: 'connection:form.forwards.hintRemote',
  dynamic: 'connection:form.forwards.hintDynamic',
} as const;

interface ForwardsEditorProps {
  value: ForwardDraft[];
  onChange: (value: ForwardDraft[]) => void;
  busy: boolean;
  idPrefix: string;
  /** Id of the error message for the list, referenced by aria-describedby. */
  errorId?: string;
}

export function ForwardsEditor({ value, onChange, busy, idPrefix, errorId }: ForwardsEditorProps) {
  const { t } = useT();
  const update = (index: number, change: Partial<ForwardDraft>) =>
    onChange(value.map((draft, position) => position === index ? { ...draft, ...change } : draft));
  const kinds = new Set(value.map(draft => draft.kind));
  return (
    <fieldset className="connection-appearance" aria-describedby={errorId}>
      <legend>{t('connection:form.forwards.legend')}</legend>
      {value.map((draft, index) => {
        const id = `${idPrefix}-forward-${draft.id}`;
        return (
          <div key={draft.id}>
            <div className="editor-auth-row">
              <label>{t('connection:form.forwards.kind')}
                <select id={`${id}-kind`} value={draft.kind} disabled={busy} onChange={event => update(index, { kind: event.target.value as ForwardKind })}>
                  {FORWARD_KINDS.map(kind => <option key={kind} value={kind}>{t(KIND_KEYS[kind])}</option>)}
                </select>
              </label>
              <label>{t(draft.kind === 'remote' ? 'connection:form.forwards.remotePort' : 'connection:form.forwards.localPort')}
                <input id={`${id}-listenPort`} inputMode="numeric" autoComplete="off" spellCheck={false} value={draft.listenPort} disabled={busy}
                  onChange={event => update(index, { listenPort: event.target.value })} />
              </label>
            </div>
            {draft.kind !== 'dynamic' && <div className="editor-auth-row">
              <label>{t('connection:form.forwards.targetHost')}
                <input id={`${id}-targetHost`} autoComplete="off" spellCheck={false} value={draft.targetHost} disabled={busy}
                  onChange={event => update(index, { targetHost: event.target.value })} />
              </label>
              <label>{t('connection:form.forwards.targetPort')}
                <input id={`${id}-targetPort`} inputMode="numeric" autoComplete="off" spellCheck={false} value={draft.targetPort} disabled={busy}
                  onChange={event => update(index, { targetPort: event.target.value })} />
              </label>
            </div>}
            <label className="editor-checkbox">
              <input id={`${id}-auto`} type="checkbox" checked={draft.auto} disabled={busy} onChange={event => update(index, { auto: event.target.checked })} />
              {t('connection:form.forwards.auto')}
            </label>
            <button className="secondary-button" type="button" disabled={busy}
              onClick={() => onChange(value.filter((_, position) => position !== index))}>{t('connection:form.forwards.remove', { index: index + 1 })}</button>
          </div>
        );
      })}
      {FORWARD_KINDS.filter(kind => kinds.has(kind)).map(kind => <p className="editor-hint" key={kind}>{t(HINT_KEYS[kind])}</p>)}
      {value.length > 0 && <p className="editor-hint">{t('connection:form.forwards.hintTabs')}</p>}
      <button className="secondary-button" type="button" disabled={busy || value.length >= MAX_FORWARDS}
        onClick={() => onChange([...value, newForwardDraft()])}>{t('connection:form.forwards.add')}</button>
    </fieldset>
  );
}

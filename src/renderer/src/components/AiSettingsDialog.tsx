import { useEffect, useId, useRef, useState } from 'react';
import type { AiProvider, AiProviderKind, AiSettings } from '../../../shared/vault/types';
import { AiProviderSchema } from '../../../shared/vault/schema';
import { AI_PROVIDER_KINDS } from '../../../shared/ai';
import { useNativeSurfaceBlock } from '../native-surface';
import { errorText } from '../error-text';
import { t, useT } from '../i18n';
import '../assistant-ui.css';

interface AiSettingsDialogProps {
  settings: AiSettings | undefined;
  busy: boolean;
  onSave: (settings: AiSettings) => Promise<boolean>;
  onClose: () => void;
}

const kinds = Object.keys(AI_PROVIDER_KINDS) as AiProviderKind[];
const cleanError = (error: unknown): string => errorText(error);

/** Full literals, so unused keys can be found by search. */
const kindLabel = (kind: AiProviderKind): string => ({
  openai: t('assistant:providers.openai.label'),
  azure: t('assistant:providers.azure.label'),
  anthropic: t('assistant:providers.anthropic.label'),
  gemini: t('assistant:providers.gemini.label'),
})[kind];
const kindHint = (kind: AiProviderKind): string => ({
  openai: t('assistant:providers.openai.hint'),
  azure: t('assistant:providers.azure.hint'),
  anthropic: t('assistant:providers.anthropic.hint'),
  gemini: t('assistant:providers.gemini.hint'),
})[kind];

function newProvider(kind: AiProviderKind): AiProvider {
  const defaults = AI_PROVIDER_KINDS[kind];
  return { id: crypto.randomUUID(), name: kindLabel(kind), kind, model: defaults.model, ...(defaults.baseUrl ? { baseUrl: defaults.baseUrl } : {}) };
}

/** Providers for the assistant: OpenAI-compatible, Azure AI Foundry, Anthropic and Gemini. Keys are saved in the vault. */
export function AiSettingsDialog({ settings, busy, onSave, onClose }: AiSettingsDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<AiProvider | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const providers = settings?.providers ?? [];
  const defaultId = settings?.defaultProviderId ?? providers[0]?.id;

  const save = async (next: AiSettings): Promise<boolean> => {
    const saved = await onSave(next);
    if (!saved) setMessage({ ok: false, text: t('assistant:settings.saveFailed') });
    return saved;
  };
  const validDraft = (): AiProvider | null => {
    if (!draft) return null;
    const cleaned: AiProvider = { ...draft, name: draft.name.trim(), model: draft.model.trim(),
      ...(draft.apiKey?.trim() ? { apiKey: draft.apiKey.trim() } : { apiKey: undefined }),
      ...(draft.baseUrl?.trim() ? { baseUrl: draft.baseUrl.trim() } : { baseUrl: undefined }),
      ...(draft.apiVersion?.trim() ? { apiVersion: draft.apiVersion.trim() } : { apiVersion: undefined }) };
    const result = AiProviderSchema.safeParse(cleaned);
    if (!result.success) { setMessage({ ok: false, text: t('assistant:settings.invalid') }); return null; }
    if (cleaned.kind === 'azure' && !cleaned.baseUrl) { setMessage({ ok: false, text: t('assistant:settings.azureEndpointMissing') }); return null; }
    return result.data;
  };
  const field = (label: string, key: 'name' | 'model' | 'baseUrl' | 'apiVersion' | 'apiKey', hint?: string) => draft && <label className="ai-field">
    <span>{label}</span>
    <span className="ai-field-input">
      <input type={key === 'apiKey' && !showKey ? 'password' : 'text'} value={draft[key] ?? ''} spellCheck={false} autoComplete="off" disabled={busy}
        onChange={event => { setDraft({ ...draft, [key]: event.target.value }); setMessage(null); }} />
      {key === 'apiKey' && <button type="button" className="secondary-button" onClick={() => setShowKey(value => !value)}>{showKey ? t('assistant:settings.hide') : t('assistant:settings.show')}</button>}
    </span>
    {hint && <small>{hint}</small>}
  </label>;

  return (
    <dialog ref={dialogRef} className="confirm-dialog ai-settings-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <h2 id={`${id}-title`}>{t('assistant:settings.title')}</h2>
      <p className="ai-intro">{t('assistant:settings.intro')}</p>
      {!draft && <>
        {providers.length ? <ul className="ai-provider-list">
          {providers.map(provider => <li key={provider.id}>
            <div><strong>{provider.name}</strong><small>{kindLabel(provider.kind)} · {provider.model}{provider.id === defaultId ? ` · ${t('assistant:settings.default')}` : ''}</small></div>
            {provider.id !== defaultId && <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void save({ providers, defaultProviderId: provider.id })}>{t('assistant:settings.makeDefault')}</button>}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setDraft({ ...provider }); setMessage(null); }}>{t('assistant:settings.edit')}</button>
            <button type="button" className="danger-button" disabled={busy} onClick={() => {
              const rest = providers.filter(item => item.id !== provider.id);
              void save({ providers: rest, ...(defaultId && defaultId !== provider.id ? { defaultProviderId: defaultId } : rest[0] ? { defaultProviderId: rest[0].id } : {}) });
            }}>{t('assistant:settings.remove')}</button>
          </li>)}
        </ul> : <p className="ai-intro">{t('assistant:settings.none')}</p>}
        <div className="ai-add">
          <span>{t('assistant:settings.addNew')}</span>
          {kinds.map(kind => <button key={kind} type="button" className="secondary-button" disabled={busy || providers.length >= 20}
            onClick={() => { setDraft(newProvider(kind)); setMessage(null); setShowKey(false); }}>{kindLabel(kind)}</button>)}
        </div>
      </>}
      {draft && <form className="ai-form" onSubmit={event => {
        event.preventDefault();
        const provider = validDraft();
        if (!provider) return;
        const exists = providers.some(item => item.id === provider.id);
        void save({ providers: exists ? providers.map(item => item.id === provider.id ? provider : item) : [...providers, provider],
          defaultProviderId: defaultId ?? provider.id }).then(saved => { if (saved) setDraft(null); });
      }}>
        <p className="ai-intro"><strong>{kindLabel(draft.kind)}</strong> · {kindHint(draft.kind)}</p>
        {field(t('assistant:settings.displayName'), 'name')}
        {field(draft.kind === 'azure' ? t('assistant:settings.deploymentName') : t('assistant:settings.model'), 'model', draft.kind === 'azure' ? t('assistant:settings.deploymentHint') : undefined)}
        {(draft.kind === 'openai' || draft.kind === 'azure') && field(draft.kind === 'azure' ? t('assistant:settings.endpoint') : t('assistant:settings.baseUrl'), 'baseUrl',
          draft.kind === 'azure' ? t('assistant:settings.endpointHint') : undefined)}
        {draft.kind === 'azure' && field(t('assistant:settings.apiVersion'), 'apiVersion', t('assistant:settings.apiVersionHint'))}
        {field(draft.kind === 'openai' ? t('assistant:settings.apiKeyLocal') : t('assistant:settings.apiKey'), 'apiKey')}
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={busy || testing} onClick={() => setDraft(null)}>{t('assistant:settings.back')}</button>
          <button type="button" className="secondary-button" disabled={busy || testing} onClick={() => {
            const provider = validDraft();
            if (!provider) return;
            setTesting(true); setMessage(null);
            void window.desktopApi.aiTest(provider).then(answer => setMessage({ ok: true, text: answer ? t('assistant:test.ok', { answer }) : t('assistant:test.emptyAnswer') }))
              .catch(error => setMessage({ ok: false, text: cleanError(error) })).finally(() => setTesting(false));
          }}>{testing ? t('assistant:settings.testing') : t('assistant:settings.testButton')}</button>
          <button type="submit" className="primary-button" disabled={busy || testing}>{t('assistant:settings.save')}</button>
        </div>
      </form>}
      {message && <p className={message.ok ? 'ai-ok' : 'field-error'} role="status">{message.text}</p>}
      {!draft && <div className="form-actions"><button type="button" className="primary-button" disabled={busy} onClick={onClose}>{t('assistant:settings.done')}</button></div>}
    </dialog>
  );
}

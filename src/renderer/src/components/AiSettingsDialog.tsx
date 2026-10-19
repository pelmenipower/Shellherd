import { useEffect, useId, useRef, useState } from 'react';
import type { AiProvider, AiProviderKind, AiSettings } from '../../../shared/vault/types';
import { AiProviderSchema } from '../../../shared/vault/schema';
import { AI_PROVIDER_KINDS } from '../../../shared/ai';
import { useNativeSurfaceBlock } from '../native-surface';
import '../assistant-ui.css';

interface AiSettingsDialogProps {
  settings: AiSettings | undefined;
  busy: boolean;
  onSave: (settings: AiSettings) => Promise<boolean>;
  onClose: () => void;
}

const kinds = Object.keys(AI_PROVIDER_KINDS) as AiProviderKind[];
const cleanError = (error: unknown): string => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Der Test ist fehlgeschlagen.';

function newProvider(kind: AiProviderKind): AiProvider {
  const defaults = AI_PROVIDER_KINDS[kind];
  return { id: crypto.randomUUID(), name: defaults.label, kind, model: defaults.model, ...(defaults.baseUrl ? { baseUrl: defaults.baseUrl } : {}) };
}

/** Providers for the assistant: OpenAI-compatible, Azure AI Foundry, Anthropic and Gemini. Keys are saved in the vault. */
export function AiSettingsDialog({ settings, busy, onSave, onClose }: AiSettingsDialogProps) {
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
    if (!saved) setMessage({ ok: false, text: 'Speichern fehlgeschlagen.' });
    return saved;
  };
  const validDraft = (): AiProvider | null => {
    if (!draft) return null;
    const cleaned: AiProvider = { ...draft, name: draft.name.trim(), model: draft.model.trim(),
      ...(draft.apiKey?.trim() ? { apiKey: draft.apiKey.trim() } : { apiKey: undefined }),
      ...(draft.baseUrl?.trim() ? { baseUrl: draft.baseUrl.trim() } : { baseUrl: undefined }),
      ...(draft.apiVersion?.trim() ? { apiVersion: draft.apiVersion.trim() } : { apiVersion: undefined }) };
    const result = AiProviderSchema.safeParse(cleaned);
    if (!result.success) { setMessage({ ok: false, text: 'Prüfe Name, Modell und URL (mit https:// oder http://).' }); return null; }
    if (cleaned.kind === 'azure' && !cleaned.baseUrl) { setMessage({ ok: false, text: 'Für Azure brauchst du den Endpoint der Ressource.' }); return null; }
    return result.data;
  };
  const field = (label: string, key: 'name' | 'model' | 'baseUrl' | 'apiVersion' | 'apiKey', hint?: string) => draft && <label className="ai-field">
    <span>{label}</span>
    <span className="ai-field-input">
      <input type={key === 'apiKey' && !showKey ? 'password' : 'text'} value={draft[key] ?? ''} spellCheck={false} autoComplete="off" disabled={busy}
        onChange={event => { setDraft({ ...draft, [key]: event.target.value }); setMessage(null); }} />
      {key === 'apiKey' && <button type="button" className="secondary-button" onClick={() => setShowKey(value => !value)}>{showKey ? 'Verbergen' : 'Anzeigen'}</button>}
    </span>
    {hint && <small>{hint}</small>}
  </label>;

  return (
    <dialog ref={dialogRef} className="confirm-dialog ai-settings-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <h2 id={`${id}-title`}>KI-Anbieter</h2>
      <p className="ai-intro">API-Schlüssel werden verschlüsselt im Vault gespeichert und nur vom Shellherd-Hauptprozess verwendet. Was du den Assistenten fragst, geht samt Terminalausschnitt an den gewählten Anbieter.</p>
      {!draft && <>
        {providers.length ? <ul className="ai-provider-list">
          {providers.map(provider => <li key={provider.id}>
            <div><strong>{provider.name}</strong><small>{AI_PROVIDER_KINDS[provider.kind].label} · {provider.model}{provider.id === defaultId ? ' · Standard' : ''}</small></div>
            {provider.id !== defaultId && <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void save({ providers, defaultProviderId: provider.id })}>Als Standard</button>}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { setDraft({ ...provider }); setMessage(null); }}>Bearbeiten</button>
            <button type="button" className="danger-button" disabled={busy} onClick={() => {
              const rest = providers.filter(item => item.id !== provider.id);
              void save({ providers: rest, ...(defaultId && defaultId !== provider.id ? { defaultProviderId: defaultId } : rest[0] ? { defaultProviderId: rest[0].id } : {}) });
            }}>Entfernen</button>
          </li>)}
        </ul> : <p className="ai-intro">Noch kein Anbieter eingerichtet.</p>}
        <div className="ai-add">
          <span>Neuer Anbieter:</span>
          {kinds.map(kind => <button key={kind} type="button" className="secondary-button" disabled={busy || providers.length >= 20}
            onClick={() => { setDraft(newProvider(kind)); setMessage(null); setShowKey(false); }}>{AI_PROVIDER_KINDS[kind].label}</button>)}
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
        <p className="ai-intro"><strong>{AI_PROVIDER_KINDS[draft.kind].label}</strong> · {AI_PROVIDER_KINDS[draft.kind].hint}</p>
        {field('Anzeigename', 'name')}
        {field(draft.kind === 'azure' ? 'Deployment-Name' : 'Modell', 'model', draft.kind === 'azure' ? 'z. B. das kleine Chat-Modell „minichat“ oder gpt-4o-mini.' : undefined)}
        {(draft.kind === 'openai' || draft.kind === 'azure') && field(draft.kind === 'azure' ? 'Endpoint' : 'Basis-URL', 'baseUrl',
          draft.kind === 'azure' ? 'Projekt- oder Ressourcen-URL aus dem Foundry-Portal, z. B. https://<ressource>.services.ai.azure.com/api/projects/<projekt>. Shellherd findet den passenden Aufrufweg selbst.' : undefined)}
        {draft.kind === 'azure' && field('API-Version (optional)', 'apiVersion', 'Meist leer lassen. Gilt nur für die Wege /models und /openai/deployments.')}
        {field(draft.kind === 'openai' ? 'API-Schlüssel (leer für lokale Modelle)' : 'API-Schlüssel', 'apiKey')}
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={busy || testing} onClick={() => setDraft(null)}>Zurück</button>
          <button type="button" className="secondary-button" disabled={busy || testing} onClick={() => {
            const provider = validDraft();
            if (!provider) return;
            setTesting(true); setMessage(null);
            void window.desktopApi.aiTest(provider).then(answer => setMessage({ ok: true, text: `Verbindung steht. Antwort: ${answer}` }))
              .catch(error => setMessage({ ok: false, text: cleanError(error) })).finally(() => setTesting(false));
          }}>{testing ? 'Teste …' : 'Testen'}</button>
          <button type="submit" className="primary-button" disabled={busy || testing}>Speichern</button>
        </div>
      </form>}
      {message && <p className={message.ok ? 'ai-ok' : 'field-error'} role="status">{message.text}</p>}
      {!draft && <div className="form-actions"><button type="button" className="primary-button" disabled={busy} onClick={onClose}>Fertig</button></div>}
    </dialog>
  );
}

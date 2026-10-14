import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiCatalog, AiTerminalContext } from '../../../shared/ai';
import type { TerminalTab } from '../terminal-tabs';
import { tabLabel } from '../terminal-tabs';
import { typeIntoTerminal } from '../terminal-input';
import { liveSessions } from '../session-registry';
import { historyForRequest, insertableCommand, outputMessage, parseAnswer, questionMessage } from '../assistant-chat';
import '../assistant-ui.css';

interface AssistantPanelProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onClose: () => void;
  /** Main window only: opens the provider settings. */
  onManageProviders?: () => void;
  /** Main window only: saves a suggested command as workflow. */
  onSaveWorkflow?: (command: string) => void;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  /** Sent to the model (with terminal context). */
  content: string;
  /** Shown in the panel. */
  shown: string;
  pending?: boolean;
  error?: string;
  /** Command typed into the terminal from this answer. */
  inserted?: string;
  note?: string;
}

interface Conversation {
  entries: ChatEntry[];
  /** A typed command waits for Enter; output after `line` belongs to it. */
  awaiting?: { line: number; command: string };
  output?: { command: string; text: string };
}

const PROVIDER_KEY = 'terminus.aiProvider';
const AUTO_KEY = 'terminus.aiAutoEvaluate';
const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* per-window convenience only */ } };

export function shellOf(tab: TerminalTab | undefined): AiTerminalContext['shell'] | null {
  if (!tab || tab.connection.view === 'files') return null;
  const { protocol } = tab.connection;
  return protocol === 'ssh' || protocol === 'powershell' || protocol === 'cmd' ? protocol : null;
}

/**
 * Terminal assistant: reads the focused terminal, explains, and types suggested commands into the
 * input line without pressing Enter. After the user runs a command, it can read and explain the output.
 */
export function AssistantPanel({ tabs, activeTabId, onClose, onManageProviders, onSaveWorkflow }: AssistantPanelProps) {
  const [catalog, setCatalog] = useState<AiCatalog | null>(null);
  const [providerId, setProviderId] = useState<string>(() => read(PROVIDER_KEY) ?? '');
  const [autoEvaluate, setAutoEvaluate] = useState(() => read(AUTO_KEY) !== 'off');
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [draft, setDraft] = useState('');
  const requests = useRef(new Map<string, { tabId: string; entryId: string; text: string }>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // Latest rendered conversations; handlers read history from here, not from inside state updaters.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const listRef = useRef<HTMLDivElement>(null);

  const tab = tabs.find(item => item.id === activeTabId);
  const shell = shellOf(tab);
  const conversation = (tab && conversations[tab.id]) || { entries: [] };
  const busy = conversation.entries.some(entry => entry.pending);
  const provider = catalog?.providers.find(item => item.id === providerId)
    ?? catalog?.providers.find(item => item.id === catalog.defaultProviderId) ?? catalog?.providers[0];

  useEffect(() => {
    void window.desktopApi.aiCatalog().then(setCatalog).catch(() => setCatalog({ providers: [] }));
    return window.desktopApi.onAiCatalog(setCatalog);
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [conversation.entries]);

  const update = useCallback((tabId: string, change: (current: Conversation) => Conversation): void => {
    setConversations(current => ({ ...current, [tabId]: change(current[tabId] ?? { entries: [] }) }));
  }, []);
  const updateEntry = useCallback((tabId: string, entryId: string, change: Partial<ChatEntry>): void => {
    update(tabId, current => ({ ...current, entries: current.entries.map(entry => entry.id === entryId ? { ...entry, ...change } : entry) }));
  }, [update]);

  /** Types a command into the terminal; never adds Enter. */
  const typeCommand = useCallback((tabId: string, entryId: string, command: string): void => {
    void typeIntoTerminal(tabsRef.current.find(item => item.id === tabId), command).then(result =>
      updateEntry(tabId, entryId, 'typed' in result ? { inserted: result.typed, note: undefined } : { note: result.reason }));
  }, [updateEntry]);

  const send = useCallback((tabId: string, shown: string, content: string): void => {
    const target = tabsRef.current.find(item => item.id === tabId);
    const targetShell = shellOf(target);
    if (!target || !targetShell) return;
    const requestId = crypto.randomUUID();
    const user: ChatEntry = { id: crypto.randomUUID(), role: 'user', content, shown };
    const answer: ChatEntry = { id: crypto.randomUUID(), role: 'assistant', content: '', shown: '', pending: true };
    const previous = conversationsRef.current[tabId] ?? { entries: [] };
    const history = historyForRequest([...previous.entries.filter(entry => !entry.pending && !entry.error), user]
      .map(({ role, content: text }) => ({ role, content: text })));
    update(tabId, current => ({ ...current, awaiting: undefined, output: undefined, entries: [...current.entries, user, answer] }));
    requests.current.set(requestId, { tabId, entryId: answer.id, text: '' });
    void window.desktopApi.aiAsk({ requestId, ...(provider ? { providerId: provider.id } : {}), messages: history,
      context: { shell: targetShell, target: `${target.connection.name}, ${target.connection.address}` } })
      .catch((error: Error) => {
        requests.current.delete(requestId);
        updateEntry(tabId, answer.id, { pending: false, error: error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') });
      });
  }, [provider, update, updateEntry]);

  // Streamed answers: commands are typed as soon as their block is complete.
  useEffect(() => window.desktopApi.onAiEvent(event => {
    const request = requests.current.get(event.requestId);
    if (!request) return;
    if (event.type === 'delta') {
      const before = parseAnswer(request.text).some(segment => segment.type === 'command' && segment.complete);
      request.text += event.text;
      updateEntry(request.tabId, request.entryId, { content: request.text, shown: request.text });
      const command = parseAnswer(request.text).find(segment => segment.type === 'command' && segment.complete);
      if (!before && command?.type === 'command') typeCommand(request.tabId, request.entryId, command.command);
      return;
    }
    requests.current.delete(event.requestId);
    if (event.type === 'error') { updateEntry(request.tabId, request.entryId, { pending: false, error: event.message }); return; }
    updateEntry(request.tabId, request.entryId, { pending: false });
    const command = parseAnswer(request.text).find(segment => segment.type === 'command' && segment.complete);
    const access = liveSessions.get(request.tabId)?.terminal;
    if (command?.type === 'command' && access && insertableCommand(command.command)) {
      // The echo of the typed command arrives first; output after Enter starts below it.
      setTimeout(() => update(request.tabId, current => ({ ...current, output: undefined,
        awaiting: { line: access.cursorLine(), command: insertableCommand(command.command)! } })), 400);
    }
  }), [typeCommand, update, updateEntry]);

  // Watches for the user running the typed command, then reads its output.
  const autoRef = useRef(autoEvaluate);
  autoRef.current = autoEvaluate;
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const timer = setInterval(() => {
      for (const [tabId, item] of Object.entries(conversations)) {
        const access = liveSessions.get(tabId)?.terminal;
        if (!item.awaiting || !access) continue;
        if (access.cursorLine() <= item.awaiting.line || Date.now() - access.lastOutput() < 1500) continue;
        const { command, line } = item.awaiting;
        const text = access.linesFrom(line, 300);
        if (autoRef.current) {
          update(tabId, current => ({ ...current, awaiting: undefined }));
          sendRef.current(tabId, `Ausgabe von „${command}“ erklären`, outputMessage(command, text));
        } else update(tabId, current => ({ ...current, awaiting: undefined, output: { command, text } }));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [conversations, update]);

  const submit = (): void => {
    const question = draft.trim();
    if (!question || !tab || !shell || busy) return;
    const screen = liveSessions.get(tab.id)?.terminal?.screen(120) ?? '';
    setDraft('');
    send(tab.id, question, questionMessage(question, screen));
  };
  const stop = (): void => {
    for (const [requestId, request] of requests.current) if (request.tabId === tab?.id) void window.desktopApi.aiCancel({ requestId }).catch(() => {});
  };

  const label = tab ? tabLabel(tab, tabs) : null;
  const providers = catalog?.providers ?? [];
  const entries = useMemo(() => conversation.entries, [conversation.entries]);

  return (
    <aside className="assistant-panel" aria-label="KI-Assistent">
      <header className="assistant-header">
        <strong>KI-Assistent</strong>
        {providers.length > 0 && <select aria-label="KI-Anbieter" value={provider?.id ?? ''} onChange={event => { setProviderId(event.target.value); write(PROVIDER_KEY, event.target.value); }}>
          {providers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
        </select>}
        {onManageProviders && <button type="button" className="assistant-icon" title="KI-Anbieter verwalten" aria-label="KI-Anbieter verwalten" onClick={onManageProviders}>⚙</button>}
        <button type="button" className="assistant-icon" title="Schließen (Strg+Umschalt+K)" aria-label="Assistent schließen" onClick={onClose}>×</button>
      </header>
      <p className="assistant-context">{!tab ? 'Wähle einen Terminal-Tab.' : shell ? <>Bezogen auf <strong>{label}</strong></>
        : 'Der Assistent arbeitet mit SSH-, PowerShell- und CMD-Tabs.'}</p>
      {catalog && !providers.length ? <div className="assistant-empty">
        <p>Es ist noch kein KI-Anbieter eingerichtet.</p>
        {onManageProviders ? <button type="button" className="primary-button" onClick={onManageProviders}>Anbieter einrichten</button>
          : <p>Richte im Hauptfenster einen Anbieter ein.</p>}
      </div> : <>
        <div className="assistant-messages" ref={listRef} aria-live="polite">
          {!entries.length && <div className="assistant-hint">
            <p>Frag zum Beispiel: „Warum ist der Dienst nginx nicht gestartet?“ oder „Wie viel Platz ist noch frei?“</p>
            <p>Der Assistent sieht die letzten Zeilen dieses Terminals und sendet sie mit deiner Frage an <strong>{provider?.name}</strong>. Vorgeschlagene Befehle schreibt er in die Eingabezeile, ausgeführt werden sie erst, wenn du im Terminal Enter drückst.</p>
          </div>}
          {entries.map(entry => entry.role === 'user'
            ? <div key={entry.id} className="assistant-message is-user">{entry.shown}</div>
            : <div key={entry.id} className="assistant-message is-assistant">
              {parseAnswer(entry.shown).map((segment, index) => segment.type === 'text'
                ? <p key={index}>{segment.text.trim()}</p>
                : <div key={index} className={`assistant-command${entry.inserted === insertableCommand(segment.command) ? ' is-inserted' : ''}`}>
                  <code>{segment.command}</code>
                  {segment.complete && tab && <div className="assistant-command-actions">
                    <span>{entry.inserted === insertableCommand(segment.command) ? 'In die Eingabezeile geschrieben, nicht ausgeführt' : entry.note ?? 'Vorschlag'}</span>
                    <button type="button" disabled={!insertableCommand(segment.command)} onClick={() => typeCommand(tab.id, entry.id, segment.command)}>Eintippen</button>
                    <button type="button" onClick={() => void window.desktopApi.writeClipboardText(segment.command).catch(() => {})}>Kopieren</button>
                    {onSaveWorkflow && <button type="button" title="Als Workflow speichern" onClick={() => onSaveWorkflow(segment.command)}>Als Workflow</button>}
                  </div>}
                </div>)}
              {entry.pending && <span className="assistant-typing" aria-label="Antwort wird geschrieben">…</span>}
              {entry.error && <p className="assistant-error" role="alert">{entry.error}</p>}
            </div>)}
          {conversation.awaiting && <p className="assistant-status">Prüfe den Befehl und drücke im Terminal Enter. Danach liest der Assistent die Ausgabe{autoEvaluate ? ' und erklärt sie' : ''}.</p>}
          {conversation.output && tab && <div className="assistant-status">
            <span>Ausgabe von „{conversation.output.command}“ liegt vor.</span>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => {
              const output = conversation.output!;
              update(tab.id, current => ({ ...current, output: undefined }));
              send(tab.id, `Ausgabe von „${output.command}“ erklären`, outputMessage(output.command, output.text));
            }}>Ausgabe erklären</button>
          </div>}
        </div>
        <form className="assistant-input" onSubmit={event => { event.preventDefault(); submit(); }}>
          <textarea value={draft} rows={3} disabled={!shell || !provider} placeholder={shell ? 'Frage zum Terminal … (Enter sendet, Umschalt+Enter neue Zeile)' : 'Kein Terminal ausgewählt'}
            aria-label="Frage an den Assistenten" onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }} />
          <div className="assistant-input-actions">
            <label><input type="checkbox" checked={autoEvaluate} onChange={event => { setAutoEvaluate(event.target.checked); write(AUTO_KEY, event.target.checked ? 'on' : 'off'); }} />
              Ausgabe automatisch erklären</label>
            {tab && entries.length > 0 && !busy && <button type="button" className="secondary-button" onClick={() => setConversations(current => { const next = { ...current }; delete next[tab.id]; return next; })}>Verlauf leeren</button>}
            {busy ? <button type="button" className="secondary-button" onClick={stop}>Stopp</button>
              : <button type="submit" className="primary-button" disabled={!draft.trim() || !shell || !provider}>Fragen</button>}
          </div>
        </form>
      </>}
    </aside>
  );
}

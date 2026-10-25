# KI-Maskierung – Validierung (bindend)

Urteil: **ready after corrections** (go-with-fixes). 3 Blocker (alle mit Fix), 11 Korrekturen, 6 Rulings. Dieser Anhang geht Spec `2026-10-25-ki-maskierung-design.md` und Plan vor. Was hier nicht geändert wird, gilt aus der Spec **wörtlich** (Rulings 2, Vertrag 3, Texte 3.8, Doku 5, run-app 6, Nicht-Ziele 7, Tests 10).

Geprüft gegen `127b789` (Node 24.20, TypeScript 5.9.3, zod 4.6.5). Ausgangslage: `npm run typecheck` grün. `npx vitest run` ergibt 161 Dateien und 2 488 Tests. Davon schlug 1 Test fehl, der bekannte Flake `fakes.test.mjs` „asks mfa two keyboard-interactive rounds …“, der beim erneuten Lauf grün ist.

Der Masker aus Spec 3.2 ist im Scratchpad wörtlich gelaufen (Node 24, Type-Stripping), zuerst unverändert und dann mit K1 bis K4. Die Belege unten stammen aus diesen Läufen.

## 1. Vertrag: was bindend ist

- **Kompiliert gedanklich gegen den echten Code, ohne Abweichung:** die Code-Blöcke aus Spec 3.1, 3.3, 3.4, 3.5, 3.6 und 3.7, mit K5 bis K7.
  - `AiError extends AppError` (`providers.ts:12`), `ChatRequest` exportiert (`:6`), `localeStore`, `mainTFor`, `limitError` und `codedFrom` vorhanden.
  - `this.maskers.keys().next().value!` passt mit TS 5.9 (`string | undefined` → `string`).
  - `Array.prototype.at` und `matchAll` sind in beiden tsconfigs durch ES2022 abgedeckt.
  - `exactOptionalPropertyTypes` ist aus. Damit ist `maskSecrets: undefined` in `setDraft` zulässig, wie schon `apiKey: undefined` in `AiSettingsDialog.tsx:61`.
  - `formatNumber(value: number)` ist vorhanden (`src/shared/format.ts:37`).
  - `common:truncated` ist „(gekürzt)“.
- **Spec 3.2 kompiliert, ist aber fachlich fehlerhaft:** B2, B3, K1 und K2 ersetzen Teile wörtlich.
- `AiProviderInfo` entsteht nur in `aiCatalog` (`assistant.ts:38-41`). `settings-sections.test.ts:11-12` baut `AiSettings` und nicht `AiProviderInfo`, ist also nicht betroffen. `AiAskRequest` wird außerhalb von Main nur in `AssistantPanel.tsx:121` gebaut.
- Tests werden mitgeprüft, denn `tsconfig.node.json` schließt `src/main/**/*.ts` samt `*.test.ts` ein. Ohne `conversationId` werden deshalb diese Stellen rot: `providers.test.ts:101`, `:105` und `:152` (die Zeilen mit `service.ask`/`asker.ask` und den IDs `requestId`, `'x'`, `'r1'`). `assistant.test.ts:17` bleibt grün, denn dort steht `as never`.
- **Zeilenanker der Spec.** Diese stimmen: `assistant.ts:58-73`, `:86-99`, `:23-29`; `ipc.ts:13-19`, `:33-36`; `ai.ts:20-23`; `index.ts:84`, `:86`, `:366`, `:367`, `:374`; `terminal-access.ts:30-42`, `:49-54`; `assistant-chat.ts:44-46`, `:71-73`; `AssistantPanel.tsx:115-122`, `:196-197`, `:214-221`; `AiSettingsDialog.tsx:66-75`, `:84-94`, `:101-125`; `types.ts:5-17`, `:116`, `:206`; `schema.ts:249-257`; `handbuch.md:183-185`, `:74`; `manual.md:182-184`; `demo-setup.mjs:118`, `:151`; `fakes.test.mjs:122-134`. Diese sind falsch, für die Umsetzung aber ohne Belang:
  - `providers.ts:301-303` ist in Wahrheit `:149-151`.
  - `:199-214` ist `:47-62`.
  - `:277-298` ist `:125-146`.
  - `SKILL.md:34` ist `:30`.
- **i18n (`i18n-catalog.test.ts` a bis g).** Alle Texte aus Spec 3.8 bestehen die Prüfungen: kein `...`, kein „Bitte“, kein ` …` in en-US, kein `„` in en-US, kein `“` nach Leerzeichen in de-DE. Der Platzhalter `{{amount}}` ist paritätisch, es gibt keinen `count` und keinen Plural-Key. `[SECRET_1]` ist kein i18next-Platzhalter.
  - Verwaist bleibt kein Key: `assistant.prompt.masked` und `ai.maskFailed` stehen als Literale in `assistant.ts`, und jeder `assistant:*`-Key steht als volles Literal in `AssistantPanel.tsx` oder `AiSettingsDialog.tsx`, und zwar in **derselben** Welle (V-R1).
  - Regel (g) greift bei keiner JSX-Zeile der Spec, denn nach `>` folgt immer `{`. Der neue Code enthält keine Umlaute. `.mjs`-Dateien prüft (g) nicht.
- **Design (`design-tokens.test.ts`).** `.ai-check` nutzt nur vorhandene Tokens: `--space-4`, `--space-6`, `--fs-md`, `--fs-sm`, `--color-text-muted` (`tokens.css:27`, `:51`, `:69`). R12 greift nicht. Es gibt keine Bewegung und keine harten Werte.

## 2. Blocker

### B1 – Welle 1 endet rot (verstößt gegen R-G)
Spec 4 setzt Task A in Welle 1. Danach scheitert der Typecheck an diesen Stellen, bis Welle 2 durch ist:
- `aiCatalog`, denn `masking` fehlt;
- `AssistantPanel.tsx:121` und `providers.test.ts:101/105/152`, denn `conversationId` fehlt.

**Fix (V-R1):** A wandert in Welle 2, zusammen mit allen Verbrauchern (C, H1, H2). Welle 1 enthält nur B, R, E und I1. Keiner dieser Tasks liest `shared/ai.ts` oder `AiProvider.maskSecrets`:
- B nutzt nur `Vault` und `VaultNode`.
- I1 nutzt `SecretMasker` aus B, also einen Nachbarn in derselben Welle.

`conversationId` bleibt ein Pflichtfeld. Es gibt kein vorübergehendes optionales Feld. Spec 4 Absatz 1 und Risiko 8 entfallen.

### B2 – Pflichttest „`password: <dein Passwort>` bleibt unverändert“ scheitert mit dem Vertragscode
Beleg: Der Prototyp liefert `password: [SECRET_1] Passwort>`. `valueSpan` liest den Wert ohne Anführungszeichen nur bis zum Leerzeichen, also `<dein`. Darauf passt `SKIP_VALUE` (`<[^<>]{0,64}>`) nie. Der Test aus 10.1 wäre rot, und Welle 1 endete rot.
**Fix:** K1.

### B3 – Lücke bei `stringData:` mit Blockwert (Sicherheit)
Spec, Handbuch und CHANGELOG versprechen: „Werte unter `data:` und `stringData:`“. `secretDataSpans` maskiert aber nur Zeilen mit `key: `. Ein Manifest mit Blockwert wird dadurch durchgelassen. Beispiel:

```
stringData:
  config.yaml: |
    plainline-secret-value-here
```

Dieses Format ist für Konfigurationsdateien und Zertifikate üblich. Beleg: Im Prototyp geht `plainline-secret-value-here` unverändert hinaus, und `|` selbst wird als Geheimnis gezählt.
**Fix:** K3.

## 3. Korrekturen (wörtlicher Ersatz)

### K1 – `<…>`-Hinweise werden nicht maskiert (B, `secret-mask.ts`)
In `valueSpan` direkt nach `const quote = text[at];` einfügen:
```ts
  // `<your password>`: a hint for the reader, no secret; the look-ahead is bounded, so this stays linear.
  if (quote === '<' && /^<[^<>\r\n]{0,64}>/.test(text.slice(at, at + 66))) return null;
```
Die Vorausschau ist begrenzt (66 Zeichen). `text.indexOf('>')` ist ausdrücklich verboten, denn bei `password=<` × 26 000 wäre das quadratisch. Beleg: `password=<` und `password: <aaaa ` auf 256 KiB laufen in 18 bzw. 29 ms.

### K2 – Platzhalter dürfen nie selbst ersetzt werden (B, `secret-mask.ts`)
Beleg: `mask('password=SECRET')` liefert `password=[[SECRET_1]_1]`. In einer zweiten Nachricht wird aus `token=abcdefgh and SECRET` dann `token=[[SECRET_1]_2] …`. Der bekannte Wert `SECRET` wird also **in** den Platzhaltern ersetzt. Ein Leck ist das nicht, aber die Platzhalter sind danach kaputt. Dasselbe passiert bei Vault-Literalen, die ein Teil von `[SECRET_n]` sind.
- Nach `const PLACEHOLDER = …;` einfügen:
  ```ts
  /** Splits text around placeholders; the odd parts are the placeholders themselves. */
  const PLACEHOLDER_PARTS = /(\[SECRET_\d{1,6}\])/;
  ```
- Direkt vor `/** Stable placeholders for one conversation …` einfügen:
  ```ts
  /** Every occurrence of `value` outside the placeholders already in `text`, so a found value never breaks a placeholder. */
  function replaceOutside(text: string, value: string, placeholder: string): string {
    return text.split(PLACEHOLDER_PARTS).map((part, index) => (index % 2 === 1 ? part : part.split(value).join(placeholder))).join('');
  }
  ```
- `mask` wird vollständig ersetzt durch (enthält K4):
  ```ts
    mask(text: string, literals: readonly string[]): MaskResult {
      const used = new Set<number>();
      let current = text;
      for (const literal of literals) if (current.includes(literal)) current = replaceOutside(current, literal, this.placeholder(literal, used));
      let out = '';
      let from = 0;
      for (const span of findSpans(current)) {
        const value = current.slice(span.start, span.end);
        if (PLACEHOLDER.test(value)) continue;
        out += current.slice(from, span.start) + this.placeholder(value, used);
        from = span.end;
      }
      let result = out + current.slice(from);
      const known = [...this.numbers.keys()].filter(value => value.length >= MIN_LITERAL_LENGTH).slice(-MAX_KNOWN).sort((a, b) => b.length - a.length);
      for (const value of known) if (result.includes(value)) result = replaceOutside(result, value, this.placeholder(value, used));
      return { text: result, numbers: used };
    }
  ```
  Der JSDoc-Kommentar über `mask` bleibt wie in der Spec.

### K3 – `data:`/`stringData:`-Block vollständig (B, `secret-mask.ts`)
In `secretDataSpans` wird der `else`-Zweig ersetzt durch:
```ts
    else {
      const colon = body.indexOf(': ');
      // `key: value` → the value; a line inside a `|` block (neither `key: ` nor `key:`) → the whole line.
      const from = colon > 0 ? indent + colon + 2 : body.endsWith(':') ? -1 : indent;
      const span = from >= 0 ? trimmed(text, position + from, position + content.length) : null;
      if (span && !SKIP_VALUE.test(text.slice(span.start, span.end))) spans.push(span);
    }
```
Beleg: Der Blockfall aus B3 ergibt `config.yaml: |` und darunter `[SECRET_1]`/`[SECRET_2]`. `|` bleibt stehen.

### K4 – Der Durchgang über bekannte Werte ist gedeckelt (B, `secret-mask.ts`, Sicherheit/Verfügbarkeit)
Spec-Risiko 9 unterschätzt den Aufwand. Der Durchgang kostet O(Zahl der bekannten Werte × Textlänge) und läuft **synchron im Main-Prozess**, blockiert also alle Fenster. Beleg: Eine Antwort mit 20 000 verschiedenen `pwd=…`-Werten auf 256 KiB braucht 470 ms. Mit jeder weiteren Runde derselben Unterhaltung wächst die Liste. Fremdbestimmte Terminalausgabe mit automatischem Einordnen friert Main nach etwa 10 Runden für mehrere Sekunden je Anfrage ein.
- Nach `const MAX_VALUE = 4096;` einfügen:
  ```ts
  /** Earlier finds searched in every later text of a conversation; the newest win, so a flood of finds cannot stall main. */
  const MAX_KNOWN = 1000;
  ```
- Die Nutzung steht in K2 (`.slice(-MAX_KNOWN)`).

Vault-Literale fallen nicht unter die Grenze, denn sie kommen bei jeder Anfrage neu als `literals`. Beleg: Mit Deckel brauchen 12 Runden × 20 000 Funde höchstens 230 ms je Runde.

### K5 – Import in `assistant.ts` (C)
Statt zwei Importzeilen aus `./providers` gilt genau eine:
```ts
import { AiError, streamChat, type ChatRequest } from './providers';
```

### K6 – Panel: genaue Stellen (H1)
- Spec 3.6 Punkt 6: Zeile `AssistantPanel.tsx:243`. Das `onClick` lautet wörtlich:
  ```tsx
  onClick={() => { conversationIds.current.delete(tab.id); setConversations(current => { const next = { ...current }; next[tab.id]?.awaiting?.mark.dispose(); delete next[tab.id]; return next; }); }}
  ```
- Punkt 1, Importzeile wörtlich:
  ```ts
  import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
  ```
  Darunter bleibt `import type { AiCatalog } from '../../../shared/ai';`. Neu dazu kommen `import { SECRET_PLACEHOLDER } from '../../../shared/ai';` und `import { formatNumber } from '../../../shared/format';`.
- Punkt 4, der `aiAsk`-Aufruf beginnt wörtlich mit `void window.desktopApi.aiAsk({ requestId, conversationId, ...(provider ? { providerId: provider.id } : {}), messages: history,`.
- Punkt 7: Die neue Zeile steht direkt nach Zeile 197 (`: t('assistant:panel.unsupportedTab')}</p>`).

### K7 – Anbieterliste (H2)
`AiSettingsDialog.tsx:86` wird wörtlich zu:
```tsx
            <div><strong>{provider.name}</strong><small>{kindLabel(provider.kind)} · {provider.model}{provider.id === defaultId ? ` · ${t('assistant:settings.default')}` : ''}{provider.maskSecrets === false ? ` · ${t('assistant:settings.maskingOff')}` : ''}</small></div>
```
Der `.ai-check`-Block steht direkt nach Zeile 116 (`{field(… 'apiKey')}`).

### K8 – KI-Fake: Laufordner anlegen, PEM-Kopf zerlegen (I1)
- Importzeile wörtlich: `import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';`
- Erste Zeile in `startAiFake`, vor `const server = …`: `mkdirSync(runDir, { recursive: true });`. Ohne Ordner wirft `appendFileSync` im `end`-Handler, und der ganze Fake-Prozess stürzt ab.
- In `DEMO_ENV` werden die beiden PEM-Zeilen ersetzt durch `join('-----BEGIN OPENSSH ', 'PRIVATE KEY-----'),` und `join('-----END OPENSSH ', 'PRIVATE KEY-----'),`, damit kein Schlüsselkopf am Stück im Repo steht (R13).
- Alles andere aus Spec 6.0 und 6.1 gilt wörtlich.

### K9 – Tests von I1 (`fakes.test.mjs`), wörtlich
- Zeile 23 wird zu: `import { AI_KEY, AI_REQUEST_LOG, DEMO_ENV, DEMO_KEPT, DEMO_SECRETS, startAiFake } from './ai-fake.mjs';`
- Nach Zeile 19: `import { SecretMasker } from '../../../src/main/ai/secret-mask';`
- `:123` wird zu `const ai = await startAiFake({ port: 0, runDir: base });`.
- Direkt nach dem Test `streams the AI fake …` und innerhalb desselben `describe.runIf`:
  ```js
  it('logs request bodies without headers and answers with the placeholder it got', async () => {
    const runDir = mkdtempSync(join(base, 'ai-log-'));
    const ai = await startAiFake({ port: 0, runDir });
    cleanup.push(() => ai.close());
    const ask = async content => {
      let out = '';
      const provider = { id: 't', name: 't', kind: 'openai', model: 'gpt-4o-mini', baseUrl: `http://127.0.0.1:${ai.port}/v1`, apiKey: AI_KEY };
      await streamChat(provider, { system: 's', messages: [{ role: 'user', content }] }, text => { out += text; }, new AbortController().signal);
      return out;
    };
    expect(await ask('Ist die Platte zu voll?')).toContain('<command>du -xh');
    const lines = readFileSync(join(runDir, AI_REQUEST_LOG), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Ist die Platte zu voll?');
    expect(lines[0]).not.toContain(AI_KEY);
    expect(await ask('Fehler mit [SECRET_3] beim Login')).toContain("PGPASSWORD='[SECRET_3]'");
  });
  ```
- Am Dateiende ein neuer Block **ohne** `runIf`:
  ```js
  describe('masking fixture of the demo server', () => {
    it('hides every synthetic secret and keeps hashes, commit ids and uuids', () => {
      const { text, numbers } = new SecretMasker().mask(DEMO_ENV, [DEMO_SECRETS.vaultApiKey, DEMO_SECRETS.vaultPassword]);
      expect(Object.entries(DEMO_SECRETS).filter(([, value]) => text.includes(value)).map(([name]) => name)).toEqual([]);
      for (const value of DEMO_KEPT) expect(text).toContain(value);
      expect(numbers.size).toBe(Object.keys(DEMO_SECRETS).length);
    });
  });
  ```
  Beleg: Der Prototyp liefert 14 Platzhalter, kein Leck und keinen Verlust.

### K10 – Pflichttests von B, R und C: festgelegte Eingaben (keine eigenen Fixtures)
**B (`secret-mask.test.ts`).** Jedes Token-Literal wird aus Teilen gebaut: `const j = (...parts: string[]): string => parts.join('');`. Das gilt für `AK`+`IA`, `gh`+`p_`, `github`+`_pat_`, `xo`+`xb-`, `sk`+`-ant-`, `sk`+`-proj-`, `AI`+`za`, `hooks`+`.slack`+`.com/services/`, `-----BEGIN`+` … PRIVATE KEY…-----` und `-----END`+` … PRIVATE KEY…-----`. Zusätzlich zu Spec 10.1 gelten diese Erwartungen (`one = (t) => new SecretMasker().mask(t, []).text`):

| Eingabe | Erwartung |
|---|---|
| jedes der Tokens `j('AK','IA','SYNTHETIC0000000')`, `j('gh','p_','a'.repeat(36))`, `j('github','_pat_','A'.repeat(22))`, `j('xo','xb-','0000000000')`, `j('sk','-ant-','a'.repeat(20))`, `j('sk','-proj-','a'.repeat(20))`, `j('AI','za','a'.repeat(35))`, `j('eyJhbGciOiJIUzI1NiJ9','.','eyJzdWIiOiJkZW1vIn0','.','c2ln')`, `j('LS0tLS1CRUdJTi','A'.repeat(16))` | `one(t) === '[SECRET_1]'` und `one(\`x ${t} y\`) === 'x [SECRET_1] y'` |
| `password=SECRET` | `password=[SECRET_1]` (K2) |
| `password: <dein Passwort>` | unverändert (K1) |
| Secret-YAML `'apiVersion: v1\nkind: Secret\nmetadata:\n  name: db-auth\ndata:\n  username: YWRtaW4=\n  host: ZGIuaW50cmFuZXQ=\ntype: Opaque\n'` | `username: [SECRET_1]`, `host: [SECRET_2]`, `name: db-auth` bleibt |
| dieselbe YAML mit `kind: ConfigMap` statt `kind: Secret` | unverändert (die Schlüssel heißen bewusst nicht `password`, sonst greift die Namensregel) |
| `'kind: Secret\nstringData:\n  config.yaml: \|\n    host: db\n    plainline-secret-value-here\n'` | `'kind: Secret\nstringData:\n  config.yaml: \|\n    host: [SECRET_1]\n    [SECRET_2]\n'` (K3) |
| `${BEGIN}\nMIIEowIBAAKCAQEAabcdefgh\nQWERTYUIOPASDFGHJK\n${END}\nok` (RSA) | `${BEGIN}\n[SECRET_1]\n${END}\nok` |
| `${BEGIN}\nMIIEowIBAAKCAQEAabcdefgh\nQWERT` | `${BEGIN}\n[SECRET_1]` |
| `$ cat key\nMIIEowIBAAKCAQEAabcdefgh\nQWERTYUIOPASDFGHJK\n${END}` | `$ cat key\n[SECRET_1]\n${END}` |
| PGP: `${PGP_BEGIN}\n\nlQOYBGabcdefghijklmnop\n=abcd\n${PGP_END}` | `${PGP_BEGIN}\n\n[SECRET_1]\n${PGP_END}` |
| `vaultLiterals` (SSH-Passwort `p@ss word!` im Ordner, SFTP-Passphrase `phrase-123`, RDP `rdp-pass-1`, SSH `short`, SSH acht Leerzeichen, `ai.providers[0].apiKey = 'sk-key-123456'`) | `['p%40ss%20word!', 'sk-key-123456', 'p@ss word!', 'phrase-123', 'rdp-pass-1']` |
| Deckel: `DB_PASSWORD=first-secret-0`, danach ein Text mit 1 000 Zeilen `pwd=other-0000` … `pwd=other-0999`, danach `x first-secret-0` | Der dritte Aufruf liefert `x first-secret-0` unverändert. Mit 999 Zeilen liefert er `x [SECRET_1]` (K4). |

Laufzeittest: **ein** `it(…, 60_000)`. Zu den 26 Einheiten aus Spec 10.1 kommen diese hinzu: `password=<`, `password: <aaaa `, `'kind: Secret\nstringData:\n  a: |\n    bbbbbbbbbbbbbbbbbbbb\n'`, `password=SECRET `, `SECRET`. Jede Einheit braucht weniger als 1 000 ms. Dazu kommen zwei weitere Tests:
- Der Flutungstest, wörtlich:
  ```ts
  const masker = new SecretMasker();
  for (let turn = 0; turn < 12; turn += 1) {
    const text = Array.from({ length: 20_000 }, (_, index) => `pwd=${turn}t${String(index).padStart(6, 'x')}`).join(' ').slice(0, 262_144);
    const start = performance.now();
    masker.mask(text, []);
    expect(performance.now() - start).toBeLessThan(1000);
  }
  ```
- 1 000 Literale auf 256 KiB, unter 1 000 ms.

**R.** Die Tests stehen in den bestehenden Dateien. `rangeText` wird in `terminal-access.test.ts` mit dem vorhandenen Helfer `lines` importiert:
```ts
describe('rangeText', () => {
  it('joins wrapped rows and starts a range inside a wrapped line at its first row', () => {
    expect(rangeText(lines(['abc', false], ['def', true]), 0, 1)).toBe('abcdef');
    expect(rangeText(lines(['abc', false], ['def', true]), 1, 1)).toBe('abcdef');
  });
  it('trims only the last row of a line and drops trailing empty lines', () => {
    expect(rangeText(lines(['ab  ', false], ['cd  ', true], ['x  '], [''], ['  ']), 0, 4)).toBe('ab  cd\nx');
  });
});
```
In `assistant-chat.test.ts`:
- Im bestehenden `it('frames terminal text …')` kommt dazu: `expect(tail('l1\nl2\nl3', 4)).toBe('…\nl3');`
- Im bestehenden `it('resends long earlier turns …')` kommt dazu: `expect(compactMessage(\`${'a'.repeat(590)}\n${'b'.repeat(50)}\`)).toBe(\`${'a'.repeat(590)}\n…(gekürzt)\`);`

**C (`assistant.test.ts`).** Der bestehende Test bleibt. Der Import `../providers` wird zu `import { AiError, type ChatRequest } from './providers';`. Neu dazu kommen `import type { AiProvider } from '../../shared/vault/types';` (zusammengeführt mit dem vorhandenen `AiSettings`-Import), `import { aiCatalog } from './assistant';` (zusammengeführt) und `import { SecretMasker } from './secret-mask';`. Danach folgt wörtlich:
```ts
const CONVERSATION = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const PASSWORD = 'Synth-Pass-4711';
const aiProvider = (patch: Partial<AiProvider> = {}): AiProvider => ({ id: 'p', name: 'P', kind: 'openai', model: 'm', ...patch });

function setup(patch: Partial<AiProvider> = {}) {
  const events: AiEvent[] = [];
  const chats: ChatRequest[] = [];
  const stream = vi.fn(async (_provider: AiProvider, chat: ChatRequest, onText: (text: string) => void) => { chats.push(chat); onText('ok'); });
  const vaultAi: AiSettings = { providers: [aiProvider(patch)], defaultProviderId: 'p' };
  const service = new AssistantService({ settings: () => vaultAi, emit: (_owner, event) => events.push(event), stream, secrets: () => [PASSWORD] });
  let count = 0;
  const ask = (messages: { role: 'user' | 'assistant'; content: string }[], conversationId = CONVERSATION): string => {
    count += 1;
    const requestId = `00000000-0000-4000-8000-${String(count).padStart(12, '0')}`;
    service.ask(1, { requestId, conversationId, messages, context: { shell: 'ssh', target: 'web-01, demo@db' } });
    return requestId;
  };
  return { events, chats, stream, service, ask };
}

describe('masking before sending', () => {
  it('masks the system prompt and every message of every role', () => {
    const { chats, events, ask } = setup();
    const requestId = ask([{ role: 'user', content: `Notfall: ${PASSWORD}` }, { role: 'assistant', content: `Nutze ${PASSWORD}` }, { role: 'user', content: 'DB_PASSWORD=x9Kq2abc und weiter' }]);
    expect(JSON.stringify(chats[0])).not.toContain(PASSWORD);
    expect(JSON.stringify(chats[0])).not.toContain('x9Kq2abc');
    expect(chats[0].messages.map(message => message.content)).toEqual(['Notfall: [SECRET_1]', 'Nutze [SECRET_1]', 'DB_PASSWORD=[SECRET_2] und weiter']);
    expect(chats[0].system.split('\n')).toHaveLength(10);
    expect(events[0]).toEqual({ type: 'masked', requestId, count: 1 });
    expect(events[1]).toMatchObject({ type: 'delta', requestId });
  });

  it('reports nothing when only the history had secrets', () => {
    const { events, ask } = setup();
    ask([{ role: 'user', content: `Notfall: ${PASSWORD}` }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'ohne Geheimnis' }]);
    expect(events.some(event => event.type === 'masked')).toBe(false);
  });

  it('keeps placeholders per conversation and forgets them with the window or all sessions', () => {
    const { chats, service, ask } = setup();
    ask([{ role: 'user', content: 'DB_PASSWORD=x9Kq2abc' }]);
    ask([{ role: 'user', content: 'mysql -px9Kq2abc' }]);
    expect(chats[1].messages[0].content).toBe('mysql -p[SECRET_1]');
    ask([{ role: 'user', content: 'token=abcdefgh1' }], OTHER);
    expect(chats[2].messages[0].content).toBe('token=[SECRET_1]');
    service.cancelOwner(1);
    ask([{ role: 'user', content: 'mysql -px9Kq2abc' }]);
    expect(chats[3].messages[0].content).toBe('mysql -px9Kq2abc');
    ask([{ role: 'user', content: 'DB_PASSWORD=x9Kq2abc' }]);
    service.cancelAll();
    ask([{ role: 'user', content: 'mysql -px9Kq2abc' }]);
    expect(chats[5].messages[0].content).toBe('mysql -px9Kq2abc');
  });

  it('sends unchanged text when the user switched masking off', () => {
    const { chats, events, ask } = setup({ maskSecrets: false });
    ask([{ role: 'user', content: `Notfall: ${PASSWORD}` }]);
    expect(chats[0].messages[0].content).toBe(`Notfall: ${PASSWORD}`);
    expect(chats[0].system.split('\n')).toHaveLength(9);
    expect(events.some(event => event.type === 'masked')).toBe(false);
  });

  it('sends nothing when the masker fails', () => {
    const { events, stream, ask } = setup();
    const spy = vi.spyOn(SecretMasker.prototype, 'mask').mockImplementation(() => { throw new Error('x'); });
    try {
      expect(() => ask([{ role: 'user', content: 'hallo' }])).toThrow(expect.objectContaining({ code: 'ai.maskFailed' }));
      expect(stream).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('tells windows whether masking is on, never the key', () => {
    const catalog = aiCatalog({ providers: [aiProvider(), aiProvider({ id: 'q', maskSecrets: false, apiKey: 'synthetic-key' })] });
    expect(catalog.providers.map(provider => provider.masking)).toEqual([true, false]);
    expect(JSON.stringify(catalog)).not.toContain('synthetic-key');
  });
});
```
In `providers.test.ts` bekommen die drei `ask`-Aufrufe (`:101`, `:105`, `:152`) nach `requestId` das Feld `conversationId: '00000000-0000-4000-8000-0000000000c1',`. Sonst ändert sich dort nichts.

### K11 – Doku, Englisch und run-app (E, I2)
- **Handbuch, Abschnitt „Grenzen“:** Der erste Punkt lautet wörtlich: „Passwörter ohne erkennbaren Namen, etwa direkt hinter einer Kurzoption (`mysql -pGeheim`, `sshpass -p Geheim`, `curl -u admin:Geheim`) oder im Fließtext, solange sie nicht im Vault stehen,“. Nach dem Punkt „abgewandelte Werte …“ kommt ein neuer Punkt: „Passwörter in Adressen, die `/`, `?` oder `#` unkodiert enthalten, und Werte über 4.096 Zeichen (dann nur der Anfang),“. Im ersten Absatz wird „Ein einmal erkannter Wert bleibt im ganzen Verlauf verdeckt, auch an Stellen ohne erkennbares Muster.“ ersetzt durch: „Ein einmal erkannter Wert bleibt im ganzen Verlauf verdeckt, auch an Stellen ohne erkennbares Muster; Shellherd merkt sich dafür je Verlauf die letzten 1.000 erkannten Werte, Vault-Werte immer.“
- **CHANGELOG.en.md**, wörtlich, unter `## [0.25.0] – 2026-10-25`:
  ```
  - Security: The AI assistant masks secrets before anything goes to the provider: passwords, passphrases and API keys from the vault, private keys, `password=` and `secret:` values, passwords in addresses, Bearer and Basic headers, keys from AWS, GitHub, Slack, OpenAI, Anthropic, Google and Azure, JWTs and the data of Kubernetes secrets. The same value keeps the same placeholder in the history (`[SECRET_1]`); Shellherd never puts real values back into answers or commands.
  - New: Below the question, the assistant shows how many sensitive values were masked. Commands with a placeholder carry a hint. Masking is on for every provider, local models included, and can be switched off per provider.
  - Fixed: The assistant reads wrapped terminal lines as one line and cuts long output only at line boundaries.
  ```
- **Manual `docs/manual.md`**, wörtlich nach „AI providers“ (`:182-184`), vor `## Workflows`:
  ```
  ### Masking in the AI assistant

  Before the assistant sends anything to a provider, Shellherd replaces secrets with placeholders such as `[SECRET_1]`. This applies to your question, the terminal excerpt, read output and the history sent along. The same value always gets the same placeholder within a history, so the model can refer to it. A value recognized once stays hidden in the whole history, even where no pattern shows; for this Shellherd remembers the last 1,000 recognized values per history, vault values always. `Clear history` starts over.

  Recognized are:
  - passwords, passphrases and API keys stored in this vault (6 characters or more), wherever they appear in the text,
  - private keys (`-----BEGIN … PRIVATE KEY-----`), also cut off and base64-encoded,
  - values after names such as `password`, `DB_PASSWORD`, `secret`, `token`, `api_key`, `client_secret` or `AccountKey`, with `=` or `:` and as an option (`--password …`),
  - passwords in addresses (`postgres://app:…@db`),
  - `Authorization: Bearer …` and `Basic …`,
  - keys from AWS (`AKIA…`), GitHub (`ghp_…`, `github_pat_…`), Slack (`xox…`, webhooks), OpenAI and Anthropic (`sk-…`) and Google (`AIza…`), Azure signatures (`sig=`) and JWTs,
  - values under `data:` and `stringData:` when the text contains a Kubernetes secret (`kind: Secret`).

  Below your question, the assistant then shows “Sensitive values masked: 2”. The answer shows the placeholders unchanged. Shellherd never puts real values into answers or commands; otherwise injected terminal text could make the model write your password into a command. If a suggested command contains a placeholder, it shows “Contains masked values. Fill them in yourself before pressing Enter.”

  Masking is on for every provider, local models included, because a local endpoint may log or forward requests. It can be switched off per provider under `Manage providers` → `Edit` → `Mask secrets before sending`. The assistant then shows “Masking is off for this provider”. If a text cannot be checked, Shellherd sends nothing.

  **Limits.** Masking recognizes patterns and known values; it does not understand content. Not recognized are, for example:
  - passwords without a recognizable name, such as right after a short option (`mysql -pSecret`, `sshpass -p Secret`, `curl -u admin:Secret`) or in running text, unless they are stored in the vault,
  - vault passwords shorter than 6 characters, the vault password itself and answers to login prompts,
  - altered values: base64 or hex encoded, split up or with spaces, `;` or `&` without quotes (then only up to that character),
  - passwords in addresses that contain `/`, `?` or `#` unencoded, and values longer than 4,096 characters (then only the beginning),
  - keys without a fixed format, such as plain hex keys from Azure, unless they follow a name such as `api-key`,
  - Kubernetes secrets as JSON (`-o json`),
  - a single line longer than the excerpt sent along (6,000 or 8,000 characters); it is cut.

  Hashes, commit IDs and UUIDs stay on purpose. AI command line tools in their own tabs (Claude Code, Codex …) send by themselves and do not go through this masking. If sensitive output is on the screen, clear it (`clear`) before asking the assistant.
  ```
- **SKILL.md (I2):** Die Shot-Liste steht in `:30`, nicht in `:34`.
- **screens.mjs (I2):** Der Block `masking()` steht im Objekt `blocks` direkt nach `assistant()`.

## 4. Rulings

- **V-R1 Wellen gemäß R-G: A in Welle 2, `conversationId` bleibt Pflicht.** Die zweite Möglichkeit wäre ein vorübergehend optionales Feld. Sie bräuchte einen späteren Vertragswechsel, und ein Aufrufer könnte das Feld unbemerkt weglassen. Main würde dann alle diese Anfragen unter dem Schlüssel `…/undefined` zusammenlegen. Wird A mit allen Verbrauchern in einer Welle umgesetzt, bleibt jede Welle grün, ohne dass Code aus Folgewellen vorgezogen wird. Die Keys `assistant:settings.*` legt H1 an, H2 benutzt sie in derselben Welle, wie in Spec 4.
- **V-R2 Masker bleiben bei der Sperre erhalten (R3 bestätigt).** Während der Sperre hält der Renderer ohnehin den vollständigen Klartext: den Chatverlauf in `AssistantPanel` und den Terminalpuffer. Die Masker legen also keine neue Klasse von Daten offen (`handbuch.md:74`). Geleert werden die Masker in diesen Fällen, im Code geprüft:
  - Fenster schließen, Absturz oder Navigation: `closeOwnerSessions` → `cancelOwner` (`index.ts:80-84`).
  - Vault-Wechsel, anderer Vault, Sperre mit `disconnect`, Beenden: `onSessionChange` bzw. `closeAllSessions` → `cancelAll` (`vault/ipc.ts:130`, `:203`, `:241`; `index.ts:434`).

  Der Präfixvergleich `${ownerId}/` verwechselt Fenster 1 nicht mit 12.
- **V-R3 `Verlauf leeren` meldet sich nicht bei Main.** Der alte Masker bleibt, bis die LRU-Grenze (32) erreicht ist oder das Fenster schließt bzw. die Verbindung getrennt wird. Er hält Werte, die der Renderer selbst schon gezeigt hat. Ein eigener IPC-Kanal wäre ein neuer Angriffsweg, ohne dass er Daten schützt. Hingenommen.
- **V-R4 Deckel für bekannte Werte (K4).** Eine Flut von Funden kann einen früher gefundenen, nicht im Vault gespeicherten Wert aus dem 1 000er-Fenster drängen. Der Wert wäre dann nur noch an Stellen mit Muster verdeckt. Das ist hingenommen und steht im Handbuch (K11). Vault-Werte betrifft es nie.
- **V-R5 `secrets()` bleibt außerhalb des `try` in `prepare`.** Wirft es, etwa weil der Vault gerade gesperrt ist, geht der Fehler als `AppError` oder `ai.requestFailed` zum Renderer. Gesendet wird nichts, denn `streamChat` liegt dahinter. `settings()` wirft im gesperrten Zustand ohnehin vorher.
- **V-R6 Spec 4, Satz „Gate von Welle 1 nur für B, R, E und I1“, und Risiko 8 sind aufgehoben.** Es gilt der Gate aus Abschnitt 6.

## 5. Sicherheitsprüfung (Ergebnis)

| Frage | Ergebnis |
|---|---|
| Einziger Engpass | **Ja.** Es gibt genau zwei Aufrufer von `streamChat` (`assistant.ts:65` `ask` und `:92` `test`). `httpRequests`/`streamHttp` und `streamAnthropic` sind modulintern. `new Anthropic` kommt nur in `providers.ts:127` vor. `test()` sendet nur die festen Texte `assistant.test.system` und `assistant.test.user`. Erreichbar ist es nur aus dem Hauptfenster (`registry.requireMain`). Main hat sonst nur `fetch` in `update-check.ts:88` (GitHub-Release, ohne Inhalte). Eine Titel-Erzeugung oder Zusammenfassung gibt es nicht. Ein Grep nach `streamChat`, `httpRequests`, `Anthropic` und `fetch(` über `src/` bestätigt das. `aicli`-Tabs senden selbst und sind ausdrücklich ausgenommen (Spec 7, Handbuch). |
| Vollständigkeit | `prepare` maskiert `system` (Regeln plus `target`) und jede `messages[i].content`, unabhängig von der Rolle. Alle vier Anbieter bauen ihren Body nur aus `ChatRequest`: OpenAI und Azure aus `chat`, Gemini aus `systemInstruction` und `contents`, Anthropic aus `system` und `messages`. Der Renderer kann die Maskierung nicht abschalten. `AskSchema` ist `strict()` und hat kein Flag dafür. Ob maskiert wird, entscheidet Main aus dem Vault (`provider.maskSecrets`). |
| Fehlerfall | `prepare` läuft vor `running.set` und vor `streamChat`. Wirft `mask`, folgt `ai.maskFailed`, und es gibt weder `stream` noch ein Ereignis (Pflichttest in K10/C). `AiError` ist ein `AppError` und kommt unverändert durch `userError`. |
| ReDoS | Siehe Tabelle unten. Jede Regex ist einzeln geprüft, keine hat verschachtelte Quantoren. Die drei überlappenden Stellen sind konstant begrenzt. Gemessen im Prototyp: 26 Spec-Einheiten plus 22 eigene Einheiten auf 256 KiB, schlechtester Wert 29 ms. Der Durchgang über bekannte Werte war das einzige superlineare Teil, K4 deckelt ihn. |
| Speicher | Höchstens 32 Masker. Jeder hält gefundene Werte, je Anfrage höchstens etwa 256 KiB. Geleert wird bei Fensterende, Trennen, Vault-Wechsel und Beenden, nicht bei der Sperre (V-R2) und nicht bei `Verlauf leeren` (V-R3). Die Werte stehen nie in Logs: `secret-mask.ts` hat kein I/O, und `AiError` trägt keinen Text. |
| Rückübersetzung | Nirgends. `masked` trägt nur `count`. `delta` kommt vom Modell, das nur Platzhalter kennt. `error.detail` stammt aus der Antwort des Anbieters auf den maskierten Body (`providers.ts:110`). Die Zuordnungs-Map verlässt `SecretMasker` nicht (`private`, kein Getter). `Eintippen`, `Kopieren` und `Als Workflow` nehmen den Text des Modells. |
| Secret Scanning | Mit K8 und K10 steht kein zusammenhängendes Token-Literal in Repo-Dateien des Pakets. Prüfung vor dem Commit (Orchestrator) über die Diff: `git diff --cached -U0 \| grep -E 'ghp_[A-Za-z0-9]{36}\|github_pat_[A-Za-z0-9_]{22}\|AKIA[A-Z0-9]{16}\|xox[abposr]-[A-Za-z0-9-]{10}\|AIza[A-Za-z0-9_-]{35}\|sk-ant-[A-Za-z0-9_-]{20}\|hooks\.slack\.com/services/T\|BEGIN [A-Z ]*PRIVATE KEY'` muss leer sein. Die Spec selbst enthält bereits einen PEM-Kopf am Stück. Ohne Schlüsselrumpf löst er die Push-Erkennung nicht aus, die Spec bleibt unverändert. |
| Prompt-Injection | Ohne Rückübersetzung ist ein eingeschleuster Befehl wie `curl …?d=[SECRET_1]` wertlos. Der Hinweis „Enthält maskierte Werte …“ steht unter jedem solchen Befehl. |

**ReDoS je Regex (Spec 3.2 plus K1 und K2):**

| Regex | Form | Bewertung |
|---|---|---|
| AWS | Lookbehind, feste Präfixe, `{16}`, Lookahead | fest |
| `gh[pousr]_`, `github_pat_`, `xox…-`, `sk-`, `AIza` | Lookbehind, die Grenzklasse enthält die Wertklasse; Präfix, dann eine Klasse `{n,255}` | Ein Lauf startet nur einmal je Lauf, Arbeit ≤ 255 je Start |
| JWT | drei Klassen ohne `.`, getrennt durch `\.` | Die Trenner gehören zu keiner Klasse, also deterministisch. Je Start höchstens die Lauflänge, das ergibt O(n) gesamt. |
| base64-PEM | Lookbehind plus eine Klasse `{16,65536}` | linear |
| Slack-Webhook, `sig=`, Bearer, Basic | Lookbehind fester oder `{0,8}`-begrenzter Länge plus eine Klasse | Lookbehind O(1) je Position |
| `SECRET_NAME` | Alternativen mit `$`, angewendet auf ≤ 64 Zeichen | konstant |
| `ASSIGN`, `FLAG` | Lookbehind, Name `{0,63}`, danach Zeichen außerhalb der Namensklasse | Backtracking ≤ 64. `lastIndex = span.end` überspringt Werte. |
| `SKIP_VALUE` | verankert, Alternativen mit eigenen Präfixen, angewendet auf ≤ 4 096 Zeichen | linear |
| `SCHEME` | Lookbehind plus `{1,30}` | Die Authority wird von Hand gelesen, ≤ 1 024 Zeichen, mit Sprung |
| `PEM_EDGE` | `[A-Z0-9 ]{0,40}PRIVATE KEY`, **überlappend** | ≤ 41 × 11 Schritte, Start nur bei `-----`: konstant |
| `BASE64_LINE` | verankert, eine Klasse `{16,}` | linear je Zeile. Der Rückwärtslauf endet an der vorigen END-Zeile, also O(n) gesamt. |
| `SECRET_KIND`, `DATA_KEY` | einfach | linear |
| K1 `/^<[^<>\r\n]{0,64}>/` | auf einem Ausschnitt von 66 Zeichen | konstant |
| K2 `PLACEHOLDER_PARTS` | `\d{1,6}` | linear |

## 6. Endgültige Wellen und Tasks (exklusive Dateien)

Gate nach **jeder** Welle: `npm run typecheck` und `npx vitest run` vollständig grün. Der bekannte Flake in `fakes.test.mjs` (mfa) gilt nach einem erneuten Lauf als grün. Umsetzer schreiben nur ihre eigenen Dateien und committen nie. Innerhalb einer Welle darf ein Task den Vertrag eines Nachbarn derselben Welle benutzen.

| Welle | Task | Dateien (exklusiv) | Inhalt | Pflicht-Tests |
|---|---|---|---|---|
| 1 | **B** Masker | `src/main/ai/secret-mask.ts` (neu), `src/main/ai/secret-mask.test.ts` (neu) | Spec 3.2 mit K1, K2, K3, K4 | alle fetten aus 10.1 plus K10/B |
| 1 | **R** Renderer-Lecks | `src/renderer/src/terminal-access.ts`, `src/renderer/src/terminal-access.test.ts`, `src/renderer/src/assistant-chat.ts`, `src/renderer/src/assistant-chat.test.ts` | Spec 3.5 | K10/R |
| 1 | **E** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` (nur die Root-Version `:3` und `packages[""]` `:9` auf 0.25.0) | Spec 5 mit K11 | `version.test.ts` grün (3 Punkte je Sprache) |
| 1 | **I1** Fake und Fixture | `.claude/skills/run-app/ai-fake.mjs`, `.claude/skills/run-app/sshd.mjs`, `.claude/skills/run-app/fakes.test.mjs` | Spec 6.0, 6.1 mit K8 | K9 |
| 2 | **A** Vertrag | `src/shared/ai.ts`, `src/shared/vault/types.ts`, `src/shared/vault/schema.ts` | Spec 3.1 | keine eigenen (Typecheck) |
| 2 | **C** Service | `src/main/ai/assistant.ts`, `src/main/ai/assistant.test.ts`, `src/main/ai/providers.test.ts`, `src/main/ai/ipc.ts`, `src/shared/locales/{de-DE,en-US}/main.json`, `src/shared/locales/{de-DE,en-US}/errors/ai.json` | Spec 3.3, 3.4, 3.8 (`main`, `errors`) mit K5 | K10/C, dazu bleibt der bestehende Prompt-Test mit 9 Zeilen |
| 2 | **H1** Panel | `src/renderer/src/components/AssistantPanel.tsx`, `src/shared/locales/{de-DE,en-US}/assistant.json` | Spec 3.6 mit K6, **alle** `assistant.json`-Keys aus 3.8 (auch `settings.*` und das geänderte `settings.intro`) | keine (run-app) |
| 2 | **H2** Anbieter-Formular | `src/renderer/src/components/AiSettingsDialog.tsx`, `src/renderer/src/assistant-ui.css` | Spec 3.7 mit K7 | keine (run-app) |
| 3 | **I2** Szene | `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 6.2, 6.3 mit K11 (Lage des Blocks, Anker `:30`) | `fakes.test.mjs` bleibt grün |

- Die Keys stehen in de-DE und en-US an derselben Stelle: `assistant.prompt.masked` nach `question`, `ai.maskFailed` nach `invalidRequest`, `panel.*` nach `suggestion`, `settings.*` nach `apiKey`.
- Nach Welle 3 erledigt der Orchestrator Folgendes:
  - run-app nach Spec 6 (`assistant` und `masking`), jeden Screenshot ansehen;
  - den Grep aus Abschnitt 5 (Secret Scanning) über die Diff;
  - Release 0.25.0 nur über staging.

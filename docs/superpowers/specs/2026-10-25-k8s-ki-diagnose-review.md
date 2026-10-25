# Kubernetes: KI-Diagnose – Review (Stufe 5)

Branch `claude/feature/k8s-ki-diagnose` gegen `claude/feature/k8s-logs-rbac` (14 Commits, `1e09e06..26d6335`; `git diff HEAD -- src .claude/skills/run-app` ist leer).
Grundlage: Spec `2026-10-25-k8s-ki-diagnose-design.md`, der bindende Anhang `…-validation.md` (B1–B4, K1–K10, V1–V12) und das Ledger `.superpowers/sdd/2026-10-25-k8s-ki-diagnose/progress.md` mit Nutzer-Ruling R-0 (nur lesende Analyse). Dazu die Nutzer-Rulings des Auftrags: 1 (nur lesend, nichts ausführen) und 2 (Secrets).

**Urteil: ready after corrections.** 0 Critical, 1 Important, 3 Minor.
- **I-1:** Bei mehr als 64 KiB in den letzten 100 Logzeilen fehlen gerade die neuesten Zeilen, also meist der Absturzgrund. Der Fehler ist klein und sollte vor dem Release 0.29.0 behoben sein, denn er trifft den Hauptfall „Warum crasht das?“ bei JSON-Logs mit Stacktraces.
- **M-1 bis M-3** sind billig. M-1 (Entwurf pro Tab) beantwortet einen Ledger-Concern und sollte mit I-1 zusammen erledigt werden.
- **Ohne Befund:**
  - Verben (Ruling 1): nur `get`, `list` und `get pods/log`.
  - Kein Weg zum Eintippen, Ausführen, Kopieren oder Speichern im Cluster-Kontext, auch nicht indirekt.
  - Secrets (Ruling 2): nie gelesen, Positivliste ohne Annotations und `managedFields`, `HIDDEN_ENV`, Maskierung in Main erzwungen, vor „Analyse senden“ geht nichts hinaus.
  - kubeconfig bleibt in Main, Schema ist `.strict()`, Budget 16 000 wird eingehalten.
  - i18n, Tokens, `format.ts`, Doku und Version 0.29.0 sind in Ordnung.
  - Szene `kube-ai` arbeitet nur mit synthetischen Daten und prüft das Secret auch base64-kodiert.

**Gates:**
- `npm run typecheck`: grün (Node und Web).
- `npx vitest run`: **175 Dateien, 2 803/2 803 grün** im ersten Lauf, kein Last-Flake in `fakes.test.mjs`, darum keine Einzelwiederholung.
- Kein Cluster, kein KI-Anbieter, kein Build nach `out/`.
- Treiber nicht bedient. Gelesen wurden nur die Shots `kube-ai-preview.png` und `kube-ai-answer.png` sowie das Anfrage-Protokoll des Fakes `%TEMP%\shellherd-run\kube\kube-requests.log`: 44 Zeilen, nur `GET` und 3 × `POST …/selfsubjectrulesreviews` (Paket 10), kein `/secrets`, kein `/configmaps`.
- Proben im Scratchpad (nur Regex, kein Produktcode): `mutatingCommand` mit und ohne den Fix aus M-2 gegen alle 50 Fälle des Pflicht-Tests E.

---

## 1. Sicherheit

### 1.1 Neue Kubernetes-API-Aufrufe (Ruling 1)

Gesucht wurde in allen hinzugefügten Zeilen unter `src/` (ohne Tests). Neu ist nur `buildDiagnosis` (`diagnose.ts:330-374`) hinter `KubeSessions.diagnose` (`session.ts:646-651`) und `k8s:diagnose` (`kubernetes/ipc.ts:99-103`).

| Stelle | Aufruf | HTTP | RBAC-Verb |
|---|---|---|---|
| `diagnose.ts:334` Objekt | `api.read(ref)` → `KubernetesObjectApi.read` | `GET /api/v1/namespaces/{ns}/pods/{name}` bzw. `/apis/apps/v1/…/{deployments,statefulsets,daemonsets}/{name}`, `/apis/batch/v1/…/jobs/{name}` (+ Discovery `GET /apis/apps/v1`) | `get` |
| `diagnose.ts:337` Anlass | `api.read({ kind: 'events', … })` | `GET /api/v1/namespaces/{ns}/events/{name}` | `get` events |
| `diagnose.ts:344`, `:358`, `:368` Events | `api.eventsFor(ref)` (`client-api.ts:509-515`) | `GET /api/v1/namespaces/{ns}/events?fieldSelector=involvedObject.kind=…,name=…,namespace=…` | `list` events |
| `diagnose.ts:310` Logs | `api.readLog` → `client-api.ts:306` `readLog` → `requestLogs` | `GET …/pods/{pod}/log?container=…&follow=false&previous=false\|true&tailLines=100&limitBytes=65536&timestamps=false` | `get` pods/log |
| `diagnose.ts:346` Owner | `api.read(owner)` (aus `ownerOf`, ReplicaSet → Deployment per Name, ohne RS zu lesen) | `GET` Deployment/StatefulSet/DaemonSet/Job | `get` |
| `diagnose.ts:347` Node | `api.read({ kind: 'nodes', name })` | `GET /api/v1/nodes/{name}` | `get` nodes |
| `diagnose.ts:355` Pods des Workloads | `api.list('pods', ns, { labels })` | `GET /api/v1/namespaces/{ns}/pods?labelSelector=…` | `list` pods |

- Sonst nichts: kein `watch`, `create`, `patch`, `delete`, `exec`, `portforward`, keine `selfsubject*review`, kein `fetch`.
- Pflicht-Test D (`RecordingApi`) wirft bei jeder anderen Methode und prüft die exakte Aufrufliste (`diagnose.test.ts:112`).
- Der Ende-zu-Ende-Test (`fakes.test.mjs:201-232`) prüft über echten `createKubeApi` und TLS-Tunnel: nur `GET`, kein `/secrets|/configmaps|/replicasets`.
- **Eingang:** `KubeDiagnoseRequestSchema` (`kubernetes-schema.ts:51-53`) ist `.strict()` und lässt als Ziel nur `DIAGNOSE_KINDS` mit Namespace zu, als Anlass nur `events` mit Namespace. `buildDiagnosis` prüft dasselbe noch einmal vor jedem Aufruf (`diagnose.ts:333`, K1.4). `requireSshSender` und `viewOf` beschränken auf Views desselben Fensters. `disabled` wird abgelehnt, „Nur lesen“ ist erlaubt (`session.ts:648-650`). `requireApi` lehnt ab, solange der Cluster nicht bereit ist (`session.ts:184-187`).
- **Kein Critical.**

### 1.2 Nichts ausführen (Ruling 1), auch auf indirekten Wegen

| Weg | Ergebnis | Beleg |
|---|---|---|
| Knöpfe an Befehlen | keine | `AssistantPanel.tsx:298-303`: Zweig `textOnly` rendert nur `<span>`. `textOnly = kubeMode \|\| conversation.kube !== undefined` (`:101`, K3) hängt an der Unterhaltung, nicht nur am Tab. Die Szene zählt 0 Knöpfe und kein „Eintippen“, „Kopieren“ oder „Als Workflow“ im Panel. |
| `typeCommand` | verweigert | `:136` verweigert Cluster-Tabs **und** jede Unterhaltung mit `kube`. Aufrufer ist nur der Knopf im Nicht-`textOnly`-Zweig (`:307`). |
| Workflow | nicht erreichbar | `onSaveWorkflow` nur im Nicht-`textOnly`-Zweig (`:309`). |
| Tastatur im Panel | nur Senden der Frage | Einziger Key-Handler ist Enter im Eingabefeld (`:342`) → `submit` → `aiAsk` (V2). `<code>` ist nicht fokussierbar. Kein Kürzel tippt einen Vorschlag ein (`grep typeIntoTerminal`: nur Panel-Knopf und `WorkflowPalette`). |
| Kopieren-Knöpfe | keine | `writeClipboardText` nur im Nicht-`textOnly`-Zweig (`:308`). Markieren von Hand bleibt möglich (R6.1, gewollt). |
| Drag & Drop | wirkungslos | Markierten Text aus dem Panel auf ein xterm (auch in geteilter Ansicht) zu ziehen, schreibt nichts: xterm wertet nur `input` mit `inputType === 'insertText'` aus (`@xterm/xterm/lib/xterm.mjs`, `_inputEvent`), ein Drop kommt als `insertFromDrop`. Der Fenster-Drop in `App.tsx:290-301` nimmt nur Dateien. |
| Wechsel zu einem Terminal-Tab | Antwort nicht sichtbar | Unterhaltungen sind pro Tab (`conversations[tab.id]`, `:98`). Antworten streamen in `request.tabId` (`:179-189`). Nach dem Wechsel zeigt das Panel die Unterhaltung des Terminal-Tabs, die Kubernetes-Antwort mit ihren Befehlen ist dort nicht zu sehen und nicht erreichbar. |
| Auto-Auswertung | nicht aktiv | Das Intervall (`:197-214`) wirkt nur bei `awaiting`. Das setzt nur `typeCommand`, und das ist für Kubernetes gesperrt. |
| Links/HTML | keine | Text-Segmente als `<p>`-Text, kein `dangerouslySetInnerHTML`. |

Rest außerhalb des Pakets (Spec, Ledger): In Pod-Shell-Tabs (`shellOf` → `'ssh'`) und SSH-Tabs bleibt der Terminal-Assistent mit `Eintippen` wie bisher. Siehe M-1 für den einzigen Übergang einer Analysefrage dorthin.

### 1.3 Secrets (Ruling 2)

- **Nie gelesen:** Ziele nur `DIAGNOSE_KINDS`, Owner ohne ReplicaSet-Lesen, Anlass nur `events`. `envValue` löst `secretKeyRef`, `configMapKeyRef` und `envFrom` nie auf (`describe.ts:62-80`, `diagnose.ts:131-134`). Der Fake liefert das Secret `checkout-db` aus, im Protokoll steht kein Zugriff.
- **Kontext ohne Annotations und `managedFields`:** Positivliste in `podSummary`, `workloadSummary` und `nodeSummary` (`diagnose.ts:172-246`). `imagePullSecrets`, Probe-Header und projizierte Inhalte fehlen ebenfalls. Pflicht-Test D prüft `Synth-Annotation-*`, `managed-marker`, `last-applied` und `Synth-Pull-Secret`.
- **Literale Env-Werte mit geheimen Namen:** `HIDDEN_ENV` (`diagnose.ts:27`, wörtlich K1.1) → `<hidden>` in `envLine` (`:106-110`), für Pod, Init-Container und Pod-Template.
- **Maskierung in Main erzwungen:** `assistant.ts` `prepare`: `masking = provider.maskSecrets !== false || isKubeContext(request.context)`. `ai/ipc.ts` lässt genau die zwei Kontextformen zu (`z.union` aus zwei `.strict()`). Pflicht-Test C prüft das mit `maskSecrets: false`. Laut Ledger ist es mit einer Mutationsprobe belegt.
- **Vor „Analyse senden“ geht nichts hinaus:** `accept` (`AssistantPanel.tsx:113-119`) setzt nur die Karte und den Entwurf. `aiAsk` kommt nur aus `send`, und `submit` sendet eine Analyse nur mit `diagnosis.context` (`:222-231`). Solange der Kontext fehlt, ist der Knopf gesperrt (`:348`). Die Szene prüft ein leeres `ai-requests.jsonl` vor dem Klick.
- **Rest (benannt in Spec Risiko 2/3):** Passwörter ohne Namen in `Command`/`Args`/Freitext und personenbezogene Daten in Logs. Die Maskierung fängt Flags und Zuweisungen ab. Zu Schnitten mitten in einem Token siehe I-1 und M-3.

### 1.4 kubeconfig

`k8s:diagnose` gibt nur `{ text, parts }` zurück. `readLog` nutzt `config.applyToHTTPSOptions` in Main (`client-api.ts:311-313`). Der Text enthält weder Server-URL noch Token oder Zertifikat. Zum Renderer gehen nur `KubeDiagnosis` und `CodedError`.

## 2. Ledger-Concerns

1. **Entwurf nicht pro Tab:** bestätigt → **M-1**.
   - **Mit Kontext? Nein.** Der Kontext steht nie im Entwurf, `submit` nimmt ihn nur aus `diagnoses[tab.id]` des aktiven Tabs (`:97`, `:223`). Cluster-Daten können also in keinen anderen Tab und in keinen Shell-Assistenten gelangen.
   - **Ohne Kontext? Ja.** Die vorbefüllte oder bearbeitete Analysefrage bleibt nach einem Wechsel in einen SSH-Tab im Eingabefeld stehen. Enter oder `Fragen` schickt sie dann als Terminal-Frage, zusammen mit dem Bildschirm des SSH-Tabs.
2. **`kubectl "delete"` nicht erkannt:** bestätigt → **M-2**. Der Fix ist mit allen 50 Pflichtfällen geprüft. Die Folge ist nur ein fehlender Hinweis, kein Knopf.
3. **`<unbekannt>` → `<unknown>` in `describe.ts`:** **kein Befund.** Das steht wörtlich in R6.4. Die übrige Describe-Ausgabe ist ebenfalls englisch (`<none>` in `describe.ts:35`, `:88`, `:99`, `:134`). CLAUDE.md verbietet deutsche Literale in Main. Sichtbar ist es im Describe-Dock nur bei Env-Einträgen mit unbekannter `valueFrom`-Art.
4. **`kube-requests.log` je Start geleert:** **kein Befund.**
   - Die Szene löscht das Protokoll vor ihrem Lauf selbst (`screens.mjs`, `fs.rmSync(kubeLog)`).
   - `appendFileSync` legt es neu an.
   - `fakes.test.mjs` nutzt je Test ein eigenes Verzeichnis und trifft das Protokoll des laufenden `drive:sshd` nie.
   - Header werden nie geschrieben (Token). Das Wachstum über eine lange Sitzung ist unkritisch.

## 3. Budget (16 000 Zeichen)

- **Eingehalten:**
  - Pod: höchstens 14 800 Zeichen in Abschnitten plus Titel.
  - Workload: 12 400.
  - `assemble` kappt hart mit `headOf(…, DIAGNOSE_MAX_CHARS)` (`diagnose.ts:377`).
  - Belegt durch die Tests „stays below DIAGNOSE_MAX_CHARS with huge logs …“ und „adds up … with 1 200 characters of titles“ sowie den Fake-Lauf (1 941 Zeichen im Shot).
- **Zeilen- und Token-Grenzen:**
  - `headOf` und `tailOf` (K1) schneiden an Zeilenenden und bei einer überlangen Zeile an Leerzeichen, nie in einem Wort. Pflicht-Test „never cuts a token in half“.
  - **Aber** drei vorgelagerte Schnitte schneiden mitten durch:
    - `limitBytes` beim Log-Lesen (**I-1**);
    - Event-Meldung bei 300 Zeichen (**M-3**);
    - Logzeile bei 4 000 Zeichen in `cleanLogText` (**M-3**).
- **Rückfragen im Assistent-Budget:**
  - Die erste Nachricht ist ≤ 16 000 + Frage + rund 70 Zeichen Überschrift und Zaun, also unter 64 KiB je Nachricht (`ai/ipc.ts:14`).
  - `kubeHistory` hält Kontext und erste Antwort fest, dazu die neuesten 10. Das sind höchstens 12 Nachrichten (Grenze 40), mit abwechselnden Rollen auch beim Kürzen (geprüft für ungerade Längen).
  - Mit üblichen Antwortlängen bleibt das weit unter 256 KiB gesamt.
  - Einziger Randfall: Eine selbst getippte Frage über rund 48 KiB scheitert an der 64-KiB-Grenze mit sichtbarem Fehler. Hingenommen.
- **Gleiche Platzhalter in Rückfragen:** dieselbe `conversationId` (`AssistantPanel.tsx:166-168`), Pflicht-Test C.

## 4. i18n, Tokens, `format.ts`

- **i18n:**
  - Alle neuen UI-Texte laufen über `t()` und liegen in de-DE und en-US (`assistant.json` Block `kube`, `kubeActions.json`, `main.json` `assistant.kubePrompt`).
  - Maps bestehen aus vollen Literalen (`PROBLEM_QUESTIONS`, `PART_KEYS`, `MISSING_KEYS`, `KUBE_PROMPT_LINES`).
  - K4 ist umgesetzt (kein ` …` in en-US), der Katalogtest ist grün.
  - Die Abschnittstitel in `diagnose.ts` sind englischer Fachtext nur für die KI (R2.1, R9). Sie sind kein UI-Text.
  - Die Doku-Begriffe stimmen mit den Locale-Texten überein: „Mit KI analysieren“, „Analysieren“, „Analyse senden“, „Verwerfen“, „Gesendeten Text anzeigen“ und der Ändert-Satz wörtlich.
- **Tokens:**
  - Alle Werte stehen als `var(--…)`. Neu genutzt werden `--color-warn` und `--color-warn-border`, beide vorhanden.
  - `max-height: 240px` ist Geometrie (V6). `line-height: 1.5` folgt den Nachbarregeln in `assistant-ui.css:14`, `:16`.
  - Keine Bewegung, also kein Eintrag im Motion-Gate. `design-tokens.test.ts` ist grün.
- **`format.ts`:**
  - Zahlen in der Vorschau und den Hinweisen laufen über `formatNumber` (`kube-diagnose.ts:106`, `AssistantPanel.tsx:287-291`, `:322`).
  - Sortierung in Main per `<`/`>` (`compare`) und Zeitstempel als Zahl, kein `localeCompare` und kein `Intl`.
  - Datumsfelder gehen als ISO 8601 hinaus (`str`, K1.2).

## 5. Szene `kube-ai`

- **Nur synthetisch:** Demo-Vault `prod-k8s` → lokaler Kubernetes-Fake über den SSH-Fake. Der KI-Fake läuft auf 127.0.0.1. `KUBE_SECRETS` ist synthetisch und für Secret-Scanner zerlegt (`kube-fixtures.mjs:219-227`).
- **Secret auch base64:** Für alle vier synthetischen Werte prüft `screens.mjs` `body.includes(value) || body.includes(base64(value))` im rohen KI-Protokoll. Das Secret im Fake ist genau `base64(secretValue)`, ein Leck dieses Felds würde also erkannt.
  - Die Prüfung läuft hinter der Maskierung. Ein gelesenes und dann maskiertes Secret fiele hier nicht auf.
  - Das fängt die zweite Prüfung ab: kein `/secrets` und kein `/configmaps` im Anfrage-Protokoll, keine Nicht-GET-Anfrage außer der Rechte-Vorabprüfung.
  - Zusammen ist das ausreichend.
- **Weitere Prüfungen der Szene:**
  - leeres KI-Protokoll vor dem Senden;
  - 0 Knöpfe;
  - `rollout restart` als ändernd markiert, `get endpoints` nicht;
  - „Vertrauliche Werte maskiert: 2“;
  - `previous=true` wurde gelesen.
- **Shots:**
  - `kube-ai-preview.png`: Karte mit Produktionszeile, 6 Teilen, „Zusammen 1.941 Zeichen, etwa 486 Tokens, an Demo-KI.“, Frage vorbefüllt, `Analyse senden`.
  - `kube-ai-answer.png`: zwei Befehle ohne Knopf, der ändernde in Warnfarbe mit Satz.
- **Nicht abgedeckt:** Event-Einstieg, Knopf `Analysieren` im Banner, Tab-Wechsel. Siehe manuelle Tests. Für M-1 schlage ich eine Szenen-Prüfung vor.

---

## 6. Befunde

### Critical

Keine.

### Important

**I-1 – Bei mehr als 64 KiB in den letzten 100 Zeilen fehlen die neuesten Logzeilen, und die letzte Zeile wird mitten durchgeschnitten.**
- **Datei:**
  - `src/main/kubernetes/diagnose.ts:305-315` (`readLogSection`, ein Lesevorgang mit `tailLines: 100, limitBytes: 65 536`) und `:20`;
  - `src/main/kubernetes/client-api.ts:322-324` (Abbruch und `subarray` bei `limitBytes`).
  - Eigentümer: `diagnose.ts` und `diagnose.test.ts`. `client-api.ts` bleibt unverändert.
- **Ursache:**
  - Der API-Server wendet `limitBytes` ab der **ersten** ausgewählten Zeile an: „the number of bytes to read from the server before terminating the log output“. Er beginnt bei Zeile −100 und hört nach 64 KiB auf.
  - `readLog` schneidet zusätzlich an genau dieser Grenze.
  - `tailOf` hält danach das Ende **dieses Ausschnitts**, nicht das Ende des Logs.
- **Fehlerszenario:**
  - Eine Java-App loggt JSON, jede Zeile mit `stack_trace` hat 2 bis 20 KB.
  - Sie stürzt ab, und die letzten 100 Zeilen des vorherigen Containers haben 300 KB. Gelesen werden etwa die Zeilen −100 bis −85.
  - Die FATAL-Zeile mit dem Grund fehlt. Titel und Vorschau sagen trotzdem „last 100 lines“, und die KI rät auf Basis alter Zeilen.
  - Die letzte gelieferte Zeile endet mitten in einem Wort. Steht dort ein Token, geht die erste Hälfte an der Maskierung vorbei. Das widerspricht R3.1 „kein Geheimnis halbiert“, der Begründung von K1.
- **Fix** in `diagnose.ts`. `readLog`/`KubeApi` bleiben unverändert, nur `get pods/log`:

  ```ts
  /** Tails tried in turn: the API applies limitBytes from the first tailed line, so a tail over the limit would lose the newest lines. */
  const LOG_TAILS = [DIAGNOSE_LOG_LINES, 20, 5, 1] as const;

  /** The newest lines that fit into DIAGNOSE_LOG_BYTES, and how many were asked for. Never ends inside a cut line. */
  async function readTail(api: KubeApi, target: LogReadTarget, previous: boolean): Promise<{ raw: string; lines: number }> {
    let raw = '';
    for (const lines of LOG_TAILS) {
      raw = await api.readLog(target, { previous, tailLines: lines, limitBytes: DIAGNOSE_LOG_BYTES });
      // A cut multi-byte character decodes to U+FFFD (3 bytes), so a cut body is never shorter than the limit.
      if (Buffer.byteLength(raw) < DIAGNOSE_LOG_BYTES) return { raw, lines };
    }
    // Even the last line is longer than the limit: keep whole words only, a cut token could slip past the masker.
    const space = raw.search(/\s\S*$/);
    return { raw: space > 0 ? `${raw.slice(0, space)}\n` : '', lines: 1 };
  }
  ```

  - `readLogSection` ruft `readTail`.
  - Der Titel nutzt `last ${lines} lines` statt `DIAGNOSE_LOG_LINES`.
  - Ein Fehler des ersten Lesens geht weiter in `missing`, wie bisher.
  - `LogReadTarget` wird aus `./api` importiert.
- **Test** (`diagnose.test.ts`, `describe('buildDiagnosis')`):

  ```ts
  it('reads a shorter tail when the last 100 lines exceed the byte limit, so the newest line is kept', async () => {
    const api = setup(crashPod());
    api.logs = (_target, options) => options.tailLines === DIAGNOSE_LOG_LINES
      ? `${'old line '.repeat(8000)}`.slice(0, DIAGNOSE_LOG_BYTES)
      : 'FATAL newest crash line\n';
    const result = await buildDiagnosis(api, POD);
    expect(result.text).toContain('FATAL newest crash line');
    expect(result.text).toContain('last 20 lines');
    expect(result.text).not.toContain('old line');
  });
  ```

  `DIAGNOSE_LOG_BYTES` und `DIAGNOSE_LOG_LINES` kommen dazu in den Import. Bestehende Aufruflisten bleiben gleich, weil ihre Logs klein sind. Die Handbücher („die letzten 100 Logzeilen“) können bleiben, denn das ist die Obergrenze.

### Minor

**M-1 – Der Entwurf ist nicht pro Tab. Eine Analysefrage kann nach einem Tab-Wechsel als Terminal-Frage hinausgehen, ohne Cluster-Kontext.**
- **Datei:** `src/renderer/src/components/AssistantPanel.tsx:83` (`draft` global), `:115` (`accept`), `:219-245`, `:339-342`. Eigentümer: `AssistantPanel.tsx`, Szene in `.claude/skills/run-app/screens.mjs`.
- **Fehlerszenario:**
  - `Mit KI analysieren` im Cluster-Tab füllt „Warum startet dieser Pod immer wieder neu?“ vor.
  - Der Nutzer klickt auf einen SSH-Tab. Die Frage steht dort weiter im Feld, der Knopf heißt `Fragen`.
  - Mit Enter geht sie zusammen mit dem Bildschirm des SSH-Tabs an den Terminal-Assistenten. Dessen Antwort kann `kubectl delete …` mit `Eintippen` anbieten (Klick nötig, kein Enter).
  - Umgekehrt landet ein im SSH-Tab getippter Text nach dem Zurückwechseln als Analysefrage vor `Analyse senden`.
  - Cluster-Daten gehen nie mit (siehe 2.1). Darum ist das Minor.
- **Fix:**

  ```tsx
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = (tab && drafts[tab.id]) || '';
  const setDraft = (value: string): void => { if (tab) setDrafts(current => ({ ...current, [tab.id]: value })); };
  ```

  In `accept` wird `setDraft(diagnoseQuestion(request.target))` zu `setDrafts(current => ({ ...current, [request.tabId]: diagnoseQuestion(request.target) }))`. Die übrigen `setDraft`-Aufrufe (`submit`, `discard`, `onChange`) bleiben, weil sie den aktiven Tab meinen.
- **Prüfung** (keine Komponententests im Projekt, 10.8): In `kube-ai` vor dem Cluster `web-01` öffnen. Nach dem Vorschau-Shot den Tab `web-01` anklicken und prüfen, dass `textarea.value === ''` gilt und `sent()` leer ist. Zurück im Cluster-Tab muss die Frage wieder dastehen.

**M-2 – `mutatingCommand` erkennt ein Verb in Anführungszeichen nicht (`kubectl "delete" pod x`).**
- **Datei:** `src/renderer/src/kube-diagnose.ts:70`. Eigentümer: `kube-diagnose.ts`, `kube-diagnose.test.ts`.
- **Ursache:** `MUTATING_KUBECTL` verlangt `\s` direkt vor dem Verb. Bei `"delete"` und `'delete'` steht dort ein Anführungszeichen.
- **Fehlerszenario:**
  - Die KI schreibt `kubectl -n shop "delete" pod x`.
  - Statt „Ändert den Cluster …“ steht dort „Vorschlag zum Nachprüfen …“.
  - Es gibt keinen Knopf, also nur einen fehlenden Hinweis.
- **Fix:** Anführungszeichen vor der `can-i`-Regel durch Leerzeichen ersetzen:

  ```ts
  return command.replace(/\\\r?\n/g, ' ').split(/[;&|\n]/).map(part => part.replace(/["'`]/g, ' ').replace(/\bauth\s+can-i\s+\S+/gi, 'auth can-i'))
  ```

  - Im Scratchpad geprüft: Alle 36 ändernden und 14 lesenden Pflichtfälle bleiben richtig. `kubectl "delete" pod x`, `kubectl 'delete' pod x` und `kubectl -n shop "delete" pod x` werden `true`, `kubectl auth can-i "delete" pods` bleibt `false`.
  - Diese vier Fälle kommen in die Listen von Test E.
  - Weiter nicht erkannt und als V8-artiger Rest hingenommen, weil es nur ein Hinweis ist: `curl -X DELETE https://…/api/…`, `etcdctl del …`, `kubeadm reset`.

**M-3 – Zwei vorgelagerte Kürzungen schneiden mitten in einem Wort: Event-Meldung bei 300, Logzeile bei 4 000 Zeichen.**
- **Datei:** `src/main/kubernetes/diagnose.ts:257` (`message.slice(0, EVENT_MESSAGE_CHARS)`) und `:266` (`cleanLogText`, `workload-logs.ts:49`, schneidet bei `MAX_LINE_CHARS`). Eigentümer: `diagnose.ts`, `diagnose.test.ts`. `workload-logs.ts` bleibt unverändert, weil die Log-Ansicht anderen Regeln folgt.
- **Fehlerszenario:**
  - Eine Event-Meldung oder eine sehr lange Logzeile enthält an der Schnittstelle ein Token.
  - Die erste Hälfte geht ungemaskt hinaus, etwa ein JWT ohne Signatur. Das ist derselbe Mechanismus, den K1 für `headOf`/`tailOf` geschlossen hat.
  - Das ist selten, und ein halbes Token ist meist kein gültiges Geheimnis, darum Minor.
- **Fix:** eine Hilfsfunktion in `diagnose.ts`, an beiden Stellen genutzt:

  ```ts
  /** Cuts one line at a space before `max` and marks the cut; never inside a token. */
  const wordCut = (line: string, max: number): string => {
    if (line.length <= max) return line;
    const space = line.slice(0, max).search(/\s\S*$/);
    return `${space > 0 ? line.slice(0, space) : ''}…`;
  };
  ```

  - `eventLines`: `const short = wordCut(message, EVENT_MESSAGE_CHARS);`.
  - `logText`: `lines.map(line => wordCut(cleanLogText(formatLogLine(line.replace(/\r$/, ''))), MAX_LINE_CHARS))`, dazu `MAX_LINE_CHARS` aus `./workload-logs` importieren. Eine von `cleanLogText` gekürzte Zeile hat `MAX_LINE_CHARS + 1` Zeichen und wird damit an einem Leerzeichen neu geschnitten.
  - Test: `wordCut(`a Bearer ${'t'.repeat(400)}`, 300)` ergibt `'a Bearer…'`. `eventLines` mit einer Meldung aus 299 Zeichen und einem Token dahinter enthält keinen Teil des Tokens. Der bestehende Test „…keeping the newest event“ (`m199 yyy…`) bleibt grün, er erwartet nur `m199`.

---

## 7. Spec-Abdeckung

| Ruling/Korrektur | Stand | Beleg |
|---|---|---|
| R1.1 Menüs (Pod, Workloads, Job, Event, Pod-Problem) | erfüllt | `kube-menus.ts:224`, `:252`, `:280`, `:405-406`, `:491`; K6-Listen in `kube-menus.test.ts` |
| R1.2 Knopf `Analysieren` im Banner (einzeln und Liste, nicht bei Node) | erfüllt | `ProblemBanner.tsx:23-25`, `:31`, `:47`; nur bei `ready` (`ClusterView.tsx:399-400`) |
| R1.3 Sperren mit Grund, „Nur lesen“ erlaubt | erfüllt | `analyzeItem` (`connectedReason`, `analyzeUnsupported`), Event auf fremde Art → `involvedReason` (V11) |
| R1.4 Nicht in Stufe 1 | eingehalten | Node, Service, Ingress und CronJob ohne Eintrag (K6 „unverändert“) |
| R2 Inhalt, Positivliste, nie mitgehende Teile | erfüllt | `diagnose.ts:172-246`, Pflicht-Test D |
| R2.5 Weiches Scheitern | erfüllt | `guarded`/`missing`, 400 → `none`, 403 → `forbidden`; Objekt selbst → Fehler |
| R3 Budgets, 16 000 gesamt | erfüllt, mit I-1/M-3 | siehe 3 |
| R4 Ablauf, Karte, neue Unterhaltung, `kubeHistory`, gesperrte Eingabe | erfüllt, mit M-1 | `AssistantPanel.tsx:111-123`, `:147-175`, `:315-327`, `:339-340` |
| R5 Aufrufe und Verben | erfüllt | 1.1 |
| R6.1 Keine Knöpfe, `typeCommand` verweigert | erfüllt (K3) | 1.2 |
| R6.2 `mutatingCommand` | erfüllt (K2), mit M-2 | Test E |
| R6.3 `HIDDEN_ENV` | erfüllt (K1.1) | `diagnose.ts:27` |
| R6.4 `envValue` exportiert, `<unknown>` | erfüllt | `describe.ts:62`, `:79` |
| R6.5 Maskierung immer an, Hinweis | erfüllt | `assistant.ts` `prepare`; `AssistantPanel.tsx:273` |
| R6.6 Prompt-Injection | gemildert wie spezifiziert | Prompt `data`, Überschrift, Zaun mit `'''` |
| R7 Prompt, Kontexttyp, Terminal-Prompt unverändert | erfüllt | `assistant.ts`, `ai/ipc.ts`, Test C (9/8/7 Zeilen, < 1 400) |
| R8 Grenzen im Handbuch | erfüllt | `handbuch.md`/`manual.md` „Grenzen“ |
| R9 Texte | erfüllt | 4 |
| R10 Design | erfüllt | 4 |
| B1 ISO-Daten | erfüllt | `diagnose.ts:38-39`, Tests D/G (`not.toMatch(/GMT/)`) |
| B2 en-US ohne ` …` | erfüllt | K4-Texte wörtlich |
| B3 Menütests und Runner-Fake | erfüllt | `kube-menu-run.test.ts`, `kube-menus.test.ts` grün |
| B4/K2 Regeln | erfüllt | wörtlich, `kube-diagnose.ts:61-72` |
| K1 (4 Stellen) | erfüllt | `diagnose.ts:27`, `:37-39`, `:43-62`, `:332-333` |
| K3 (3 Stellen) | erfüllt | `AssistantPanel.tsx:100-101`, `:136`, `:296`, `:298` |
| K5 Imports | erfüllt | `App.tsx:7`, `SecondaryWindow.tsx:2`; Effekte nach `useAssistantToggle()` |
| K7 Pflicht-Tests A–I1, G | vorhanden und grün | 175/2 803 |
| K8 Doku, Version | erfüllt | Fundstellen wörtlich; `package.json`/`package-lock.json` 0.29.0; CHANGELOG de/en |
| K10 Szene, SKILL-Satz | erfüllt | `screens.mjs` `kube-ai`; SKILL „Gegenstellen“ |
| Spec 11 Manuelle Tests | offen für den Nutzer | 8 |

## 8. Manuelle Tests für den Nutzer (echter Cluster, nur lesend)

Nur mit einem Konto, das lesen darf. Keine Aktion im Menü anklicken, die etwas ändert. Den KI-Anbieter vorher bewusst wählen: Jeder Test mit „Analyse senden“ schickt Clusterdaten an diesen Anbieter.

1. **Vorschau ohne Senden:**
   - Rechtsklick auf einen Pod mit Neustarts → `Mit KI analysieren`.
   - Die Karte zeigt die Teile mit Größen und, bei Produktion, die Warnzeile.
   - `Gesendeten Text anzeigen` öffnen und prüfen: keine Annotations, Env mit geheimem Namen als `<hidden>`, `secretKeyRef` als `<Secret name/key>`, Zeiten im Format `2026-…Z`.
   - `Verwerfen`. Im Protokoll des Anbieters (falls einsehbar) steht nichts.
2. **Senden und Antwort:**
   - Erneut analysieren → `Analyse senden`.
   - Unter der Frage stehen „Mit Kontext aus dem Cluster: … Zeichen“ und gegebenenfalls „Vertrauliche Werte maskiert: n“.
   - Kein Befehl der Antwort hat einen Knopf, ändernde stehen in Warnfarbe mit „Ändert den Cluster …“.
   - Den Text eines Befehls markieren geht, ausgeführt wird nichts.
3. **Rückfrage:** Eine zweite Frage stellen. Die Antwort bezieht sich auf den Pod, Knöpfe gibt es weiterhin keine.
4. **Tab-Wechsel (M-1):**
   - Analysieren, **nicht** senden, dann auf einen SSH-Tab wechseln.
   - Heute steht die Frage dort noch im Feld. Nicht Enter drücken, nur ansehen.
   - Nach dem Fix ist das Feld leer, zurück im Cluster-Tab steht die Frage wieder da.
5. **Anderer Tab mit Antwort:** Nach Test 2 auf einen SSH-Tab wechseln. Dort ist die Kubernetes-Antwort nicht zu sehen. Zurück im Cluster-Tab ist sie unverändert da, ohne Knöpfe.
6. **Event:** Rechtsklick auf ein Event eines Pods → `Mit KI analysieren`. In der Karte steht „Auslösendes Event“, die Frage lautet „Was bedeutet dieses Event …“. Bei einem Node-Event ist der Eintrag mit Grund gesperrt.
7. **Banner:** Bei einem Pod-Problem `Analysieren` in der roten Leiste anklicken, dann `Verwerfen`. Ein Node-Problem hat keinen Knopf.
8. **Workload:** Rechtsklick auf ein Deployment mit nicht bereiten Pods. Die Karte zeigt „Pods des Workloads“ und Events und Logs des auffälligsten Pods.
9. **Rechte:**
   - Mit einem Konto ohne `get pods/log` analysieren. Die Vorschau zeigt „Logs …: keine Berechtigung“, der Rest ist da.
   - Auf einem Cluster mit „Nur lesen“ ist der Eintrag aktiv.
10. **Maskierung erzwungen:** Beim Anbieter `Geheimnisse vor dem Senden maskieren` aus. Im Cluster-Tab steht „Für Kubernetes-Analysen maskiert Shellherd immer.“, im SSH-Tab „Maskierung ist für diesen Anbieter aus“. Danach wieder einschalten.
11. **Große Logs (I-1, nach dem Fix):** Pod mit langen JSON-Zeilen (Stacktraces) analysieren. In `Gesendeten Text anzeigen` steht die neueste Zeile des vorherigen Containers am Ende des Log-Abschnitts.
12. **Nur lesend auf dem Server (falls Audit-Log verfügbar):** Für den Analysezeitraum stehen nur `get`/`list` auf pods, events, nodes und Workloads sowie `get` auf `pods/log`. Kein `secrets`, kein `configmaps`, kein Schreibverb.

## 9. Nicht geprüft

- `AssistantPanel`, `ProblemBanner` und `ClusterView` nur gelesen und kompiliert, nicht gerendert, abgesehen von den vorhandenen Shots. Treiber nicht bedient, kein eigener Szenenlauf.
- Die `limitBytes`-Semantik (I-1) ist aus der Kubernetes-API-Beschreibung und dem Kubelet-Verhalten abgeleitet. Der Fake bildet `limitBytes` nicht ab.
- Verhalten echter Anbieter bei 16 000 Zeichen Kontext.

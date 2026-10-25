# Kubernetes: KI-Diagnose – Nachprüfung Runde 2

Grundlage:
- Review `2026-10-25-k8s-ki-diagnose-review.md` (I-1, M-1 bis M-3)
- Ledger `.superpowers/sdd/2026-10-25-k8s-ki-diagnose/progress.md`, Fix-Welle FA (I-1, M-3) und FB (M-1, M-2), Abweichung FA „neueste Zeile allein über 64 KiB → Logs-Teil fehlt“, Live-Probe Tab-Wechsel
- Fix-Diff `0ae6c5c..083297b`:
  - `46c7bba`: I-1 und M-3 (`diagnose.ts`, `diagnose.test.ts`)
  - `083297b`: M-1 und M-2 (`AssistantPanel.tsx`, `kube-diagnose.ts`, `kube-diagnose.test.ts`)

**Urteil: ready.** I-1, M-1, M-2 und M-3 sind ADDRESSED, keiner ist PARTIAL oder NOT ADDRESSED. Neu sind 0 Critical, 0 Important und 2 Minor (N-1, N-2). Beide blockieren das Release 0.29.0 nicht und können ins Folgepaket.

Gates:
- `npm run typecheck` ist grün (Node und Web).
- `npx vitest run` ist im ersten Lauf grün: 175 Dateien, 2 813/2 813 Tests, 10 mehr als im Review (`diagnose.test.ts` +4, `kube-diagnose.test.ts` +6). Kein Flake, auch nicht in `fakes.test.mjs`, also keine Einzelwiederholung.
- `src/` und `.claude/skills/run-app/` sind gegenüber `083297b` sauber. Die Läufe gelten also für den Fix-Stand.

Live:
- Keine eigene Treiber-Probe. Auf Port 9333 lief beim Prüfen kein Treiber, und es wurde nichts gestartet oder gebaut.
- `out/run-app/main/index.js` enthält den Fix-Stand (Meldung `newest log line over the byte limit`, Build 17:32). Die Shots `kube-ai-preview.png` (17:32) und `kube-ai-answer.png` (17:33) stammen also aus diesem Stand.
- Gelesen wurde das Anfrage-Protokoll des Fakes `%TEMP%\shellherd-run\kube\kube-requests.log`:
  - 57 Zeilen, davon 53 `GET` und 4 `POST …/selfsubjectrulesreviews` (Paket 10).
  - Kein `/secrets` und kein `/configmaps`.
  - Die Analyse liest `…/log?follow=false&previous=true|false&tailLines=100&limitBytes=65536`. Die zwei `tailLines=500&follow=true` gehören zur Log-Ansicht (Szene `kube-logs`).
  - Der Rückfallpfad (20/5/1) wird im Fake nicht erreicht, weil die Logs klein sind. Er ist nur durch Unit-Tests belegt.
- Die Live-Probe zum Tab-Wechsel steht im Ledger (Runde 2): Im Cluster-Tab ist die Frage da, im Tab `web-01` ist das Feld leer, und zurück im Cluster-Tab ist sie wieder da. Eine Szenen-Prüfung dafür gibt es nicht (siehe M-1).
- Proben im Scratchpad (nur Regex und Hilfsfunktionen kopiert, kein Produktcode geändert): `mutatingCommand` alt gegen neu mit 24 Fällen, Laufzeit bis 1 MB Eingabe, `wordCut`-Randfälle und die U+FFFD-Annahme aus `readTail`.
- Kein Cluster, kein KI-Anbieter, kein echter Vault, kein `%APPDATA%\Shellherd`.

**Nur lesend (Ruling 1):**
- Die Fix-Diffs unter `src/` enthalten keinen neuen API-Aufruf. Neu ist nur, dass `readTail` (`diagnose.ts:316-324`) `api.readLog` bis zu viermal nacheinander ruft. Das bleibt `GET …/pods/{pod}/log` mit `follow=false`, also `get pods/log`.
- `RecordingApi.readLog` (`diagnose.test.ts:34-42`) prüft jetzt `tailLines ∈ {100, 20, 5, 1}` und `limitBytes === DIAGNOSE_LOG_BYTES`. Jede andere Methode wirft weiter.
- Kein neuer Ausführungsweg:
  - `083297b` ändert in `AssistantPanel.tsx` nur, wo der Eingabetext liegt (`drafts` statt `draft`).
  - `textOnly`, `typeCommand`, die Knöpfe und `submit` sind unverändert.
  - `mutatingCommand` liefert weiter nur den Hinweis „Ändert den Cluster …“ und erzeugt keinen Knopf.
- **Secrets und kubeconfig:** Im Fix-Diff gibt es keine Änderung an `describe.ts`, `assistant.ts`, `ai/ipc.ts` oder der Positivliste. Zum Renderer gehen weiter nur `KubeDiagnosis` und `CodedError`.

---

## Befunde aus dem Review

### I-1 Neueste Logzeilen fehlen bei mehr als 64 KiB – ADDRESSED

**Reihenfolge 100/20/5/1:**
- Korrekt. `LOG_TAILS = [DIAGNOSE_LOG_LINES, 20, 5, 1]` (`diagnose.ts:22`). `readTail` gibt den ersten Tail zurück, dessen Text kürzer als `DIAGNOSE_LOG_BYTES` ist (`:319-321`).
- Ein Text unter der Grenze ist vollständig: Der Server hat vor `limitBytes` aufgehört, und `readLog` (`client-api.ts:322-328`) hat nicht geschnitten. Er endet also mit der neuesten Zeile.
- Der Abschnitt hat nur 2 000 Zeichen Budget (`DIAGNOSE_BUDGET.logs`). Darum reicht auch ein kurzer Tail, und `tailOf` hält danach weiter das Ende.

**Angeschnittene Zeilen werden verworfen:** Ja.
- Ein Text, der die Grenze erreicht, wird nie verwendet, es folgt immer der nächste kürzere Tail.
- Die Annahme im Kommentar (`:320`), ein mitten im Zeichen geschnittener Text sei nach `toString('utf8')` nie kürzer als die Grenze, gilt. Im Scratchpad geprüft für `é`, `€` und `😀` an jeder Schnittstelle: Die Byte-Länge nach dem Dekodieren ist immer ≥ der Schnittlänge, denn U+FFFD hat 3 Bytes.
- Ein vollständiger Text von genau 65 536 Bytes gilt als geschnitten und führt zum nächsten Tail. Das ist konservativ und harmlos.

**Verb:** Es bleibt bei `get pods/log` (siehe oben).

**Titel:**
- `last ${lines} lines` nennt jetzt den tatsächlich verwendeten Tail (`:329`, `:332`). Der Test „reads a shorter tail …“ prüft `last 20 lines`.
- Die Vorschau im Renderer nennt keine Zeilenzahl (`diagnosePartLabel`, `kube-diagnose.ts:107-112`). Der Titel steht nur im Text an die KI und unter `Gesendeten Text anzeigen`.
- Zwei Reste, nur im KI-Text: „last 1 lines“ und im Fall „nicht lesbar“ der Titel „last 100 lines“ (`:334`, `title(DIAGNOSE_LOG_LINES)`). Siehe N-2.
- Die Handbücher („die letzten 100 Logzeilen“, `handbuch.md:621`, `:640`, `manual.md:610`) nennen die Obergrenze und bleiben richtig, wie im Review vorgesehen.

**Fehlerpfade:**
- Ein Fehler beim ersten Lesen (403, 404, 400 `noPreviousContainer`) geht unverändert über `missing` in den Teil, mit demselben Grund wie vorher.
- Ein Fehler bei einem späteren Lesen (Pod zwischendurch gelöscht) landet ebenfalls in `missing`, mit seinem echten Grund.

**Tests:** Drei Fälle in `diagnose.test.ts:243-279`:
- kürzerer Tail mit „FATAL“ und `last 20 lines`;
- ein API-naher Fake (`apiLike`), der wie der Server ab der ältesten Zeile schneidet. Darin bleibt die neueste Zeile, und `line 0` ist nicht im Text;
- die Abweichung, bei der der Logs-Teil `failed` ist und kein `xxxxxxxx` hinausgeht.

Der Budget-Test schneidet jetzt nach `tailLines` und bleibt grün.

**Abweichung „neueste Zeile allein über 64 KiB → Logs-Teil fehlt“:**
- Hinnehmbar, Sicherheit ist nicht berührt. Es geht weniger hinaus, nicht mehr.
- Die Begründung im Code (`:322-323`, „its start would be an incomplete line“) trifft aber nicht zu. Bei `tailLines=1` beginnt der Text am Zeilenanfang, nur das Ende fehlt.
- `logText` schneidet die Zeile danach ohnehin mit `cleanLogText` und `wordCut` auf höchstens 4 000 Zeichen an einem Leerzeichen. Den Anfang zu behalten wäre also genauso sicher wie bei jeder anderen langen Zeile, und der Anfang trägt meist Zeit, Level und Ausnahmetext.
- Dazu nennt die Vorschau „Logs …: nicht lesbar“. Der Nutzer denkt dabei an Rechte oder Netz, nicht an eine zu lange Zeile.
- Siehe N-1. Der Fall ist selten: Eine einzelne JSON-Zeile mit Stacktrace über 64 KiB. Der Teil des vorherigen Containers ist davon unabhängig.

### M-1 Entwurf nicht pro Tab – ADDRESSED

- `AssistantPanel.tsx:84` hält `drafts: Record<string, string>`. `:99-100` lesen und schreiben nur `drafts[tab.id]` des aktiven Tabs. `accept` (`:118`) schreibt in `request.tabId`, nicht in den aktiven Tab. `withTabDraft` (`kube-diagnose.ts:77`) ist rein und getestet (`kube-diagnose.test.ts`, „keeps one draft per tab …“, auch Unveränderlichkeit).
- **Lecken Entwürfe zwischen Tabs?** Nein.
  - `submit`, `discard` und `onChange` rufen `setDraft`. Das schreibt nur in den aktiven Tab, und `submit` liest `draft` desselben Tabs.
  - Eine Analysefrage aus `accept` landet nur im Tab der Anfrage. Ein im SSH-Tab getippter Text landet nicht in der Analysekarte.
  - Live im Ledger bestätigt (siehe oben).
- **Wachsen geschlossene Tabs im Speicher an?**
  - Ja, um einen String je geschlossenem Tab, mit dem jemand tippte oder analysierte.
  - Tab-IDs sind `crypto.randomUUID()` (`App.tsx:100`, `:499`). Ein alter Entwurf taucht also nie in einem neuen Tab auf.
  - `conversations` und `diagnoses` räumen geschlossene Tabs ebenso wenig auf. Das ist bestehendes Muster.
  - Die Menge bleibt eine Handvoll Bytes je Tab und Sitzung, darum kein Befund.
- Die vom Review vorgeschlagene Szenen-Prüfung in `screens.mjs` fehlt. Belegt ist der Wechsel nur durch den Unit-Test der reinen Funktion und die Live-Probe im Ledger. Weil `withTabDraft` getestet und die Verdrahtung zwei Zeilen lang ist, ist das ausreichend. Die Prüfung steht als manueller Test 4 unten.

### M-2 `kubectl "delete"` nicht erkannt – ADDRESSED

- `kube-diagnose.ts:72` ersetzt Anführungszeichen nur an Wortkanten durch ein Leerzeichen: `/(?<=^|\s)["'`]|["'`](?=\s|$)/g`. Das ist enger als der Review-Vorschlag (alle Anführungszeichen). Damit bleibt `app="delete"` ein Wort. Die Begründung steht als Kommentar (`:69`).
- **ReDoS-frei:** Ja.
  - Zwei Alternativen aus je einem Zeichen mit Lookaround fester Länge, ohne Quantor. Je Position wird höchstens ein Zeichen geprüft.
  - Im Scratchpad gemessen: 1 MB `" " " …` in 59 ms, 1 MB `"""…` in 11 ms, linear über 10 k / 100 k / 1 M.
  - Die vorhandenen `(?:.*\s)?`-Muster sind unverändert und nicht Teil des Fixes.
- **Neue Falsch-Negative durch `(?<=^|\s)`?** Keine.
  - Der Schritt ersetzt nur Anführungszeichen durch Leerzeichen. Für `MUTATING_*` ist das monoton, denn ein Leerzeichen erfüllt `\s`, `(?<![\w.-])` und die Lookaheads `(?=[\s"'`);&|]|$)` mindestens so gut wie das Anführungszeichen.
  - Die `can-i`-Regel nimmt danach wie vorher genau ein Wort weg (`auth can-i "delete" pods` bleibt `false`).
  - In 24 Probefällen ist kein Fall von `true` auf `false` gekippt. Neu `true` sind unter anderem `kubectl "delete" pod x`, `"kubectl" delete pod x`, `kubectl rollout "restart" deploy/x`, `helm "uninstall" app` und `kubectl\t"delete"\tpod`.
- **Weiter nicht erkannt** (wie vor dem Fix, als Rest hingenommen): `kubectl ""delete"" pod`, `kubectl $'delete' pod`.
- **Neue Falsch-Positive:** etwa `kubectl get cm -o yaml "delete"` (ein Objekt namens `delete`). Das ist nur ein zusätzlicher Warnhinweis, also die sichere Richtung. Kein Befund.
- **Tests:** Drei neue `true`-Fälle und zwei `false`-Fälle (`app="delete"`, `auth can-i "delete"`). Die 50 Pflichtfälle bleiben grün.

### M-3 Schnitt mitten im Token bei Event-Meldung und Logzeile – ADDRESSED

- `wordCut` (`diagnose.ts:67-71`) wörtlich wie im Review. Genutzt in `eventLines` (`:266`, 300 Zeichen) und `logText` (`:276`, `MAX_LINE_CHARS` aus `workload-logs.ts`). `workload-logs.ts` bleibt unverändert.
- **Korrekt?** Ja.
  - `search(/\s\S*$/)` findet im Ausschnitt `[0, max)` das letzte Leerzeichen, und abgeschnitten wird davor. Ein Wort, das die Grenze überspannt, geht also ganz verloren, nie halb.
  - Eine von `cleanLogText` schon gekürzte Zeile (`MAX_LINE_CHARS + 1` Zeichen mit `…`) wird erneut gekürzt, jetzt an einem Leerzeichen.
  - Das Ergebnis hat höchstens `max` Zeichen plus `…`.
  - Die Regex ist linear (bei 4 000 Zeichen unter 0,1 ms gemessen).
- **Ohne Leerzeichen:** Das Ergebnis ist nur `…`, also nichts von der Zeile. Das ist richtig (sicher) und im Test belegt (`wordCut('x'.repeat(400), 300) === '…'`).
- **Ein Leerzeichen an Position 0:** `space > 0` ist falsch, das Ergebnis ist `…`. Ebenfalls sicher.
- **Randfälle ohne Folgen:**
  - Mehrere Leerzeichen vor dem Schnitt lassen eines vor `…` stehen (`'aaa  bbb'` → `'aaa …'`). Rein kosmetisch.
  - `\s` umfasst auch NBSP. Ein Schnitt an einem NBSP ist ebenso sicher.
  - Ein Ersatzpaar (Emoji) wird nur zerschnitten, wenn kein Leerzeichen davor steht. Dann ist das Ergebnis aber `…`.
- **Tests:** `diagnose.test.ts:282-293` prüfen `a Bearer…`, `…`, eine kurze Zeile sowie für Event und Logzeile ein Token über der Grenze ohne `SECRET` im Ergebnis.

---

## Neue Befunde

### Critical
Keine.

### Important
Keine.

### Minor

**N-1 – Eine einzelne Logzeile über 64 KiB verwirft den ganzen Logs-Teil und meldet „nicht lesbar“**
- **Stelle:** `src/main/kubernetes/diagnose.ts:322-323` (`throw new Error('newest log line over the byte limit')`), Anzeige über `missingReason` → `failed` → `assistant:kube.missing.failed` („nicht lesbar“).
- **Fehlerszenario:**
  - Eine Java-App schreibt beim Absturz eine JSON-Zeile mit einem `stack_trace` von 80 KB.
  - Auch bei `tailLines=1` erreicht der Text die Grenze. Die Analyse geht ohne den aktuellen Log hinaus, und die Vorschau sagt „Logs …: nicht lesbar“.
  - Der Nutzer sucht den Fehler bei den Rechten. Die KI sieht den Ausnahmetext am Zeilenanfang nicht, obwohl er sicher mitgehen könnte, denn `logText` kürzt die Zeile ohnehin an einem Leerzeichen auf 4 000 Zeichen.
  - Der Ledger-Grund „Anfang unvollständig“ trifft nicht zu: `tailLines=1` beginnt am Zeilenanfang.
- **Fix-Richtung:** Nach der Schleife den letzten Text behalten, statt zu werfen. Wie im Review: `const space = raw.search(/\s\S*$/); return { raw: space > 0 ? `${raw.slice(0, space)}\n` : '', lines: 1 };` (der Schnitt bei 64 KiB fällt dann auf ein Leerzeichen, danach greift `wordCut`). Den dritten I-1-Test auf „enthält den Anfang, aber kein Wort über die Grenze“ umstellen. Alternativ, wenn es beim Verwerfen bleiben soll, einen eigenen Grund mit Text „Zeile zu lang“ in de und en.

**N-2 – Titel im KI-Text: „last 1 lines“ und „last 100 lines“ im Fall „nicht lesbar“**
- **Stelle:** `src/main/kubernetes/diagnose.ts:329` (Plural fest), `:334` (`title(DIAGNOSE_LOG_LINES)` auch dann, wenn schon kürzere Tails gelesen wurden).
- **Fehlerszenario:** Unter `Gesendeten Text anzeigen` steht „Logs checkout/main (current container, last 1 lines)“. Bei N-1 steht „last 100 lines (could not be read)“, obwohl 100, 20, 5 und 1 versucht wurden. Das ist nur Text für die KI und kein UI-Text, also ohne i18n-Pflicht und rein kosmetisch.
- **Fix-Richtung:** `last ${lines} line${lines === 1 ? '' : 's'}`. Mit dem Fix aus N-1 entfällt der zweite Teil.

### Ohne Befund
- **Bis zu 4 Lesevorgänge je Abschnitt:**
  - Nacheinander, je ≤ 64 KiB und 10 s Zeitlimit (`LOG_READ_TIMEOUT_MS`). Nur wenn der vorige Tail die Grenze erreicht hat.
  - Abschnitte laufen weiter parallel (`logSections`).
  - Im schlimmsten Fall wartet die Vorschau länger. Es gehen keine zusätzlichen Daten hinaus.
- **`withTabDraft` wird exportiert, ohne geteilt zu werden:** Das folgt dem Muster von `kube-diagnose.ts` (reine Funktionen dort, Panel ohne Komponententests).

---

## Manuelle Tests für den Nutzer (echter Cluster, nur lesend)

Nur mit einem Konto, das lesen darf. Keine Aktion im Menü anklicken, die etwas ändert, und keinen Befehl aus einer Antwort von Hand ausführen. Den KI-Anbieter vorher bewusst wählen, denn jeder Test mit „Analyse senden“ schickt Clusterdaten an diesen Anbieter.

1. **Vorschau ohne Senden:** Rechtsklick auf einen Pod mit Neustarts, `Mit KI analysieren`, dann `Gesendeten Text anzeigen` öffnen: Die Karte zeigt die Teile mit Größen (bei Produktion mit Warnzeile), der Text enthält keine Annotations, Env mit geheimem Namen als `<hidden>`, `secretKeyRef` als `<Secret name/key>` und Zeiten als `2026-…Z`, und nach `Verwerfen` ist beim Anbieter nichts angekommen.
2. **Senden und Antwort:** Erneut analysieren und `Analyse senden`: Unter der Frage stehen „Mit Kontext aus dem Cluster: … Zeichen“ und gegebenenfalls „Vertrauliche Werte maskiert: n“, kein Befehl der Antwort hat einen Knopf, und ändernde Befehle stehen in Warnfarbe mit „Ändert den Cluster …“.
3. **Rückfrage:** Eine zweite Frage zur selben Analyse stellen, und die Antwort bezieht sich weiter auf den Pod, ohne Knöpfe.
4. **Tab-Wechsel (M-1):** Analysieren, nicht senden, auf einen SSH-Tab wechseln und wieder zurück: Im SSH-Tab ist das Eingabefeld leer, im Cluster-Tab steht die Frage wieder da.
5. **Getippter Text bleibt im eigenen Tab (M-1):** Im SSH-Tab etwas ins Feld tippen, ohne zu senden, und in den Cluster-Tab mit offener Analysekarte wechseln: Dort steht weiter die Analysefrage, nicht der getippte Text.
6. **Anderer Tab mit Antwort:** Nach Test 2 auf einen SSH-Tab wechseln: Die Kubernetes-Antwort ist dort nicht zu sehen und im Cluster-Tab unverändert und ohne Knöpfe da.
7. **Event:** Rechtsklick auf ein Event eines Pods und `Mit KI analysieren`: Die Karte zeigt „Auslösendes Event“, die Frage lautet „Was bedeutet dieses Event …“, und bei einem Node-Event ist der Eintrag mit Grund gesperrt.
8. **Banner:** Bei einem Pod-Problem `Analysieren` in der roten Leiste anklicken und dann `Verwerfen`: Die Karte öffnet sich und verschwindet wieder, und ein Node-Problem hat keinen Knopf.
9. **Workload:** Rechtsklick auf ein Deployment mit nicht bereiten Pods und `Mit KI analysieren`: Die Karte zeigt „Pods des Workloads“ sowie Events und Logs des auffälligsten Pods.
10. **Rechte:** Mit einem Konto ohne `get pods/log` analysieren: Die Vorschau zeigt „Logs …: keine Berechtigung“, der Rest ist da, und auf einem Cluster mit „Nur lesen“ ist der Eintrag aktiv.
11. **Maskierung erzwungen:** Beim Anbieter `Geheimnisse vor dem Senden maskieren` ausschalten: Im Cluster-Tab steht „Für Kubernetes-Analysen maskiert Shellherd immer.“, im SSH-Tab „Maskierung ist für diesen Anbieter aus“, danach die Option wieder einschalten.
12. **Große Logs (I-1):** Einen Pod mit langen JSON-Zeilen (Stacktraces, zusammen über 64 KiB in den letzten 100 Zeilen) analysieren: Unter `Gesendeten Text anzeigen` steht die neueste Zeile (vergleichbar mit `kubectl logs <pod> --tail=1`) am Ende des Log-Abschnitts, im Titel steht „last 20 lines“ oder weniger, und keine Zeile endet mitten in einem Wort.
13. **Lange Event-Meldung (M-3):** Ein Event mit einer Meldung über 300 Zeichen analysieren: In `Gesendeten Text anzeigen` endet die Meldung an einer Wortgrenze mit `…`.
14. **Nur lesend auf dem Server (falls ein Audit-Log verfügbar ist):** Für den Analysezeitraum stehen dort nur `get`/`list` auf pods, events, nodes und Workloads sowie `get` auf `pods/log` (auch mehrfach je Container bei großen Logs), aber kein `secrets`, kein `configmaps` und kein Schreibverb.

## Nicht geprüft

- Treiber nicht bedient, kein eigener Szenenlauf. Den Tab-Wechsel belegt nur die Live-Probe im Ledger.
- Der Rückfallpfad 20/5/1 gegen einen echten API-Server: Der Fake bildet `limitBytes` nicht ab, belegt ist er durch die Unit-Tests mit `apiLike`.
- `AssistantPanel.tsx` nur gelesen und kompiliert, nicht gerendert.

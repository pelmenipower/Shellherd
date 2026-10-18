# Kubernetes – Suchen und Filtern – Design

Stand: 2026-10-18 · Erweiterung von Stufe 1 und den Kontextmenüs · Analyse: Fable · Validierung: Opus (Anhang `-validation.md`, sobald vorhanden, bindend)

Umgesetzt in Version 0.7.0. Bindend ist der Anhang `-validation.md`; wo diese Spec abweicht (z. B. Events-Standardsortierung „Zuletzt ↓“ statt „Warnungen oben“, Hotkeys `w` und `F`, `:filter`, `:status`), gilt der Anhang und der Code (`SEARCH_HELP`, `CHIPS`).

## Umfang (festgelegt)

**Drin:**
- Die „Minimale erste Stufe“ aus Abschnitt 6, dazu `F` und `:filter`:
  - Suche mit Qualifiern
  - Status-Chips je Reiter inklusive „Auffällig“ (`w`)
  - Persistenz je Reiter und im Workspace
  - „N von M“
  - Standardsortierung der Events
  - Main-Änderungen für Jobs-Status, Evicted/Unknown und Node-`pressure`
  - Befehle `:status` und `:filter`
  - Hilfe-Spalte „Suche“
  - Kontextmenü „Nur <Status> anzeigen“ und die Einträge im Hintergrundmenü
  - Namespace-Spalte bei „alle“
  - Leer-Text mit „In allen Namespaces suchen“

**Nicht drin** (Extras aus Abschnitt 6):
- Hervorhebung des Namens
- `age<10m`
- „Rollout läuft“
- Ingress „Ohne Adresse“
- „Ähnliche ausblenden“
- „In der Tabelle zeigen“ im Problem-Hinweis
- Punkt am Reiter

Alle übrigen Abschnitte unten sind bindend. Steht dort „extra“, ist der Punkt nicht in dieser Spec.

## 0. Kurzfassung der Entscheidungen

| Frage | Entscheidung |
|---|---|
| Zwei Mechanismen | **Suche** (Freitext mit Qualifiern, `/`) und **Status-Chips** (Klick-Filter je Reiter). Beide zusammen bilden *einen* `KubeFilter`; Chips sind OR innerhalb einer Gruppe, AND zwischen Gruppen und AND zur Suche. |
| Geltungsbereich | **Chips gehören zum Reiter, Suchtext gehört zur Tabelle.** Reiterwechsel behält beides je Reiter (heute geht der Filter verloren). Drill-down/Jump leeren den Suchtext der Zieltabelle; Jump leert zusätzlich die Chips des Ziel-Reiters, damit das Ziel immer sichtbar ist. |
| Persistenz | Beides wandert in `KubeViewSnapshot` (Workspace). Sichtbar bleibt es immer: Chip-Leiste leuchtet, Kopfzeile zeigt „N von M“. |
| Standard | Alle Reiter: keine Chips aktiv. **Events** bekommen zusätzlich eine Standardsortierung „Zuletzt ↓“ (heute: Reihenfolge des Eintreffens). Kein Reiter startet mit „Warning“ vorausgewählt. |
| Universeller Chip | **„Auffällig“** (Tone `warn`/`bad`) auf jedem Reiter, Hotkey `w`. Ersetzt zehn verschiedene „Probleme zeigen“-Ideen. |
| Suche | Terme mit Leerzeichen = AND; `"…"` für Phrasen; `!term` Negation; `key=value` Label; `feld:wert` Qualifier (Teilstring); `restarts>3`, `count>=5` Zahlen. Unbekannte Qualifier gelten als Text. Immer case-insensitive. Kein Debounce, kein Highlighting in der ersten Stufe. |
| Namespace | Die Suche weitet sich **nicht** von selbst auf alle Namespaces aus. Bei null Treffern bietet der Leer-Text den Knopf „In allen Namespaces suchen“. |
| Main-Änderungen (b) | Jobs bekommen eine Status-Zelle und -Spalte; Pods zeigen `Evicted`/`Unknown` korrekt; Node-Zeilen tragen `pressure`. Status-Mengen wandern nach `src/shared/kube-status.ts`, damit Main und Renderer dieselbe Quelle haben. |
| Hotkeys | `w` = Auffällig ein/aus, `F` = Suche und Chips des Reiters zurücksetzen. Beide frei in `KUBE_COMMANDS`. Chips haben sonst keine Tasten (Ziffern sind Reiter). |
| Befehle | `:filter <suche>` und `:status <chip>[,<chip>]` / `:status alle`, mit Vervollständigung der Chip-IDs des aktuellen Reiters. |

---

## 1. Bestand heute und Lücken

### 1.1 Was es gibt

| Stelle | Verhalten |
|---|---|
| `kube-view.ts:111-120` `matchesFilter` | Entweder **Name-Teilstring** (`row.ref.name`) oder **genau ein Label** `key=value` (exakte Gleichheit, case-insensitive). Nichts anderes. |
| `kube-view.ts:98-109` `visibleRows` | Filter, dann Sortierung. Ohne Sortierung Reihenfolge des Eintreffens. |
| `kube-view.ts:65` `setKind` | **Leert Filter und Sortierung** bei jedem Reiterwechsel. |
| `kube-view.ts:66` `setNamespace` | Behält den Filter. |
| `kube-view.ts:73,89,236` `openQuery`, `jump`, `restore` | Leeren den Filter. |
| `kube-view.ts:122-129` `snapshotOf` | Filter ist **nicht** im Workspace-Snapshot. |
| `ClusterView.tsx:241,282-311,349-373` | `/` öffnet ein Eingabefeld in der Kopfzeile, Tippen filtert sofort, `Enter` schließt und behält, `Esc` leert und schließt, `onBlur` schließt und behält. Ohne Prompt steht dort `Filter: <text> · : befehl`. Kein ×, keine Trefferzahl. |
| `ResourceTable.tsx:156-161` | Leer-Text „Keine Treffer für „x“.“ |
| `kube-menus.ts:164-169` | Zeilenmenü Pods: bis zu drei Einträge „Filtern: app=api“ (setzen den ganzen Filtertext). |
| `kube-menus.ts:517-532` | Hintergrundmenü: „Filter leeren“. |
| `kube-view.ts:216-219` | Drill-down CronJob → Jobs setzt den Filter auf den CronJob-Namen (Teilstring; trifft auch `backup-db` bei `backup`, siehe Validation Nice-to-have 9). |
| README Zeile 155 | „`/` filtert“ – mehr steht nirgends. Die Hilfe (`?`) nennt nur „Liste filtern“. |

### 1.2 Lücken und Fehler

1. **Suche ist name-only.** Node, Image, Status, Namespace, IP, Ports, Hosts: nichts davon ist suchbar.
2. **Events: `/` sucht praktisch nichts.** `row.ref.name` ist bei Events der Objektname des Event-Objekts (`api-1.17f3a2b4c5d6`), nicht Meldung, Grund oder beteiligtes Objekt. Genau die Felder, die man sucht (`cells.reason`, `cells.object`, `cells.message`), werden nicht durchsucht.
3. **Nur ein Label**, nur Gleichheit, keine Kombination mit Text, keine Negation.
4. **Filter geht beim Reiterwechsel verloren** (`setKind`). Wer in Pods `app=api` setzt und kurz zu Events schaut, fängt von vorn an.
5. **Keine Trefferzahl** („12 von 240“) und kein Hinweis in der Reiterleiste, dass gefiltert wird. Mit einem aktiven Filter und einer leeren Liste wirkt die Tabelle „kaputt“.
6. **Keine Status-Filter.** Die Zeilen haben Tone und Status, aber nichts davon ist klickbar. Das ist die eigentliche Nutzeranfrage.
7. **Kein Namespace in der Tabelle** bei „alle Namespaces“ (`KIND_COLUMNS` hat keine Namespace-Spalte, `ResourceTable.tsx:58-60`). Ein `ns:`-Qualifier wäre blind. Gehört in dieselbe Spec.
8. **Events ohne Standardsortierung.** Die Spec (Zeile 150) sagt „Warnungen stehen oben“, umgesetzt ist nichts; `applyRows` hält die Reihenfolge des Eintreffens, die bei Events (List nach Name) bedeutungslos ist.
9. **Jobs haben keinen Status.** `rows.ts:211-222` liefert nur `completions` `s/c` und Tone (`ok` = fertig, `bad` = `failed>0`, sonst `warn`). Ein Job mit einem Fehlversuch, der noch läuft (backoffLimit nicht erreicht), gilt als „bad“. `status.active` und die Conditions `Complete`/`Failed` werden nicht gelesen. Ohne Status-Zelle wären die Chips „läuft / erfolgreich / fehlgeschlagen“ Schätzungen.
10. **Pods: `Evicted` erscheint als `Failed`, `Unknown` als „ok“.** `podStatus` (`rows.ts:54-85`) liest `status.reason` nicht (Evicted, NodeLost, Shutdown, Preempting); `Unknown` steht in keiner Tone-Menge und wird grün. Evicted-Pods sind im Alltag die Hauptkandidaten für „Fehler“-Filter und Aufräumen.
11. **Nodes: `pressure` nur in `NodeTile`**, nicht in der Node-Zeile (`rows.ts:246-257`). Ein Chip „Druck“ braucht das Feld an der Zeile oder einen Umweg über `state.nodes`.
12. **Hidden Selection.** Ist die ausgewählte Zeile vom Filter verdeckt, bleibt `state.selected` stehen (`ClusterView.tsx:65` findet sie nicht mehr, Dock leert sich, `Shift+F10` sagt „Wähle zuerst eine Zeile“). `keepSelection` (`kube-view.ts:190-200`) behandelt nur gelöschte Zeilen, nicht unsichtbar gewordene. Mit Status-Chips passiert das laufend (Pod wechselt von `Running` zu `Completed`).
13. **Klickbares × im Prompt** ginge heute kaputt: `onBlur` schließt den Prompt, bevor ein Klick ankommt. Lösung wie bei den Vorschlägen (`onMouseDown` + `preventDefault`, `ClusterView.tsx:363`).
14. `matchesFilter` bricht bei einem Label-Wert mit `=`; Werte dürfen laut `LABEL_VALUE` kein `=` enthalten, also nur ein Robustheitspunkt.

---

## 2. Status- und Schnellfilter (Chips) je Reiter

### 2.1 Modell

```ts
// src/shared/kube-status.ts
export type ChipGroup = 'attention' | 'status' | 'trait' | 'type' | 'time';
export interface ChipDef {
  id: string;               // englisch, klein, stabil: 'running', 'failed', 'warning', '5m' …; auch der Wert für :status
  label: string;            // deutsch, UI-Wortlaut
  group: ChipGroup;         // OR innerhalb der Gruppe, AND zwischen Gruppen
  matches: (row: KubeRow, now: number) => boolean;
}
export const CHIPS: Record<KubeKind, ChipDef[]>;
```

- **OR innerhalb einer Gruppe, AND zwischen Gruppen, AND zur Suche.** Beispiel Pods: `status ∈ {Wartet, Fehler}` ∧ `Mit Neustarts` ∧ Suchtext.
- Eine Gruppe ohne aktiven Chip filtert nicht.
- Die Gruppe `attention` hat genau einen Chip **„Auffällig“** auf jedem Reiter: `row.tone === 'warn' || row.tone === 'bad'`. Das ist die eine Taste (`w`), die auf jedem Reiter dasselbe bedeutet. Bei Events ist das exakt „Warning“, bei Pods „alles, was nicht grün ist“, bei Nodes „nicht bereit, Druck, gesperrt“.
- **Zähler** am Chip: Anzahl der Zeilen, die den Chip erfüllen, **gerechnet über die Zeilen, die der Suchtext trifft** (Chips anderer Gruppen und derselben Gruppe werden ignoriert). So heißt „Fehler 3“ immer „3 Fehler unter den Suchtreffern“ und die Zahlen springen beim Klicken nicht. Chips mit 0 bleiben sichtbar, aber ausgegraut (stabile Leiste, Muskelgedächtnis).
- Der Chip-Zustand ist `string[]` aus Chip-IDs; Gruppe und Prädikat kommen aus der Definition. Unbekannte IDs (alte Workspaces) werden beim Restore verworfen.

### 2.2 Pods (★★★, Kern der Anfrage)

Status-Strings, die `podStatus` erzeugt (`rows.ts:69-76`): `Terminating`, ein `waiting.reason` (`ContainerCreating`, `PodInitializing`, `CrashLoopBackOff`, `ImagePullBackOff`, `ErrImagePull`, `InvalidImageName`, `CreateContainerConfigError`, `CreateContainerError`, …), ein `terminated.reason` bei Phase ≠ Succeeded (`Error`, `OOMKilled`, `Completed` bei beendetem Sidecar), `Completed` (Phase Succeeded), sonst die Phase (`Pending`, `Running`, `Failed`, `Unknown`). Mit (b) zusätzlich `Evicted`, `NodeLost`, `Shutdown`, `Preempting` aus `status.reason`.

| Gruppe | Chip (Label) | ID | Prädikat | Wert |
|---|---|---|---|---|
| attention | Auffällig | `attention` | `tone ∈ {warn, bad}` | ★★★ |
| status | Läuft | `running` | `cells.status === 'Running'` | ★★★ |
| status | Wartet | `waiting` | `cells.status ∈ WARN_STATES` = {`Pending`, `ContainerCreating`, `PodInitializing`} | ★★ |
| status | Fehler | `failed` | `tone === 'bad'` (= `BAD_STATES` ∪ `Evicted`, `Unknown`, … nach (b); eine Quelle, nie zwei Listen) | ★★★ |
| status | Abgeschlossen | `completed` | `cells.status === 'Completed'` | ★★★ |
| status | Beendet | `terminating` | `cells.status === 'Terminating'` | ★ |
| trait | Nicht bereit | `notready` | `ready a/b` mit `a < b` **und** `status ∉ {Completed, Terminating}` (fertige Pods sind immer 0/1) | ★★★ |
| trait | Mit Neustarts | `restarts` | `Number(cells.restarts) > 0` (für Schwellen: Suche `restarts>3`) | ★★ |

Status-Werte, die in keinen Status-Chip fallen (z. B. ein `Completed` Sidecar in einem Running-Pod) verschwinden, sobald irgendein Status-Chip aktiv ist. Das ist gewollt; ein Chip „Sonstige“ wäre Rauschen. Test: jeder Status aus den `rows.test.ts`-Fixtures fällt in höchstens einen Status-Chip.

Standard: nichts aktiv. Begründung: Wer Pods öffnet, will die Liste sehen; „Läuft“ als Standard versteckt genau die Pods, die man sucht.

### 2.3 Deployments, StatefulSets, DaemonSets (★★)

`workloadCells` (`rows.ts:148-169`): `ready` = `r/d`, `upToDate` numerisch, Tone `muted` (0 gewünscht), `ok` (r = d), `warn` (sonst).

| Gruppe | Chip | ID | Prädikat | Wert |
|---|---|---|---|---|
| attention | Auffällig | `attention` | Tone warn/bad | ★★★ |
| status | Vollständig | `complete` | `tone === 'ok'` | ★ |
| status | Nicht vollständig | `incomplete` | `tone === 'warn'` (ready < desired) | ★★★ |
| status | Auf 0 | `zero` | `tone === 'muted'` (replicas bzw. desired = 0) | ★★ |
| trait (extra) | Rollout läuft | `rolling` | `Number(cells.upToDate) < desired`, `desired` aus `cells.ready` nach `/` geparst | ★ |

### 2.4 Jobs (★★★, braucht (b))

Main (b): `rows.ts` liest `status.conditions` und `status.active`, setzt `cells.status`:
`Failed` (Condition Failed=True) → `Complete` (Condition Complete=True) → `Suspended` (`spec.suspend`) → `Running` (`active > 0`) → `Pending`.
Tone: `Failed` → bad, `Complete` → ok, `Suspended` → muted, sonst warn. Neue Spalte `{ key: 'status', label: 'Status' }` nach `completions` in `KIND_COLUMNS.jobs`.

| Gruppe | Chip | ID | Prädikat | Wert |
|---|---|---|---|---|
| attention | Auffällig | `attention` | Tone warn/bad | ★★ |
| status | Läuft | `running` | `status ∈ {Running, Pending}` | ★★ |
| status | Erfolgreich | `success` | `status === 'Complete'` | ★★ |
| status | Fehlgeschlagen | `failed` | `status === 'Failed'` | ★★★ (Jobs-Liste ist voller alter CronJob-Läufe; „Fehlgeschlagen“ ist das, was man aufräumt) |

Ohne (b) wäre der Fallback `tone` (`ok` → erfolgreich, `bad` → fehlgeschlagen, `warn` → läuft). Empfehlung: (b) machen, der Fallback ist bei Jobs mit Retries falsch.

### 2.5 CronJobs (★)

| Gruppe | Chip | ID | Prädikat |
|---|---|---|---|
| status | Aktiv | `active` | `row.suspended !== true` |
| status | Angehalten | `suspended` | `row.suspended === true` |

„Zuletzt fehlgeschlagen“ ginge nur über die Jobs; dafür gibt es den Drill-down. Kein `attention` (Tone ist nur ok/muted).

### 2.6 Services (★★)

| Gruppe | Chip | ID | Prädikat |
|---|---|---|---|
| type | ClusterIP / NodePort / LoadBalancer / ExternalName | `clusterip`, `nodeport`, `loadbalancer`, `externalname` | `cells.type === …` |
| trait | Headless | `headless` | `cells.clusterIp === 'None'` |
| trait | Ohne Selector | `noselector` | `Object.keys(row.selector ?? {}).length === 0` |

Alle vier Typen immer anzeigen (Zähler 0 ausgegraut). Kein `attention`.

### 2.7 Ingress

Keine Chips; die Suche über Hosts reicht. Extra (★): trait „Ohne Adresse“ (`cells.address === ''`), weil das heißt „kein Controller hat ihn übernommen“.

### 2.8 Nodes (★★, sechs Nodes, aber die Chips sind billig)

`cells.status` ist `Ready` | `NotReady`, optional `,SchedulingDisabled`; `row.unschedulable`; `cells.roles` kommagetrennt. (b): `row.pressure?: string[]` aus `nodeFacts` (bereits berechnet, `rows.ts:87-100`).

| Gruppe | Chip | ID | Prädikat |
|---|---|---|---|
| attention | Auffällig | `attention` | Tone warn/bad |
| trait | Nicht bereit | `notready` | `String(cells.status).startsWith('NotReady')` |
| trait | Gesperrt | `cordoned` | `row.unschedulable === true` |
| trait | Druck | `pressure` | `(row.pressure ?? []).length > 0` |
| trait | Control-Plane | `controlplane` | `cells.roles` enthält `control-plane` oder `master` |

Hier ist „trait“ bewusst eine Gruppe (OR): „Nicht bereit ∨ Druck“ ist die natürliche Frage.

### 2.9 Events (★★★)

`cells.type` `Normal` | `Warning`, `cells.last` ISO, `cells.count`, `cells.reason`, `cells.object` `Kind/name`, `cells.message`. Der API-Server löscht Events nach `--event-ttl` (Standard 1 h), ältere gibt es nicht.

| Gruppe | Chip | ID | Prädikat |
|---|---|---|---|
| type | Warning | `warning` | `cells.type === 'Warning'` (= Auffällig; deshalb hier **kein** separater Auffällig-Chip, `w` schaltet Warning) |
| type | Normal | `normal` | `cells.type === 'Normal'` |
| time | Letzte 5 min | `5m` | `now - Date.parse(cells.last) <= 5·60·1000`; Zeilen ohne `last` fallen heraus |
| time | Letzte 15 min | `15m` | analog |

Standard: keine Chips, **Sortierung `last` absteigend** (neue Standardsortierung je Kind, nur Events). Das ersetzt die Spec-Aussage „Warnungen stehen oben“: oben steht das Neueste, Warnungen sind farbig und per `w` einen Tastendruck entfernt. Diese Abweichung in der Spec festhalten.

Keine Chips für Grund (`BackOff`, `Unhealthy`, `FailedScheduling` …): zu viele, clusterabhängig; dafür `reason:backoff` in der Suche.

---

## 3. Suche

### 3.1 Syntax (eine Zeile, in der Hilfe genau so dokumentiert)

```
term  "ein satz"  !term  key=value  key!=value  feld:wert  !feld:wert  restarts>3  count>=5
```

| Form | Bedeutung |
|---|---|
| `term` | Teilstring, case-insensitive, in **irgendeinem** Suchfeld des Reiters (3.2). Mehrere Terme = AND. |
| `"ein satz"` | Phrase mit Leerzeichen (Events-Meldungen). |
| `!term` | Negation (kein Suchfeld enthält den Term). `!` statt `-`, weil `-` in Namen vorkommt (`-manual-`) und `!` die Label-Selector-Konvention ist. |
| `key=value` | Label gleich (exakt, case-insensitive, wie heute). `key!=value` negiert. Label-Werte stehen **nicht** im Freitext (sonst trifft `api` jede Zeile mit `app=api-…`). |
| `feld:wert` | Qualifier, Teilstring auf ein Feld. Unbekannter Qualifier = normaler Text (robust gegen `10:30`, `http://…`). |
| `restarts>3`, `count>=5` | Zahlenvergleich `> >= < <= =` auf numerische Zellen; nur `restarts` (Pods) und `count` (Events). |

Nicht in der ersten Stufe: `age<10m`, `cpu>`, Regex, OR (`|`). Das kann später kommen, ohne die Syntax zu brechen.

Grammatik ist winzig: Tokenizer (Quotes, Whitespace), dann pro Token `!`-Präfix, dann `name(=|!=)`, dann `name(>=|<=|>|<|=)digits` für erlaubte Zahlenfelder, dann `name:` gegen die Qualifier-Liste des Kinds, sonst Text. Ungültiges wird nie zum Fehler, nur zu Text.

### 3.2 Suchfelder je Reiter

| Reiter | Freitext (`term`) über | Qualifier |
|---|---|---|
| Pods | `ref.name`, `ref.namespace`, `cells.status`, `node`, alle `cells['image:*']`, `owner.name`, `ip` | `ns:` `node:` `status:` `image:` `owner:` `ip:` `container:` (Container-Name in `containers`) |
| Deployments / StatefulSets / DaemonSets | name, namespace, `cells.image` | `ns:` `image:` |
| Jobs | name, namespace, `cells.status` (nach (b)), `owner.name` | `ns:` `status:` `owner:` |
| CronJobs | name, namespace, `cells.schedule` | `ns:` `schedule:` |
| Services | name, namespace, `cells.type`, `cells.clusterIp`, `cells.ports` | `ns:` `type:` `ip:` `port:` |
| Ingress | name, namespace, `cells.hosts`, `cells.address` | `ns:` `host:` `address:` |
| Nodes | name, `cells.status`, `cells.roles`, `cells.version`, `ip` | `role:` `ip:` `version:` |
| Events | `cells.reason`, `cells.object`, `cells.message`, namespace, `cells.type` – **nicht** `ref.name` | `ns:` `reason:` `object:` `type:` `kind:` (`involved.kind`) |

Nicht suchbar: CPU/RAM (Pods: liegen in `state.usage`, nicht in `cells`; Nodes: dekorierte Zellen), Alter (kommt mit `age<` später).

`owner:` ist exakt (ganzer Name), nicht Teilstring: Damit wird der CronJob-Drill-down (`kube-view.ts:216-219`, `kube-menus.ts:259`) von „Name-Teilstring“ auf `owner:<cronjob>` umgestellt und Nice-to-have 9 der Validation ist erledigt (trifft `backup-db` nicht mehr bei `backup`). Die Crumb bleibt „CronJob nightly“.

### 3.3 Verhalten

- **`/`** bleibt die Taste; das Feld heißt jetzt „Suchen“ (Placeholder `Name, status:, node:, app=api, !term …`). `Enter` behält und gibt den Fokus an die Tabelle, `Esc` leert und schließt (Spec), `onBlur` behält. Ein × im Feld leert (mit `onMouseDown`+`preventDefault`, sonst schließt `onBlur` zuerst).
- **Case-insensitive**, immer. Keine Option.
- **Kein Debounce.** 2 000 Zeilen × vorberechneter Suchstring sind deutlich unter 1 ms je Anschlag; die Tabelle ist ab 200 Zeilen gefenstert. Sollte es je nötig sein: `useDeferredValue` um den Suchtext, nicht ein Timer im Reducer.
- **Kein Highlighting** in der ersten Stufe (Zellen sind reine Strings, `cellText`). Extra: Name-Zelle hervorheben.
- **Drill-down und Namespace:** Die Suche arbeitet lokal auf den Zeilen der aktuellen Query (Namespace und Selector sind serverseitig). `ns:` nützt nur bei „alle Namespaces“, deshalb bekommt die Tabelle dort eine Namespace-Spalte (1.2 Punkt 7). Die Suche weitet sich **nicht** automatisch auf alle Namespaces aus (würde ein Resubscribe auslösen und überraschen). Stattdessen: bei 0 Treffern und `query.namespace !== null` zeigt der Leer-Text `Keine Treffer für „x“ in shop.` und einen Knopf **„In allen Namespaces suchen“** (`setNamespace(null)`, Suchtext bleibt).
- **Menü „Filtern: app=api“** ersetzt den Suchtext (wie heute), Chips bleiben.

---

## 4. Persistenz und UX

### 4.1 Zustand

```ts
export interface KubeFilter { text: string; chips: string[] }
// KubeViewState
filters: Partial<Record<KubeKind, KubeFilter>>;   // ersetzt filter: string
now: number;                                       // für Zeit-Chips; per 'tick' alle 10 s
```

Regeln im Reducer:

| Aktion | Suchtext | Chips |
|---|---|---|
| `setKind` | bleibt (je Reiter) | bleiben (je Reiter) |
| `setNamespace` | bleibt | bleiben |
| `drill`, `openQuery`, `back` | Text der **Ziel**-Tabelle wird geleert (wie heute; CronJob setzt `owner:`) | bleiben |
| `jump` (Problem, Node-Kachel, Event → Objekt, Owner) | Text geleert | **Chips des Ziel-Reiters geleert**, sonst wäre das Ziel unsichtbar |
| `restore` | aus Snapshot | aus Snapshot, unbekannte IDs verworfen |
| `search(text)`, `toggleChip(id)`, `setChips(ids)`, `clearFilter()` | neu | neu |

`setKind` setzt `sort` künftig auf `defaultSort(kind)` (Events: `last` ↓, sonst `null`) statt immer `null`.

### 4.2 Snapshot

`KubeViewSnapshot` bekommt `filters?: Partial<Record<KubeKind, { text?: string; chips?: string[] }>>`; zod: `text` ≤ 200 Zeichen, `chips` ≤ 16 Einträge à ≤ 40 Zeichen, Keys aus `KUBE_KINDS`. Alte Snapshots ohne `filters` bleiben gültig. `snapshotOf` lässt leere Filter weg, damit der Snapshot-Key (`ClusterView.tsx:114`) nicht unnötig kippt.

Ja, persistieren: Ein Ops-Workspace mit „Events: Warning“ und „Pods: Auffällig“ ist genau der Zweck eines Workspaces. Die Gefahr „wo sind meine Pods?“ fängt die sichtbare Chip-Leiste plus „N von M“ ab.

### 4.3 Anzeige

- **Chip-Leiste** direkt unter den Reiter-Tabs (`kube-kind-tabs`), eine Zeile: `[Auffällig 3] | [Läuft 180] [Wartet 2] [Fehler 3] [Abgeschlossen 12] [Beendet 0] | [Nicht bereit 4] [Mit Neustarts 9]` … rechts `12 von 240` und ein × „Zurücksetzen“ (nur sichtbar, wenn etwas aktiv ist). Gruppen durch dünne Trenner. Stil: `.kube-chip` existiert (`kubernetes-ui.css:17`), dazu `.kube-chip-on` (Akzent wie `.kube-kind-on`) und `.kube-chip-zero` (ausgegraut).
- **Kopfzeile:** `kube-prompt-hint` zeigt `Suche: status:crash` bzw. `/ suchen`. Der Reiter-Tab eines gefilterten Reiters bekommt einen Punkt (`Pods •`), damit man beim Zurückkommen sieht, dass dort noch ein Filter steht.
- Leer-Text: `Keine Treffer für „x“.` bzw. bei Chips `Keine Zeilen mit Status Fehler.` plus bei Namespace ≠ alle der Knopf aus 3.3.
- Drill-down in Container (`containersOf`) ist von Suche und Chips unberührt (Container-Liste wird nicht gefiltert).

### 4.4 Tasten und Befehle

Belegt sind (`kube-commands.ts:66-99`): `j k ↑ ↓ Enter Esc ⌫ Shift+F10 1–9 0 : ? / l p s e y d Ctrl+j Ctrl+Shift+T r S Ctrl+d`. Der Test `kube-commands.test.ts:51-52` erzwingt Eindeutigkeit. Global gibt es nur `Ctrl+Shift+Space`.

| Taste / Befehl | Wirkung | Gruppe |
|---|---|---|
| `/` | Suche öffnen (unverändert) | Ansicht |
| `w` | Chip „Auffällig“ ein/aus (bei Events: „Warning“) | Ansicht |
| `F` | Suche und Chips des aktuellen Reiters zurücksetzen | Ansicht |
| `:filter <suche>` | Suchtext setzen, `:filter` ohne Argument leert | – |
| `:status <id>[,<id>]` / `:status alle` | Chips der Gruppe(n) der genannten IDs setzen; Vervollständigung mit den Chip-IDs des aktuellen Reiters | – |

Keine Ziffern (Reiter), kein `Alt+` (Windows-Menüleiste), keine Tasten je Chip. `bindingOf` liefert für Shift+f den String `F`, wie bei `S`.

### 4.5 Hilfe

Das Overlay (`HelpOverlay.tsx`) bekommt eine dritte Spalte **„Suche“**: die Syntaxzeile aus 3.1 mit je einem Beispiel und darunter die Qualifier und Chip-IDs des **aktuellen** Reiters. Quelle ist eine exportierte Konstante `SEARCH_HELP` in `kube-filter.ts` plus `CHIPS[kind]`, nicht ein zweiter Text, damit Hilfe und Parser nicht auseinanderlaufen (dasselbe Prinzip wie `KUBE_COMMANDS`). Die Hilfesuche durchsucht auch diese Spalte.

### 4.6 Kontextmenüs

- Zeilenmenü (Pods, Jobs, Services, Nodes, Events): ein Eintrag **„Nur <Chip-Label> anzeigen“** für den Status-/Typ-Chip, in den die Zeile fällt (z. B. „Nur Fehler anzeigen“, „Nur Warning anzeigen“, „Nur NodePort anzeigen“), neben den bestehenden „Filtern: app=api“-Einträgen. `view: [select(row), setChips([id])]`. Fällt die Zeile in keinen Chip: kein Eintrag.
- Pods zusätzlich: **„Nur auf Node <node>“** gibt es schon als „Pods auf Node … anzeigen“ (Query). Kein Doppel.
- Extra (★★): **„Ähnliche ausblenden“** bei Pods/Jobs mit Owner: hängt `!owner:<name>` an den Suchtext. Praktisch beim Durchsehen von Problemen („die zehn `nginx`-Pods sind bekannt, was ist noch?“).
- Hintergrundmenü: „Filter leeren“ wird zu „Suche leeren“ und „Status-Filter leeren“ (je deaktiviert mit Begründung, wie heute).
- Problem-Hinweis (`ProblemBanner.tsx`): Klick springt wie heute und leert die Chips des Ziel-Reiters (4.1). Extra (★★): Knopf **„In der Tabelle zeigen“** neben „N Probleme“: `openQuery({ kind:'pods', namespace:null }, 'Probleme')` + Chip `attention`. Das ist die Pod-Sicht aller Namespaces, die den Problemen entspricht (Obermenge: auch Pending < 5 min und nicht-bereite Pods).

---

## 5. Performance und Korrektheit

- **Vorberechnung:** `searchText(row)` (alle Suchfelder, lowercase, `\n`-getrennt) in einer `WeakMap<KubeRow, string>`; Zeilen sind unveränderlich und werden bei Upserts ersetzt, also stimmt der Cache ohne Invalidierung. Der kompilierte Filter (`compileFilter(kind, filter, now)`) wird je `(kind, text, chips)` einmal gebaut; `now` nur bei aktiven Zeit-Chips relevant.
- **Aufrufe von `visibleRows`:** heute mehrfach je Render (`ClusterView.tsx:64`, `kube-commands.ts:23`, Reducer `move`/`drill`/`keepSelection`). Mit Cache ist das unkritisch; trotzdem in `ClusterView` einmal mit `useMemo` auf `(state.rows, filter, sort, now)` berechnen und `rows` weiterreichen (passiert schon für `ResourceTable`).
- **Live-Zeilen:** alle 250 ms kommen Upserts; der Filter läuft dann neu. Bei 2 000 Pods × ~10 Felder ist das < 1 ms. Sortierung (Array-Sort mit Index-Stabilität) dominiert, nicht der Filter.
- **Zeit-Chips brauchen eine Uhr:** Der Reducer bleibt rein. `ResourceTable` hat heute einen 10-s-Tick für Alter (`ResourceTable.tsx:30-33`); der wandert nach `ClusterView` und dispatcht `{ type: 'tick', now }`. `visibleRows(state)` liest `state.now`. Tests setzen `now` explizit.
- **Verdeckte Auswahl:** `keepSelection` behandelt künftig „nicht mehr sichtbar“ wie „gelöscht“: Auswahl rückt an dieselbe sichtbare Position, sonst letzte Zeile, sonst `null`. Gilt für Rows-Events **und** für `search`/`toggleChip` (dort: Auswahl auf `null`, wenn die Zeile verschwindet; k9s macht es genauso). Damit zeigt das Dock nie ein Objekt, das in der Tabelle nicht zu sehen ist, und `Shift+F10` trifft immer eine sichtbare Zeile.
- **Sortierung + Filter:** Filter zuerst, dann Sortierung (heute so). „N von M“: N = sichtbare Zeilen, M = `state.rows.length` (alle Zeilen der Query, also schon nach Namespace/Selector). Containers-Modus zeigt keinen Zähler.
- **Usage-Zellen:** CPU/RAM der Pods liegen nicht in `cells` (nur `state.usage`), Nodes bekommen sie dekoriert in `session.ts:88-92`. Weder Suche noch Chips greifen darauf zu; in der Hilfe nicht als Feld nennen.
- **Events ohne `last`:** Zeit-Chips lassen sie heraus; Sortierung nach `last` setzt sie ans Ende (`compareValues` NaN-Regel, `kube-view.ts:248-255`).
- **Restore mit Chips und `selected`:** Die gespeicherte Auswahl kann vom gespeicherten Chip verdeckt sein; beim ersten Rows-Event greift die Sichtbarkeitsregel und verschiebt die Auswahl. Akzeptiert.
- **Snapshot-Flattern:** `snapshotOf` muss leere Filter auslassen, sonst feuert `onSnapshot` bei jedem Tastendruck in der Suche. Tippen erzeugt Snapshots pro Anschlag; das ist heute bei `selected` auch so und der Workspace-Writer ist entprellt. Prüfen, sonst `text` erst beim Schließen des Prompts in den Snapshot nehmen.
- **Status-Mengen an einer Stelle:** `BAD_STATES`/`WARN_STATES`/`MUTED_STATES` ziehen aus `rows.ts` nach `src/shared/kube-status.ts`; `rows.ts` importiert sie. Ein Test stellt sicher, dass jeder Status, den `podStatus` in den Fixtures erzeugt, in höchstens einen Status-Chip fällt und dass `tone === 'bad'` ⇔ Chip `failed`.
- **Main (b) in `rows.ts`:** `status.reason` für Phase Failed/Pending (Evicted, NodeLost, Shutdown, Preempting) vor der Phase; `Unknown` in `BAD_STATES`; Jobs-Status aus Conditions/`active`; `pressure` an der Node-Zeile. Alles mit Fixtures in `rows.test.ts`.
- **`!`-Negation und Phrasen** in `kube-menus.ts`-Einträgen: Menü-Texte, die in die Suche geschrieben werden (`app=api`, `owner:nightly`, `!owner:x`), bestehen nur aus `KUBE_NAME`/`LABEL_*`-Zeichen und brauchen keine Quotes.

---

## 6. Zerlegung in parallele Aufgaben (disjunkte Dateien)

| # | Aufgabe | Dateien | Abhängig von | Welle | Umfang |
|---|---|---|---|---|---|
| **T1** | **Filter-Modell (rein):** `KubeFilter`, Tokenizer/Parser, `compileFilter(kind, filter, now)`, `searchText(row)` mit WeakMap, `SEARCH_HELP`; Suchfelder/Qualifier je Kind | `src/shared/kube-filter.ts`, `src/shared/kube-filter.test.ts` | – | 1 | minimal |
| **T2** | **Status-Chips (rein):** `CHIPS[kind]` mit IDs, Labels, Gruppen, Prädikaten; Status-Mengen (`BAD_STATES` …) hier; `chipCounts(rows, text-matcher)`; Jobs-Spalte `status` in `KIND_COLUMNS` | `src/shared/kube-status.ts`, `src/shared/kube-status.test.ts`, `src/shared/kubernetes.ts` (Snapshot-Typ, Jobs-Spalte, `KubeRow.pressure`), `src/shared/kubernetes-schema.ts` (+ Test) | – | 1 | minimal |
| **T3** | **Main-Zeilen (b):** Status-Mengen aus T2 importieren; Pods `status.reason`/`Unknown`; Jobs `cells.status`; Nodes `pressure` | `src/main/kubernetes/rows.ts`, `src/main/kubernetes/rows.test.ts` | T2 | 2 | minimal (Jobs), Rest klein |
| **T4** | **Reducer:** `filters` je Kind, `now`/`tick`, Aktionen `search`/`toggleChip`/`setChips`/`clearFilter`, Regeln aus 4.1, `defaultSort`, `keepSelection` mit Sichtbarkeit, `snapshotOf`/`restore`, CronJob-Drill mit `owner:`; `visibleRows` über `compileFilter` | `src/renderer/src/kube-view.ts`, `kube-view.test.ts` | T1, T2 | 2 | minimal |
| **T5** | **Befehle und Hilfe:** `w`, `F`, `:filter`, `:status` mit Vervollständigung; Hilfe-Spalte „Suche“ aus `SEARCH_HELP` + `CHIPS[kind]` | `src/renderer/src/kube-commands.ts`, `kube-commands.test.ts`, `components/kubernetes/HelpOverlay.tsx` | T1, T2, T4 (Action-Typen) | 3 | minimal (`w`, `:status`), `F`/`:filter` klein |
| **T6** | **Menüs:** „Nur <Chip> anzeigen“, Hintergrund „Suche leeren“/„Status-Filter leeren“, CronJob `owner:`; Problem-Banner „In der Tabelle zeigen“ | `src/renderer/src/kube-menus.ts`, `kube-menus.test.ts`, `components/kubernetes/ProblemBanner.tsx` | T2, T4 | 3 | „Nur … anzeigen“ minimal, Rest extra |
| **T7** | **UI:** Chip-Leiste mit Zählern und „N von M“, Reiter-Punkt, Namespace-Spalte bei „alle“, Leer-Text mit „In allen Namespaces suchen“, Suchfeld (Placeholder, ×), `tick` nach `ClusterView`, `runKey` für neue Befehle, CSS | `components/kubernetes/ResourceTable.tsx`, `ClusterView.tsx`, `src/renderer/src/kubernetes-ui.css` | T4, T5 | 4 | minimal |
| **T8** | **Doku:** README-Absatz (Suche-Syntax, Chips, `w`), CHANGELOG 0.7.0, Spec-Updates (Tastentabelle, Events-Sortierung statt „Warnungen oben“, Kontextmenü-Spec Zeile „Label-Filter: genau ein key=value“ streichen) | `README.md`, `CHANGELOG.md`, beide Specs | Entscheidungen | 1 (Entwurf) / 5 (final) | minimal |

T1 und T2 sind absichtlich getrennt: der Parser ist reiner String-Code, die Chips sind Domänenwissen; beide haben eigene Tests und keine gemeinsame Datei. T4 ist der einzige Knoten, der beide braucht. T3 und T4 laufen parallel (Main vs. Renderer). T5 und T6 laufen parallel (Befehle vs. Menüs), T7 verdrahtet.

**Minimale erste Stufe (reicht für den Auftrag):** T1 (Freitext AND, Phrasen, `!`, `k=v`, Qualifier, `restarts>`/`count>`), T2 (alle Chips aus Abschnitt 2 ohne die „extra“-Zeilen), T3 nur Jobs-Status (Evicted/Unknown/pressure sind je fünf Zeilen, mitnehmen), T4 komplett, T5 `w` + `:status` + Hilfe-Spalte, T6 „Nur … anzeigen“ + Hintergrund, T7 ohne Reiter-Punkt, T8.

**Extras (nach der ersten Stufe):** Name-Highlighting, `age<10m`, „Rollout läuft“, Ingress „Ohne Adresse“, „Ähnliche ausblenden“, Problem-Banner „In der Tabelle zeigen“, Reiter-Punkt, `F`/`:filter`.

### Tests (Pflicht je Aufgabe)

- T1: Tokenizer (Quotes, Leerzeichen), jede Token-Form, unbekannter Qualifier als Text, Negation, Zahlenvergleiche inkl. ungültiger Zahl als Text, Events-Suche trifft `message` aber nicht `ref.name`, `owner:` exakt, Case-Insensitivity, leerer Text trifft alles.
- T2: jeder Chip mit Treffer- und Nicht-Treffer-Zeile; Pod-Status-Vollständigkeit (jeder Fixture-Status in höchstens einen Status-Chip; `tone bad` ⇔ `failed`); `chipCounts` ignoriert Chips, zählt nur über Text-Treffer; Zeit-Chips mit festem `now`; Snapshot-Schema akzeptiert alte Snapshots ohne `filters`.
- T3: Evicted → `Evicted`/bad; Unknown → bad; Job Running/Complete/Failed/Suspended/Pending aus Fixtures; Node `pressure`.
- T4: Filter bleibt beim Reiterwechsel je Reiter; `jump` leert Chips des Ziels; `drill` leert nur Text; Sichtbarkeitsregel der Auswahl bei Rows-Event und bei `toggleChip`; `defaultSort` Events; `restore` verwirft unbekannte Chip-IDs; `snapshotOf` lässt leere Filter weg; CronJob-Drill setzt `owner:`.
- T5: `w` und `F` eindeutig (bestehender Test), `:status` parst Liste/`alle`, Vervollständigung liefert nur IDs des aktuellen Reiters, Hilfe zeigt Qualifier des Reiters.
- T6: „Nur … anzeigen“ nur, wenn die Zeile in einen Chip fällt; Hintergrund-Einträge deaktiviert mit Begründung; Aktionslisten beginnen mit `select(row)` (C14).
- Manuell, nur lesend auf k8s: Chips in jedem Reiter, Zähler, Reiterwechsel hin und zurück, Workspace speichern/laden, `jump` aus dem Problem-Hinweis bei aktivem „Abgeschlossen“-Chip, Events `reason:backoff "back-off restarting"`.

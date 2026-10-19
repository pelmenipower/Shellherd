# Kubernetes – Spaltenfilter und Gruppierung – Design

Bindend ist `2026-10-18-kubernetes-column-filters-validation.md`.

Stand: 2026-10-18 · Erweitert „Suchen und Filtern“ (0.7.0) · Auslöser: Rückmeldung des Nutzers

> „Die Befehle oben rechts mit `/` will ich nicht haben. Ich will normale Tabellenfilter, z. B. beim Namen etwas eingeben und es filtern, oder Namespace. Auch Gruppierfunktionen wären hilfreich.“

## Ziel

Der Cluster-Tab filtert wie eine normale Tabelle: Unter jedem Spaltenkopf gibt es ein Filterfeld. Dazu kommt eine Auswahl „Gruppieren nach“, die die Tabelle in aufklappbare Gruppen mit Anzahl teilt. Die Befehlszeile oben rechts entfällt.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Befehlszeile oben rechts (`/`-Suche und `:`-Befehle) | **entfällt in der UI.** Das Eingabefeld und die Vorschlagsliste in `ClusterView` verschwinden. Hilfe-Overlay und `?` bleiben. |
| Taste `/` | fokussiert das Filterfeld der **Name**-Spalte (bei Events: **Meldung**). |
| Taste `:` | ohne Funktion. Der Registry-Eintrag entfällt, die Hilfe erwähnt keine `:`-Befehle mehr. `parseCommandLine` und `completions` dürfen bleiben, wenn Tests sie nutzen, werden aber nicht mehr aus der UI erreicht. |
| Filterzeile | eine zweite Kopfzeile in der Tabelle mit einem Feld je Spalte. Platzhalter „Filter …“, × zum Leeren. Die Zeile ist immer sichtbar. |
| Feldart je Spalte | **Text** (enthält, ohne Groß/Klein) für Text-Spalten. **Auswahl** (Liste der vorkommenden Werte plus „alle“) für Spalten mit wenigen Werten: Namespace, Status (Pods, Nodes, Jobs), Typ (Services, Events), Node, Rollen. **Zahl** mit `>3`, `>=3`, `<3`, `<=3`, `=3` oder einer reinen Zahl (= gleich) für `numeric`-Spalten (Restarts, Anzahl, Aktuell, Pods). **Alter**-Spalten mit `<10m`, `>1h`, `<2d` (Einheiten s, m, h, d). CPU/RAM-Spalten bekommen kein Feld. |
| Verknüpfung | Alle Spaltenfilter gelten zusammen (AND), dazu die Status-Chips (unverändert) und der vorhandene Suchtext. |
| Suchtext (0.7.0) | bleibt im Modell, weil Kontextmenüs ihn setzen (z. B. `app=api`, `owner:backup`). In der UI erscheint er als entfernbarer Chip „Filter: app=api ×“ am Anfang der Chip-Leiste. Ein Eingabefeld gibt es dafür nicht mehr. |
| Namespace-Spalte | Bei „alle Namespaces“ hat sie das Auswahlfeld. Wer dort einen Namespace wählt, filtert nur die Tabelle. Die Namespace-Auswahl in der Kopfzeile, also das Abo, bleibt davon getrennt und unverändert. |
| Gruppierung | Auswahl „Gruppieren nach“ rechts in der Chip-Leiste. Optionen je Reiter (unten). Gruppen erscheinen als eigene Kopfzeilen „▾ shop · 12“, sind per Klick auf- und zuklappbar und nach Name sortiert. Die Sortierung der Tabelle gilt innerhalb der Gruppen. Leere Werte stehen in der Gruppe „(ohne)“ am Ende. |
| Tastatur mit Gruppen | `j`/`k`/Pfeile überspringen Gruppenzeilen. Ist die Auswahl in einer zugeklappten Gruppe, klappt diese auf. „N von M“ zählt nur Ressourcen-Zeilen. |
| Persistenz | Spaltenfilter, Gruppierung und zugeklappte Gruppen gelten je Reiter. Sie bleiben beim Reiterwechsel erhalten und kommen in den Workspace-Snapshot. Die Snapshot-Grenzen sind: höchstens 12 Spaltenfilter, je höchstens 100 Zeichen, höchstens 50 zugeklappte Gruppen. Alte Snapshots bleiben gültig. |
| `F` | setzt Spaltenfilter, Suchtext und Chips des Reiters zurück. Die Gruppierung bleibt. |
| Zurücksetzen bei Navigation | `jump`, `drill` und `openQuery` leeren die Spaltenfilter des **Ziel**-Reiters, genau wie heute den Suchtext. So ist das Ziel immer sichtbar. |
| Leer-Text | „Keine Treffer für die Filter.“ mit Knopf „Filter zurücksetzen“, dazu wie bisher „In allen Namespaces suchen“. |

### Gruppieren-nach je Reiter

| Reiter | Optionen |
|---|---|
| Pods | keine · Namespace · Node · Status · Owner |
| Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingress | keine · Namespace |
| Nodes | keine · Status · Rollen |
| Events | keine · Namespace · Typ · Grund · Objekt-Art |

„Namespace“ ist nur bei „alle Namespaces“ auswählbar. In einem einzelnen Namespace ist die Option ausgegraut mit dem Hinweis „Nur bei allen Namespaces“. Owner nutzt `row.owner` und zeigt „Deployment api“. Objekt-Art nutzt `involved.kind`.

## Architektur

- Rein und getestet in `src/renderer/src/kube-columns.ts`:
  - `columnFilterKind(kind, column)`
  - `parseNumberFilter`, `parseAgeFilter`
  - `matchesColumnFilters(row, kind, filters, now)`
  - `columnValues(rows, column)` liefert die Werte für Auswahlfelder
  - `groupRows(rows, kind, groupBy, collapsed)` liefert die Liste aus Gruppen- und Ressourcen-Zeilen
  - `GROUP_OPTIONS[kind]`
- Reducer (`kube-view.ts`):
  - `KubeFilter` bekommt `columns?: Record<string, string>`
  - Pro Reiter neu: `groupBy?: string` und `collapsed?: string[]`
  - Neue Aktionen `setColumnFilter`, `setGroupBy`, `toggleGroup`
  - `visibleRows` berücksichtigt die Spaltenfilter
  - Die Tabelle rendert `groupRows(visibleRows(state), …)`
- UI:
  - `ResourceTable`: Filterzeile, Gruppenzeilen, Gruppieren-Auswahl, Chip „Filter: …“
  - `ClusterView`: Befehlszeile entfernen, `/` fokussiert das Name- bzw. Meldung-Feld
  - `kube-commands.ts`: `:`-Eintrag entfernen, `/` neu beschreiben als „Name filtern“
  - Hilfe: Abschnitt „Suche“ ersetzt durch „Filter“ (Spaltenfilter, Zahl- und Alter-Syntax, Chips, Gruppierung)
- Schema (`shared`): `KubeViewSnapshot` bekommt optionale Spaltenfilter, Gruppierung und zugeklappte Gruppen je Kind (zod `partialRecord`, mit den Grenzen oben).

## Tests

- `kube-columns.test.ts`:
  - jede Feldart
  - Zahl- und Alter-Syntax inklusive ungültiger Eingaben (ungültig gilt wie kein Filter)
  - `columnValues` liefert eindeutige, sortierte Werte
  - `groupRows`: Reihenfolge, „(ohne)“, zugeklappte Gruppe mit Anzahl, Sortierung innerhalb der Gruppe
- `kube-view.test.ts`:
  - Persistenz je Reiter
  - Snapshot mit alten Daten und über den Grenzen
  - `jump` und `drill` leeren die Spaltenfilter
  - `F`
  - Auswahl in einer zugeklappten Gruppe
  - `j`/`k` über Gruppenzeilen
- `kube-commands.test.ts`: `:` ist nicht mehr gebunden, `/` hat die neue Beschreibung, keine Taste ist doppelt belegt.
- Manuell: Name filtern, Namespace-Auswahl, Restarts `>3`, Alter `<10m`, nach Node gruppieren, Gruppe zuklappen, Reiter wechseln und zurück, Workspace speichern und laden.

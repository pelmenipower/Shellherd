# Kubernetes – Log-Ansicht, Kopieren, abhängige Filter – Design

Stand: 2026-10-18 · Auslöser: Rückmeldung des Nutzers mit Logs aus `pg-horizon-tst-1` (CloudNativePG, JSON-Zeilen)

> „Die Logs sind echt beschissen formatiert … genau wie eine Kopierfunktion jeweils bei Logs, Events, YAML und Describe. Filtere ich nach Namen, sollten die anderen Filter wie Namespace angepasst sein. Die Filter sollten auch alle gleich hoch sein.“

## 1. Treppen-Effekt in Logs (Fehler)

**Ursache:** Die Logs-API liefert Zeilen mit `\n`. Das Terminal (xterm) setzt bei `\n` den Cursor nur eine Zeile tiefer, nicht an den Anfang. Jede Zeile beginnt deshalb dort, wo die vorige endete. Shells sind nicht betroffen, weil das TTY dort `\r\n` liefert.

**Fix:** Im Main wird für die Modi `logs` und `previous` jedes `\n`, vor dem kein `\r` steht, zu `\r\n`. Das gilt auch für ein `\r` am Ende eines Chunks, auf das im nächsten Chunk ein `\n` folgt: Es entsteht kein doppeltes `\r`.

## 2. Log-Darstellung „Kompakt“ (Standard) und „Roh“

- `KubeTerminalTarget` bekommt `format?: 'compact' | 'raw'`. Fehlt der Wert, gilt `'compact'`. Das zod-Schema erlaubt genau diese zwei Werte.
- Reines Modul `src/main/kubernetes/log-format.ts`:

```ts
export class LogFormatter {
  constructor(format: 'compact' | 'raw');
  /** Bytes in, terminal text out (CRLF line ends); keeps a partial last line until the next chunk or flush. */
  feed(chunk: Buffer): string;
  flush(): string;
}
export function formatLogLine(line: string): string;   // compact form of one line, without line end
```

- **Kompakt** gilt für Zeilen, die als JSON-Objekt geparst werden können. Felder in dieser Reihenfolge:
  - **Zeit:** erster vorhandener Wert aus `ts`, `time`, `timestamp`, `@timestamp`, `record.log_time`. Ausgabe als `HH:MM:SS.mmm`, Datum nur, wenn es nicht der Tag der vorigen Zeile ist (dann `YYYY-MM-DD HH:MM:SS.mmm`). Ist der Wert nicht lesbar, steht er wörtlich da.
  - **Level:** erster vorhandener Wert aus `record.error_severity`, `level`, `severity`, `lvl`, in Großbuchstaben und auf 5 Zeichen gepolstert. ANSI-Farbe: ERROR, FATAL, PANIC rot; WARN, WARNING gelb; INFO, LOG ohne Farbe; DEBUG grau.
  - **Meldung:** erster vorhandener Wert aus `record.message`, `msg`, `message`.
  - **Rest:** Zusatzfelder grau als ` key=value`, höchstens 6, in dieser Reihenfolge, nur wenn vorhanden und nicht leer:
    - `record.sql_state_code`, sofern nicht `00000`
    - `record.user_name`, `record.database_name`
    - `record.query` (gekürzt auf 200 Zeichen)
    - `logger`
    - `logging_pod`
  - **Fehler-Zeilen:** Bei SQL-State ≠ `00000` wird die ganze Zeile rot.
- Keine JSON-Zeile oder kein Feld erkannt: Die Zeile bleibt unverändert.
- **Roh:** nur die CRLF-Korrektur aus Abschnitt 1.
- Ein Zeitstempel-Präfix, den der Server in **kein** JSON einbettet, gibt es nicht, denn `timestamps: false` bleibt.

## 3. Kopieren im unteren Bereich

- Die Dock-Leiste bekommt rechts einen Knopf **„Kopieren“**, der für jeden Modus sichtbar ist:
  - **Logs, vorherige Logs, Shell:** kopiert den gesamten Puffer des Dock-Terminals als reinen Text, ohne ANSI. Umbrochene Zeilen werden wieder zu einer Zeile zusammengefügt (`isWrapped`), höchstens 5000 Zeilen, Leerzeilen am Ende entfernt.
  - **YAML, Describe:** kopiert den angezeigten Text, also bereits maskiert.
  - **Events:** kopiert die Tabelle als TSV mit Kopfzeile `Typ	Grund	Objekt	Meldung	Anzahl	Zuletzt`.
- Die Rückmeldung läuft über die vorhandene Statuszeile. Bei mehrzeiligem Text lautet sie „Kopiert: Logs (123 Zeilen)“, gleich für YAML, Describe und Events. Bei einem Fehler lautet sie „Kopieren fehlgeschlagen.“.
- Ist nichts zu kopieren, ist der Knopf deaktiviert mit `title` „Nichts zu kopieren.“.
- Neben „Kopieren“ steht bei Logs und vorherigen Logs der Umschalter **„Kompakt / Roh“**. Ein Wechsel startet den Stream neu, weil das Format Teil des Terminal-Keys ist. Die Wahl gilt je Cluster-Tab und kommt in den Workspace-Snapshot als optionales `logFormat`.

## 4. Abhängige Filter (Facetten)

- Die Werteliste eines Auswahl-Filters berechnet sich aus den Zeilen, die **alle anderen** Filter erfüllen: Spaltenfilter außer dem eigenen, Status-Chips und Suchtext.
- Der eigene aktuell gewählte Wert bleibt in der Liste, auch wenn er keine Treffer mehr hat. Dann steht dahinter „(0)“.
- Jede Option zeigt ihre Anzahl, etwa „shop (12)“. Die Anzahl gilt unter den anderen Filtern.
- Rein und getestet in `kube-columns.ts`: `facetValues(rows, kind, column, filters, now, otherPredicate) → { value, label, count }[]`, wobei `otherPredicate` Chips und Suchtext prüft.

## 5. Einheitliche Höhe der Filterfelder

- Alle Felder der Filterzeile (Text, Auswahl, Zahl, Alter) haben dieselbe Höhe: `height: 24px`, `box-sizing: border-box`, gleiche Polsterung, Rahmen und Schriftgröße. Auch der ×-Knopf liegt innerhalb dieser Höhe.
- Spalten ohne Feld (CPU, RAM) bekommen einen leeren Platzhalter in gleicher Höhe, damit die Zeile nicht springt.

## Tests

- `log-format.test.ts`:
  - CRLF über Chunk-Grenzen, ein `\r` am Chunk-Ende
  - CNPG-Zeile aus dem Nutzer-Log: ergibt `09:06:50.227 LOG   checkpoint starting: time` plus graue Felder
  - die ERROR-Zeile mit `42P01` ist rot und enthält `sql_state=42P01` sowie die Query
  - Datumswechsel
  - keine JSON-Zeile bleibt unverändert, Roh-Modus
  - halbe Zeile bis `flush`
- Schema: `format` mit `compact`, `raw`, ohne Wert, ungültigem Wert. `logFormat` im Snapshot.
- `kube-columns.test.ts`: `facetValues` mit Namensfilter, eigener Wert bleibt mit 0, Anzahlen, Chips wirken.
- Renderer: TSV-Bauer für Events und das Zusammenfügen umbrochener Zeilen als reine Funktionen getestet.
- Manuell: `pg-horizon-tst-1` mit Logs öffnen, zwischen Kompakt und Roh wechseln, jeden Modus kopieren, nach Name filtern und die Namespace-Liste prüfen, gleiche Höhe der Filterfelder.

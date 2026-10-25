# SFTP-Komfort – Nachprüfung Runde 2

Grundlage:
- Review `2026-10-25-sftp-komfort-review.md`
- Ledger `.superpowers/sdd/2026-10-25-sftp-komfort/progress.md` (Ruling: M-2 akzeptiert, `C:/x` wird im Main weiter abgelehnt)
- Fix-Diff `HEAD~2..HEAD`: `ca94857` (I-1) und `b7f22b6` (I-2, M-1, M-3, M-4, M-5)

**Urteil: ready** – 7 Befunde geprüft: 6 ADDRESSED, 1 ACCEPTED, 0 NOT ADDRESSED. Neu: 0 Critical, 0 Important, 1 Minor.

Gates: `npm run typecheck` ist grün. `npx vitest run` ist grün mit 2398/2398, 6 Tests mehr als im Review (2392).

---

## Befundtabelle

| Befund | Status | Beleg |
|---|---|---|
| I-1 Gerätepfade mit Schrägstrich | ADDRESSED | `schema.ts:50` prüft jetzt `\\\\(?![?.](?:[\\/]\|$))`. `ipc.ts:42-46` `localListPath` prüft den Wert nach `win32.resolve` noch einmal, `ipc.ts:132` nutzt ihn. Tests: `file-system.test.ts:10-22`, `schema.test.ts:219-223`. Details unten. |
| I-2 lokale Namensprüfung case-sensitiv | ADDRESSED | `file-browser.ts:81-86` `nameTaken`: lokal über `foldCase`, auf dem Server exakt. Ein reiner Case-Wechsel von `original` ist erlaubt. `FilePane.tsx:140` gilt für alle drei Prompt-Arten (Ordner, Datei, Umbenennen). Tests: `file-browser.test.ts:137-154`. Details und Restrisiko unten. |
| M-1 Drag nimmt `selected` ungefiltert | ADDRESSED | `FilePane.tsx:216`: `selected.filter(n => names.includes(n))`. |
| M-2 neue Punkt-Datei verschwindet | ACCEPTED | Ruling im Ledger: Die Fußzeile zeigt „· 1 ausgeblendet“. Keine Sicherheitsfrage. |
| M-3 `\x` auf einer Freigabe | ADDRESSED | `file-browser.ts:115-119` nimmt bei UNC-`current` `\\server\share` als Wurzel. Tests in `file-browser.test.ts:123-127`: `\x`, `\` und der Laufwerksfall. |
| M-4 veraltete Antwort, Blur beim Warten | ADDRESSED | `GoToResult = 'ok' \| 'stale' \| { error }` (`FilePane.tsx:18`, `FilesPanel.tsx:107-124`). „stale“ ändert nichts. Fehler und Erfolg wirken nur, solange dasselbe Feld mit demselben Wert offen ist (`FilePane.tsx:127-132`). Ein Feld, das per Blur geschlossen wurde, öffnet sich nicht wieder. Rest siehe N-1. |
| M-5 keine Tests für die Namensprüfung | ADDRESSED | `nameTaken` ist eine reine Funktion mit Tests. Wer in `FilePane` `allNames` gegen `names` tauscht, bleibt allerdings weiter ohne Komponententest grün. Der Doc-Kommentar (`file-browser.ts:80`) nennt die Pflicht „every entry, hidden ones too“. Für einen Minor reicht das. |

---

## I-1 im Detail

Die Kette wurde mit Node 24.20 (`win32.resolve`) und `GetFullPathNameW` (P/Invoke) auf dieser Maschine durchgespielt.

| Eingabe | Regex roh | nach `resolve` | Regex danach | Ergebnis |
|---|---|---|---|---|
| `\\?\UNC\s\x`, `\\?\unc\s\x`, `\\?/UNC/s/x` | nein | `\\?\UNC\…` | nein | abgelehnt |
| `\\?\GLOBALROOT\Device` | nein | unverändert | nein | abgelehnt |
| `\??\C:\x` | nein (ein Backslash am Anfang) | `C:\??\C:\x` | ja | abgelehnt durch das Schema. Nach `resolve` wäre es ohnehin ein gewöhnlicher Ordner auf C:, kein NT-Pfad. |
| `\/?/C:/x`, `/\?\C:\x` | nein | `\\?\C:\x` | nein | abgelehnt |
| `\\.\..\x`, `\\.\\x` | nein | `\\.\x` | nein | abgelehnt |
| `\\server\..\?\x`, `\\..\?\x`, `\\server\.\?\x` | ja | unverändert | ja | durchgelassen, aber **kein Gerätepfad**. `GetFullPathNameW` lässt die UNC-Wurzel `\\server\..` stehen (Ausgabe identisch). Der Pfad ist eine Freigabe namens `..` bzw. `.` auf dem Server `server` und wird vom SMB-Server abgewiesen. |
| `\\server\share\..\..\.\pipe` | ja | `\\server\share\pipe` | ja | UNC, harmlos |
| `\\? \x`, `\\.x\y` | ja | UNC mit Server `? ` bzw. `.x` | ja | kein Gerätepräfix: `RtlDetermineDosPathNameType` verlangt an Stelle 4 einen Trenner |
| `\\?`, `\\.`, `\\?\\`, `\\.\` | nein | `C:\?`, `C:\` | ja | abgelehnt durch das Schema |

Groß- und Kleinschreibung spielt keine Rolle. `UNC` und `GLOBALROOT` stehen erst hinter dem Präfix `\\?\`, und schon das Präfix wird abgelehnt.

**Auto-Upload-Watcher** (`auto-upload.ts:93,96`): Er ruft `lstat(binding.localPath)` mit dem Rohwert auf und danach `realpath(win32.resolve(…))`. Der Rohwert ist durch `AutoUploadBindingSchema` (`schema.ts:55`) an dieselbe Regex gebunden. Diese verlangt `X:\` oder `\\` mit einem Zeichen nach `?`/`.`, das weder Trenner noch Ende ist. Damit kann Windows den Rohwert nicht als Local-Device- oder Root-Local-Device-Pfad lesen. Einen Präfix `\??\` gibt es nicht, weil der Wert mit zwei Backslashes oder einem Laufwerk beginnen muss.

Die Fälle, in denen erst `resolve` ein Gerät erzeugt (`\\?/…`, `/\?\…`), scheitern schon an der Roh-Regex. Node setzt in `fs` zusätzlich `toNamespacedPath` ein. Bei einem aufgelösten Laufwerks- oder UNC-Pfad wird daraus `\\?\C:\…` bzw. `\\?\UNC\…`, also kein neues Ziel. Die Schema-Prüfung reicht dort. Ein zweiter Check nach `resolve` im Watcher wäre reine Verteidigung in der Tiefe und ist nicht nötig.

Die übrigen lokalen Kanäle (`LocalPathSchema`, Rename, Delete, Open, Transfer) prüfen nur `win32.isAbsolute`. Sie bekommen aber keine getippten Pfade, sondern solche, die der Main selbst gelistet hat (aus `localList`/`localPlaces`). Das war schon vor dem Paket so und liegt außerhalb dieses Fix-Diffs.

## I-2 im Detail

**Abdeckung.** `nameTaken` ist die einzige Stelle im Renderer, an der ein vom Nutzer getippter Name gegen die Liste geprüft wird (`grep allNames|nameTaken`). Sie gilt für Shift+F4 (Datei), F7 (Ordner) und F2 (Umbenennen).

Kopieren, Verschieben, Upload, Download und Drag laufen über `transfer.ts:100,125`. Dort prüft `to.stat(target)` gegen das echte Dateisystem. Lokal ist NTFS case-insensitiv, `stat('.ENV')` findet also `.env`, und der Konfliktdialog greift. Für Server-Ziele gilt die Semantik des Servers. Eine Namensliste im Renderer spielt bei Übertragungen keine Rolle.

**Restrisiko `foldCase` gegen die NTFS-Upcase-Tabelle.** `foldCase` ist `toLocaleLowerCase(de|en)`. NTFS vergleicht über die einfache Großschreibung aus `$UpCase`.

- **Falsch positiv (harmlos, Name wird unnötig abgelehnt):** `ẞ` (U+1E9E) gegen `ß`, das Kelvin-Zeichen `K` (U+212A) gegen `k`, außerdem Ordner mit aktivierter Groß-/Kleinschreibung pro Verzeichnis (WSL).
- **Falsch negativ (stilles Ersetzen möglich):** Zeichen, die NTFS gleich großschreibt, die `toLowerCase` aber verschieden lässt. Beispiel: das griechische Schluss-Sigma `ς` gegen `σ`, beide werden zu `Σ`. `.ας` → `.ασ` würde ein verstecktes `.ας` ersetzen. Das ist sehr exotisch und erfordert einen griechischen Namen mit Schluss-Sigma an derselben Stelle. Es wird hier nur benannt, kein Befund.
- Keine Unicode-Normalisierung: NTFS normalisiert NFC/NFD nicht, `foldCase` auch nicht. Das ist konsistent.

---

## Neue Befunde (nur Fix-Diff)

### Critical
Keine.

### Important
Keine.

### Minor

**N-1 Erfolgreiches „Gehe zu“ nach Blur holt den Fokus zurück in die Liste** – `src/renderer/src/components/FilePane.tsx:132`
- Szenario: Der Nutzer bestätigt einen langsamen Pfad (Netzwerkfreigabe) mit Enter und klickt währenddessen ins Terminal. Das Feld schließt per Blur. Kommt `'ok'`, bleibt das Feld zwar geschlossen, aber `listRef.current?.focus()` läuft trotzdem. Die nächsten Tastendrücke landen in der Dateiliste statt im Terminal, Type-to-jump und Entf eingeschlossen. Entf öffnet nur den Löschdialog und löscht nicht direkt.
- Das Verhalten bestand schon vor dem Fix. Der neue Kommentar „closed meanwhile (blur) stays closed“ deckt den Fokus aber nicht ab.
- Fix-Richtung: Fokus nur setzen, wenn das Feld noch offen war. Zum Beispiel ein Flag im Updater von `setPathField` setzen oder einen `pathFieldRef` prüfen: `if (wasOpen) listRef.current?.focus();`.

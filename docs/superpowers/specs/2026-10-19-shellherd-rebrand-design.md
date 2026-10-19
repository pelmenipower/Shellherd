# Rebranding Terminus → Shellherd – Design

Stand: 2026-10-19 · Branch `claude/feature/shellherd-rebrand` (gestapelt auf `claude/fix/kube-logs-test-wait`, PR #20) · Version 0.10.0

> „wir machen ein rebranding von terminus zu Shellherd. da sind die icon baue diese ein. überall da wo es notwendig ist.“

Bindend sind die Fundstellen-Tabelle, die Migrations- und Icon-Entscheidungen, die Tests und die Tasks aus dem Plan `docs/superpowers/plans/2026-10-19-shellherd-rebrand.md` (Recherche, wörtlich übernommen). Bei einem Widerspruch gilt diese Spec.

## Ziel

- Überall, wo Nutzer den Namen sehen, steht **Shellherd**: Fenstertitel, App-Kopf, Willkommen, Dialoge, Release-Notes, KI-Prompt, Paketname/`productName`, README, Designsystem-Doku.
- Das Icon (Berner Sennenhund mit Prompt) erscheint als Fenster- und Taskleisten-Icon, als Icon der Vault-Dateizuordnung und im App-Kopf sowie auf der Willkommensseite.
- Bestehende Nutzer verlieren nichts. Bekannte Host-Schlüssel und der zuletzt geöffnete Vault werden übernommen, und alte Vault-Dateien öffnen weiter.

## Rulings

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| R1 | **Vault-Format unverändert:** `terminus-vault`, `terminus-encrypted-vault`, das AAD `terminus-encrypted-vault:v1` und die Endungen `.term`/`.terminus` bleiben. | Das AAD geht in den GCM-Tag ein. Jede Änderung macht bestehende Vaults unlesbar. | Der alte Name bleibt im Dateiformat sichtbar. |
| R2 | **userData:** Fehlen `known-hosts.json` und `last-vault.json` im neuen `%APPDATA%\Shellherd`, werden sie einmalig aus `%APPDATA%\Terminus` kopiert, bevor `createKnownHosts()` läuft. Nie verschieben, nie löschen. | `known-hosts.json` ist sicherheitsrelevant. Ohne Kopie würde jeder Host-Schlüssel neu abgefragt (TOFU-Reset). | Ein alter Ordner bleibt liegen. |
| R3 | Icons entstehen aus dem Master `shellherd-app-icon.png`: Die hellen Ecken werden per Electron `nativeImage` mit einer Rundeck-Maske freigestellt. Ein eigener kleiner ICO-Writer ohne neue Pakete erzeugt `icon.ico` (16/24/32/48/64/256), `icon.png` und eine Marke für den Renderer. Die erzeugten Dateien und das Skript werden versioniert, das ZIP nicht. | Die kleinen PNGs sind uneinheitlich beschnitten (gemessen). Laut Vorgabe des Nutzers keine neuen Installationen. | Das Skript lässt sich jederzeit neu laufen lassen. |
| R4 | Neue Windows-ProgID `Shellherd.Vault` und `AppUserModelId` `com.pelmenipower.shellherd`. Registrieren und Abmelden räumen `Terminus.Vault` ab. | eigene Identität in der Taskleiste und bei der Dateizuordnung | Eine Neuzuordnung durch den Nutzer kann nötig sein. |
| R5 | Der RDP-Helfer heißt `native/Shellherd.RdpHost`, die Exe `Shellherd.RdpHost.exe`, die Env-Variablen `SHELLHERD_RDP_*`. Auch localStorage-Keys, MIME-Typen und den k8s-`fieldManager` benennen wir um. | sichtbare oder technische Marke ohne Bestandswert | Lokale UI-Vorlieben (localStorage) werden einmal zurückgesetzt. |
| R6 | sudo-Marker `[terminus-…]` und historische Specs/Pläne/CHANGELOG-Einträge bleiben. | kein Nutzerwert, Historie bleibt wahr | keine |
| R7 | **Version 0.10.0**, neuer CHANGELOG-Abschnitt. | Rebranding ist eine sichtbare, eigene Veröffentlichung. | keine |
| R8 | Die CLAUDE.md und die Agenten-Texte liegen auf `claude/docs/feature-pipeline`. Sie werden dort in einem eigenen Doku-Commit umbenannt, nicht auf diesem Branch. | ein Branch, ein Zweck | keine |
| R9 | Das Repo-Verzeichnis `C:\workspace\Terminus` und interne Branch-Namen bleiben. | keine Wirkung auf die App | keine |

# SFTP-Eintrag je Host und Container-Shell als Tab – Design

Stand: 2026-11-15 · Branch `claude/feature/docker-sftp-tabs` (von `staging` ab529ce, eigener PR gegen `staging`)
Grundlage: Konzept `.superpowers/sdd/2026-11-15-docker-sftp-tabs-research.md` („K“). Diese Spec übernimmt K als verbindlichen Entwurf; Abschnittsverweise „K §x“ zählen als Teil der Spec.

## Ziel

Nutzerwunsch: Unter jedem Host (z. B. neben „Docker-Ansicht“) soll automatisch SFTP erscheinen, damit man nicht erst eine SSH-Sitzung öffnen muss; der Weg SSH → SFTP bleibt. Die Shell eines Containers soll auch als Tab geöffnet werden können.

## Bereits erledigt (Vorab-Fix, Commit 3ea07d3)

Drop-Hinweis „Eine .term-Datei hier loslassen …“ blieb nach einem Drop auf SFTP-Serverseite/Vault-Baum stehen (beide stoppen die Propagation). Fix: Zurücksetzen in der Capture-Phase am Fenster; Szene `file-drop`.

## Umfang Stufe 1 (verbindlich)

- **R-DS-1 Dateiansicht als Kind jedes SSH-Hosts** nach K (Feature 1): statisches erstes Kind in `ContainerChildren.tsx`, keine SFTP-Probe, keine Main-Änderung; Klick/Enter fokussiert einen offenen Dateien-Tab desselben Hosts oder öffnet einen; Kontextmenü „Dateiansicht öffnen“ öffnet einen neuen. Fehlerfälle über die vorhandene Fehlerkarte (`files.noSftp`, Auth). Kein Eintrag unter „Dieser Computer“.
- **R-DS-2 Bestehende Wege unverändert:** Host-Menü „Dateien öffnen (SFTP)“ und Bereichskopf-Knopf bleiben wie sie sind.
- **R-DS-3 Container-Shell als Tab sichtbar machen** nach K (Feature 2): Die Funktion existiert (Zeilenmenü, Dock-Knopf, Strg+Umschalt+T); Stufe 1 ergänzt einen Knopf „Shell als Tab öffnen“ im Arm-Platzhalter des Docks mit vorhandenem Key. Der Arm-Schutz des Docks bleibt unverändert (Tab ist eine explizite Einzelaktion wie bei Kube/Proxmox).
- **R-DS-4 Nachweis:** SSH-Fake beantwortet `docker exec` mit einer Echo-Shell; Szenen `files-entry` und `container-shell-tab`; Handbuch und README-Zeile.

## Rulings

- **Keine Versionserhöhung, kein CHANGELOG** — AGENTS.md — Kosten: Nutzer ergänzt beim Release.
- **Keine SFTP-Probe vor dem Anzeigen** — Eintrag immer für SSH-Hosts; ein Host ohne SFTP zeigt beim Öffnen die vorhandene Fehlerkarte — Kosten: ein Eintrag, der bei manchen Hosts nur einen Fehler liefert.
- **Feature 2 nur Sichtbarkeit** — die Funktion existiert dreifach; der Nutzer hat sie nicht gefunden — Kosten: keine.

## Nicht-Ziele

Extras aus K (Bereichs-Picker, Strg+Doppelklick-Shell, persistente Aufklapp-Zustände, lokaler Dateien-Eintrag). Keine Main-/IPC-Änderungen.

## Wellen

Nach K (W1 T1–T5, W2 T6–T7), bindend in der Fassung der Validierung.

## Abnahme

`npm run typecheck`, `npx vitest run`, Szenen `file-drop`, `files-entry`, `container-shell-tab`, `containers`, `sftp` grün; Screenshots angesehen.

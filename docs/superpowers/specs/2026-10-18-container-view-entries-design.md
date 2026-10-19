# Laufzeit-Einträge statt Container-Listen in der Seitenleiste – Design

Stand: 2026-10-18 · Branch `claude/feature/container-view-entries` (gestapelt auf `claude/feature/container-view`, PR #13) · Version bleibt 0.9.0 (unveröffentlicht)

> „beim aufklappen eines ssh verbindung sollte nicht die docker und container augeklappt werden. sonder man kann sowas haben wie "docker ansicht" "podmanansicht" das wäre viel eleganter und darüber gelangt man zur UI. keine notwendigkeit mehr die container zu listen“

Bindend sind die Abschnitte 2 (Entscheidungen E1–E9), 3 (Zustände und wörtliche Texte), 4 (Vertrag), 5 (Regeln) und 6 (Tasks) aus dem Plan `docs/superpowers/plans/2026-10-18-container-view-entries.md` (Recherche, wörtlich übernommen). Diese Spec fasst sie zusammen und trifft die Rulings. Bei einem Widerspruch gilt diese Spec.

## 1. Ziel

- Klappt man eine SSH-Verbindung auf, läuft nur noch die Probe (`has:docker/podman/pct/qm`, ohne sudo). Darunter stehen je gefundener Laufzeit ein Eintrag **„Docker-Ansicht“** bzw. **„Podman-Ansicht“**, danach die Proxmox-Gruppen wie heute.
- Ein Klick oder `Enter` auf einen Eintrag fokussiert einen offenen Tab dieses Hosts mit dieser Laufzeit. Gibt es keinen, öffnet er die Container-Ansicht mit fester Laufzeit. Der Tab heißt `<Host> · Docker` bzw. `<Host> · Podman`.
- Unter „Dieser Computer“ gilt dasselbe. Lokal ist die Probe `docker --version` bzw. `podman --version`.
- Docker- und Podman-Container erscheinen nicht mehr in der Seitenleiste. Die Seitenleiste führt keinen Docker- oder Podman-Befehl mehr aus.

## 2. Rulings

| # | Ruling | Warum | Kosten, falls falsch |
|---|---|---|---|
| S1 | Die Probe bleibt beim Aufklappen (E1). | Ohne Probe stünden Einträge unter jedem Host (Router, Jump-Hosts), und Proxmox wäre nicht erkennbar. Die Probe ist ein einziges `sh -c` ohne sudo. | keine |
| S2 | **Proxmox LXC und VMs bleiben als Liste** mit Menü, Doppelklick-Shell und der Rückfrage beim harten Stopp (E2). | Es gibt keine Proxmox-Ansicht. Ein Eintrag ohne Ziel wäre eine Sackgasse. Der Nutzer verliert nichts. | Später eine Proxmox-Ansicht (Extra) |
| S3 | Die Laufzeit steht als eigenes Feld `TabConnection.runtime?` im Tab, nicht in `view` kodiert (E4). Der Workspace speichert `containerViews: (number \| { index, runtime })[]` ohne Migration (E5). | Alle `view`-Vergleiche bleiben gültig, alte Workspaces aus PR #13 laden weiter. | gering |
| S4 | Eine Ansicht mit fester Laufzeit hat keinen Umschalter. Liefert Main eine andere Laufzeit, zeigt sie einen Fehler statt die falschen Daten (E6). | Ein Tab „srv · Podman“, der Docker-Container zeigt, wäre falsch. | keine |
| S5 | Ein Eintrag in der Seitenleiste fokussiert einen offenen Tab (E3). Einen zweiten Tab öffnet nur das Kontextmenü, über „Container-Ansicht öffnen“ am Host (frei, mit Umschalter) bzw. „Docker-Ansicht öffnen“ am Eintrag. | Die Seitenleiste dient der Navigation. Zwei Tabs würden doppelt pollen. | ein Klick mehr für einen zweiten Tab |
| S6 | „Dieser Computer“ erscheint, sobald die CLI installiert ist, auch wenn der Dienst nicht läuft. Der Fehler zeigt sich dann in der Ansicht (E1). | Gleiches Kriterium wie bei SSH. Kein Daemon-Kontakt beim Aufklappen. | Ein Abschnitt kann ins Leere führen, die Ansicht zeigt den Grund. |
| S7 | Toter Code wird entfernt: Container-Zeilen und ihr Menü, der Container-Zweig von `itemCommands`, `parseContainerList`, `listArgv('docker'\|'podman')`. Bleiben: `ContainerTarget`, `TerminalTargetSchema`, `containerTabs`, `openContainer`, `containerConnection`, Kanal `containers:list` (E8). | Dock, Popout, Proxmox und alte Workspaces brauchen sie. | keine |
| S8 | Keine neue Version. CHANGELOG 0.9.0 wird ergänzt (E9). | 0.9.0 ist unveröffentlicht, die PRs sind gestapelt. | Wird #13 allein veröffentlicht, fehlt nichts, denn der Eintrag lebt nur auf diesem Branch. |
| S9 | Weder Kube-Dateien noch `session.ts`, `TerminalPanel.tsx`, Container-IPC-Schemas oder `inventory-parsers.ts` werden verändert. | Kleiner Umbau, keine Wechselwirkung mit PR #13. | keine |

## 3. Zustände der Seitenleiste

Wörtlich laut Plan Abschnitt 3: „Suche Laufzeiten …“, „Aktualisiere …“, die Fehlermeldung mit „Erneut versuchen“, „Docker-Ansicht“ und „Podman-Ansicht“ (Tooltip „Container, Images, Volumes und Netzwerke von `<Host>` (Docker)“), die Proxmox-Gruppen samt Problemzeile wie heute und „Keine Container-Laufzeit gefunden.“

Menüs: Das SSH-Knotenmenü ersetzt „Container anzeigen“ durch „Laufzeiten anzeigen“. Im Hintergrund wird „Lokale Container suchen“ zu „Lokale Laufzeiten suchen“. „Container-Ansicht öffnen“ und „Lokale Container-Ansicht öffnen“ bleiben. Das Eintragsmenü hat „Docker-Ansicht öffnen“ bzw. „Podman-Ansicht öffnen“ und „Aktualisieren“.

Fehlertext in der Ansicht bei fester Laufzeit, die fehlt: „Docker wurde auf diesem Host nicht gefunden.“ bzw. „Podman wurde auf diesem Host nicht gefunden.“, mit „Erneut versuchen“.

## 4. Vertrag, Wellen, Tests

Vertrag: Plan Abschnitt 4.1–4.9. Wellen und Tests: Plan Abschnitt 6 (T1–T8 in vier Wellen). Gate nach jeder Welle: `npm run typecheck` und `npx vitest run`.

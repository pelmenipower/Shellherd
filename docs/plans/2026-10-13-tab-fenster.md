# Tabs abdocken und zwischen Fenstern verschieben

**Stand 13.10.2026 · Branch `claude/feature/connection-types`**

## Entscheidungen

- Abgedockte Fenster zeigen den Arbeitsbereich ohne Sidebar: Tabs, Teilen, Docken, Maximieren, **+**, Tastenmenü.
- Schließen eines abgedockten Fensters verschiebt seine Tabs ohne Neuaufbau ins Hauptfenster.
- Workspaces speichern alle Fenster mit Layout, Position und Größe.

## Architektur

- **Jedes Fenster besitzt seine Tabs und sein Layout selbst** (wie bisher). Das Hauptfenster bleibt zuständig für Vault, Sidebar, Editor und Workspaces.
- **Sitzungen wechseln den Besitzer statt neu zu verbinden.** Der Main-Prozess überträgt die Besitzerprüfung (`ownerId`) einer SSH-/Shell- oder RDP-Sitzung auf das Zielfenster.
  - Terminal: Das Quellfenster serialisiert den xterm-Inhalt (`@xterm/addon-serialize`), das Zielfenster stellt ihn wieder her. Ausstehende Flusskontroll-Bestätigungen werden beim Wechsel zurückgesetzt.
  - RDP: Der Helfer setzt den Besitzer der RDP-Fläche auf das neue Fenster (`GWLP_HWNDPARENT`); die Position kommt vom neuen `RdpPanel`.
- **Ziehen über Fenstergrenzen:** Während eines Tab-Drags meldet das Quellfenster Bildschirmkoordinaten an den Main-Prozess. Dieser bestimmt das Fenster unter dem Zeiger und schickt ihm Hover-Positionen für die Dock-Vorschau. Loslassen über einem Fenster dockt dort an; außerhalb aller Fenster entsteht ein neues Fenster an der Zeigerposition.
- Abgedockte Fenster erhalten nur Verbindungsmetadaten ohne Passwörter/Schlüssel (für **+**).
- Vault sperren schließt alle abgedockten Fenster und beendet alle Sitzungen. Ein leeres abgedocktes Fenster schließt sich.

## Schritte

1. Fensterverwaltung im Main-Prozess, Rolle des Renderers (Haupt/abgedockt), bereinigte Verbindungsliste.
2. Besitzerwechsel für Sitzungen (SSH/Shell, RDP) und Übernahme im Zielfenster.
3. Ziehen aus dem Fenster und zwischen Fenstern mit Vorschau.
4. Schließen abgedockter Fenster → Tabs zurück; leere Fenster schließen.
5. Workspaces mit Fenstern.

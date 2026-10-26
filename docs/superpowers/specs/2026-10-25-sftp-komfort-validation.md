# SFTP-Komfort – Validierung (bindend)

Urteil: **ready**. 0 Blocker, 2 Rulings. Alles gilt aus der Spec `2026-10-25-sftp-komfort-design.md` wörtlich (Rulings 2, Vertrag 3, Zerlegung 4, Doku 5, Demo 6, Nicht-Ziele 7).

## Rulings

- **R-A Ziehen in den Explorer: nicht in diesem Paket.** Der Nutzer hat es verlangt; es wird ausgelassen, weil `webContents.startDrag` beim Ziehstart eine fertige lokale Datei braucht und der Ablageordner unbekannt bleibt. Damit greifen die bindenden Download-Regeln aus 0.12.1 (nur in den gewählten Ordner, `.part`, Konfliktfrage, unsichere Namen) nicht. Dem Nutzer im Bericht ausdrücklich nennen, mit der vorhandenen Alternative (lokalen Zielordner mit Strg+L wählen, F5).
- **R-B Sicherheit bei Filter und Ausblenden:** Auswahl, F5/F6, Entf, Strg+A und Ziehen wirken nur auf sichtbare Einträge; Namensprüfungen (Neu, Umbenennen) laufen gegen alle Einträge (Spec 2.3). Das ist Pflicht und wird im Review geprüft.

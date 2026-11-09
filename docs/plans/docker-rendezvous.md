# Docker-Server und Rendezvous

Ziel: Ein selbst betreibbarer Server speichert den bestehenden Konto-Hash und
verschlüsselte Vault-Versionen und vermittelt explizit freigegebene Sitzungen.
Der Server erhält keine privaten Endgeräteschlüssel oder Vault-Passwörter.

Stand 2026-11-06: Schritte 1–6 implementiert. Dockerimage gebaut und mit
`scripts/check-server-container.mjs` geprüft: Anmeldung, UID 1000 mit
schreibgeschütztem Root-Dateisystem, E2EE-Signalisierung, Containerwechsel,
Verwerfen alter Token, Backup/Restore in ein frisches Volume und Kontorotation.
Die Server-Rendezvous-Tests prüfen zusätzlich Manipulation, Zustimmung, Ablauf,
Teilnehmertrennung, Limits und verlorene HTTP-Bestätigungen. Betriebshinweise
stehen in `server/README.md`. Kein produktiver Desktop-Agent oder unabhängiger
Sicherheitsreview wird dadurch behauptet.

Stand 2026-11-07: Der Server hat zusätzlich `POST /v1/refresh` (leerer Body, verlängert die Anmeldung um 15 Minuten, höchstens 12 Stunden ab Login, Token bleibt gleich; die Rendezvous-Bindung der Geräte bleibt erhalten). Der Rendezvous-Pfad wird vom Desktop-Meilenstein 1 „Fernzugriff (Ansehen)“ genutzt; `rendezvous.mjs` in `.claude/skills/run-app/` stellt dafür einen synthetischen Fake bereit. Verbleibende Lücken: Eingabeinjektion, TURN/Medienrelay, Betriebssystemdienst und unabhängiger Sicherheitsreview.

Stand 2026-11-09: Härtung H1 am Server. Je Quelladresse (IPv6 je /64) gelten Budgets für Anfragen, Anmeldungen und Verbindungen. Fehlgeschlagene Anmeldungen bremst ein wachsender Backoff (429 mit `retry-after`), ein globales Aussperren des Besitzers gibt es nicht mehr. Hinter dem Caddy-Proxy sieht der Server nur `127.0.0.1`; dann setzt `SHELLHERD_SERVER_TRUSTED_PROXY=1` (nur bei Bindung des Ports an `127.0.0.1`) das letzte Element von `X-Forwarded-For` als Quelle. `PUT /v1/rendezvous/devices` verlangt jedes Mal einen Besitznachweis des Geräteschlüssels (Challenge, X25519-DH, HMAC), `/v1/info` meldet `rendezvousProof`. Je Paar ist nur eine offene Anfrage erlaubt, nach einem Ablehnen gilt 30 s Sperre. Dockerfile: Basisimage per Digest, `rate-limit.mjs` im Image. Caddyfile: `1MiB`, Timeouts. Gegen verteilte Floods hilft nur ein privates Netz (WireGuard/Tailscale, H2). Weiter kein unabhängiger Sicherheitsreview; Betriebshinweise in `server/README.md`.

## Umsetzung

1. Bestehenden Sync-Transport kompatibel weiterverwenden; Container-Listener nur
   im separaten Servereinstieg aktivieren. Konfiguration privat und persistent.
2. Kontoauthentifizierte Geräte mit kurzen Präsenz-Leases registrieren. Geräte
   gehören einer Anmeldung; abgelaufene/widerrufene Anmeldungen verlieren Präsenz
   und Sitzungen. Keine automatische Freigabe durch Serverkonto oder Gerätenamen.
3. Sitzungen anfragen, am Ziel ausdrücklich annehmen oder ablehnen. Richtung,
   Teilnehmer, Berechtigungsumfang und Ablauf fest binden. Verschlüsselte
   Nachrichten mit begrenzten Warteschlangen, Sequenzen und Quittierung vermitteln.
4. Referenzclient mit lokalem Schlüssel und unabhängig verglichenem Fingerprint:
   X25519, HKDF-SHA256 und AES-256-GCM aus Node. Lokale Zustimmung wird auch
   Ende-zu-Ende verschlüsselt bestätigt; Serverstatus allein gibt keine Sitzung frei.
5. Nicht privilegiertes Containerimage, Compose, Healthcheck, TLS-Proxy-Beispiel,
   Backup-/Restore- und Passwortwechsel-Anleitung erstellen.
6. Authentifizierung, Zustimmung, E2EE, Ablauf, Wiederholung, Ressourcenlimits,
   Serverneustart und Kompatibilität testen; Container bauen/starten wenn verfügbar.

## Abgrenzung und folgende Integration

Dieser Server vermittelt Verbindungen und begrenzte verschlüsselte Nachrichten.
Die Nachrichtenweiterleitung ist für Signalisierung und den Verbindungsnachweis,
nicht als Video-Transport ausgelegt. Desktop-Erfassung, Betriebssystemdienste,
Eingabeinjektion, NAT-Traversal und ein Medienrelay sind eigene notwendige Teile
der anschließenden Windows-/Linux-Agentintegration. Der bestehende Plan zu
Remote-Desktop bleibt dafür maßgeblich. Eine erfolgreiche Signalisierung ist
kein Nachweis funktionierender Fernsteuerung oder unabhängiger Sicherheitsprüfung.

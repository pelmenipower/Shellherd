# vCenter-Integration (VMs sehen und verbinden) — Design

Stand: 2026-10-16 · Version 0.6.0 · baut auf „Verbindung deaktivieren“ (0.4.0) auf

## Ziel

Terminus zeigt die VMs eines vCenters im Verbindungsbaum, gegliedert wie die VM-Ordner in vCenter („VMs und Vorlagen“).
Nach dem Hinterlegen von Zugangsdaten öffnet ein Doppelklick die VM per SSH oder RDP. Die Adresse liefert vCenter.
Terminus liest nur: keine Power-Aktionen, keine Snapshots, keine Änderungen in vCenter. Ein vCenter-Benutzer mit Leserechten genügt.

**Erfolgskriterien**

- Nach dem Anlegen eines vCenter-Eintrags und dem Aufklappen erscheinen Rechenzentren, VM-Ordner und VMs wie in vCenter.
- Eine eingerichtete, eingeschaltete VM öffnet per Doppelklick einen SSH- oder RDP-Tab zur von vCenter gemeldeten Adresse.
- Neue VMs erscheinen beim nächsten Aufklappen oder „Aktualisieren“. Weggefallene VMs mit Zugangsdaten werden deaktiviert (ausgegraut), solche ohne Zugangsdaten entfernt.
- Taucht eine weggefallene VM wieder auf, wird sie automatisch reaktiviert. Die Zugangsdaten bleiben erhalten.
- Ein Netzwerk- oder Anmeldefehler löscht oder deaktiviert nie etwas.

## Abgrenzung

- Power-Aktionen, Snapshots, VM-Konsole (VMRC/Web-Konsole)
- Ansicht „Hosts und Cluster“ (ESXi-Host/Cluster als Gliederung)
- ESXi ohne vCenter
- Mehrere Zugangsdaten pro VM (SSH **und** RDP gleichzeitig); später als Erweiterung möglich
- Automatischer Abgleich im Hintergrund oder nach dem Entsperren

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Gespiegelte Struktur | VM-Ordner aus „VMs und Vorlagen“: Rechenzentrum → Ordner → VMs. Vorlagen werden ausgeblendet. |
| Speicherung | Echte Ordner und SSH/RDP-Verbindungen im Vault unter dem vCenter-Eintrag, markiert als „von vCenter verwaltet“ |
| Abgleich | Beim Aufklappen des vCenter-Eintrags und über „Aktualisieren“; dazwischen bleibt der gespeicherte Baum sichtbar |
| Protokoll | Automatisch nach Gast-Betriebssystem: Windows → RDP (3389), sonst SSH (22); pro VM änderbar |
| Adresse | IP aus den VMware Tools, sonst DNS-Name des Gasts. Eine manuell eingetragene Adresse hat immer Vorrang. |
| Zertifikat | Windows-Zertifikatsspeicher; sonst Fingerabdruck bestätigen und im Vault speichern. Ein geändertes Zertifikat blockiert. |
| Weggefallene VMs | Mit Zugangsdaten → deaktiviert und `missing`; ohne → entfernt; wieder da → reaktiviert, wenn wegen `missing` deaktiviert |

## Datenmodell (`src/shared/vault/types.ts`, `schema.ts`)

Alle Felder sind optional. Bestehende Vaults bleiben gültig, eine Migration ist nicht nötig.

```ts
/** vCenter root: an ordinary folder that the vCenter sync fills. */
interface VcenterSource {
  url: string;                 // https://vcenter.example.local
  username: string;
  password: string;
  /** SHA-256 fingerprint of a certificate the user trusted; unset when Windows trusts it. */
  fingerprint?: string;
  /** ISO time of the last complete sync. */
  syncedAt?: string;
}

interface FolderNode {
  // …existing fields
  vcenter?: VcenterSource;     // only on the vCenter root folder
  managed?: ManagedRef;        // datacenter and VM folders below it
}

interface ManagedRef {
  vcenterId: string;           // id of the vCenter root folder
  moref: string;               // vCenter id, e.g. "group-v123", "datacenter-2", "vm-1042"
}

interface ManagedVm extends ManagedRef {
  guest: 'windows' | 'linux' | 'other' | 'unknown';
  power: 'on' | 'off' | 'suspended';
  /** Address vCenter reported last (IP, else guest DNS name); empty when unknown. */
  reportedHost: string;
  /** The user entered their own address; the sync no longer writes `host`. */
  manualHost?: boolean;
  /** The user saved credentials/settings for this VM. */
  configured?: boolean;
  /** Disabled by the sync because vCenter no longer lists the VM. */
  missing?: boolean;
}

// SshConnectionNode and RdpConnectionNode get:
managed?: ManagedVm;
```

- Eine VM ist eine normale `SshConnectionNode` oder `RdpConnectionNode`. `host` enthält die verwendete Adresse: entweder `reportedHost` oder, bei `manualHost`, die eigene Adresse.
- Neue VMs werden so angelegt:
  - Windows → RDP, Port 3389, ohne Passwort; der RDP-Client fragt beim Verbinden.
  - Sonst → SSH, Port 22, Anmeldung per Agent.
  - `configured` ist nicht gesetzt.
- `redactSecrets` entfernt `vcenter.password`, wie bei den anderen Geheimnissen für abgedockte Fenster.
- Konsistenzprüfung (`consistency.ts`):
  - `managed` kommt nur unterhalb eines Ordners mit `vcenter` vor, und `vcenterId` zeigt auf diesen Ordner.
  - Jede `moref` kommt pro vCenter höchstens einmal vor.

## Abruf aus vCenter (Main-Prozess, `src/main/vcenter/`)

### `client.ts`: HTTPS und Zertifikat

- Der HTTPS-Client verwendet `node:https` mit eigenem `Agent`:
  - **Windows vertraut dem Zertifikat** → normal weiter.
  - **Sonst** wird der SHA-256-Fingerabdruck des Server-Zertifikats mit `fingerprint` verglichen:
    - **Passt** → weiter.
    - **Fehlt** → Fehler `untrusted` mit dem Fingerabdruck. Der Renderer zeigt den Vertrauensdialog.
    - **Abweichend** → Fehler `changed` mit altem und neuem Fingerabdruck.
- Den Windows-Zertifikatsspeicher liest der Main-Prozess über die eingebauten CA-Zertifikate des Systems. Wie das unter Electron 44 genau geht, klärt der erste Plan-Schritt: `--use-system-ca` oder `tls.getCACertificates('system')`.
- Anmeldung mit `POST /api/session` per Basic-Auth; der Token kommt in den Header `vmware-api-session-id`. Abmeldung mit `DELETE /api/session`, auch bei Fehlern.
- Jeder Request hat einen Timeout von 15 s, der ganze Abruf höchstens 120 s.
- Erlaubt sind nur `GET`-Requests sowie An- und Abmeldung. Der Client bietet keine andere Methode an.

### `inventory.ts`: Baum lesen

1. `GET /api/vcenter/datacenter` und je Rechenzentrum `GET /api/vcenter/datacenter/{dc}` → `vm_folder`.
2. Breitensuche ab `vm_folder`:
   - `GET /api/vcenter/folder?parent_folders={id}&type=VIRTUAL_MACHINE` liefert die Unterordner.
   - `GET /api/vcenter/vm?folders={id}` liefert die VMs.
   - Höchstens 8 Requests laufen parallel.
3. Für jede eingeschaltete VM liefert `GET /api/vcenter/vm/{vm}/guest/identity` die Werte `ip_address`, `host_name` und `family`. Ein Fehler (Tools fehlen) ergibt `guest: 'unknown'` und eine leere Adresse.
4. Bei ausgeschalteten VMs bleiben die bisherigen Gastdaten erhalten. Der Abgleich überschreibt sie nicht mit „unbekannt“.

Ergebnis:

```ts
interface VcenterInventory {
  complete: boolean;           // false when any folder or VM list failed
  warnings: string[];          // e.g. "Einige Ordner waren nicht lesbar."
  folders: { moref: string; name: string; parent: string | null; kind: 'datacenter' | 'folder' }[];
  vms: { moref: string; name: string; folder: string; power: 'on' | 'off' | 'suspended';
         guest?: { family: 'windows' | 'linux' | 'other'; ip?: string; hostName?: string } }[];
}
```

**Zuerst zu prüfen** (erster Plan-Schritt, gegen das echte vCenter):
- Liefert `vm?folders=` nur die direkten Kinder eines Ordners?
- Sind Vorlagen in der `vm`-Liste bereits ausgeschlossen?
- Bei Rechenzentren in Unterordnern: Liefert `datacenter` alle Rechenzentren?

Falls die REST-API das nicht trägt, geht es mit einem SOAP-`PropertyCollector`-Abruf weiter (eine Anfrage, `parent`-Beziehungen inklusive). Das ist dann eine Entscheidung im Plan, keine Änderung am Rest des Designs.

### IPC

| Kanal | Richtung | Inhalt |
|---|---|---|
| `vcenter:inventory` | Renderer → Main | `{ vcenterId }` → `VcenterInventory` oder Fehler `{ kind: 'auth' \| 'unreachable' \| 'untrusted' \| 'changed' \| 'timeout', fingerprint?, previous? }` |
| `vcenter:test` | Renderer → Main | Formulardaten → Erfolg oder derselbe Fehler (für „Verbindung testen“) |

Der Main-Prozess liest URL, Benutzer, Passwort und Fingerabdruck aus dem entsperrten Vault. Das Passwort wandert nicht über IPC zurück.
Pro vCenter läuft höchstens ein Abruf gleichzeitig. Ein zweiter Aufruf bekommt dasselbe Promise.

## Abgleich (`src/shared/vcenter/reconcile.ts`, rein)

```ts
function reconcile(root: FolderNode, inventory: VcenterInventory, now: string, uuid: () => string):
  { root: FolderNode; summary: { added: number; updated: number; missing: number; removed: number; restored: number } };
```

Wiedererkennung über `moref` innerhalb des vCenter-Ordners. Die Regeln:

1. **Struktur:**
   - Ordner und VMs werden in der Hierarchie aus `inventory` angeordnet, mit dem Rechenzentrum als oberster Ebene.
   - Die Reihenfolge ist alphabetisch, Ordner stehen vor VMs.
2. **Neu:**
   - Ordner bekommen `managed`.
   - VMs werden nach den Regeln für neue VMs angelegt. Ihr Name ist der VM-Name.
3. **Vorhanden:**
   - Name, Ort im Baum, `power`, `guest` und `reportedHost` werden aktualisiert.
   - `host` = `reportedHost`, außer `manualHost` ist gesetzt.
   - Das Protokoll und der passende Standardport ändern sich nur bei VMs, die nicht `configured` sind.
   - Alle übrigen Felder bleiben unverändert: Zugangsdaten, Benutzer, Symbol, Farbe, Kommentar, Tags, `disabled` (sofern nicht `missing`) und Container-Optionen.
4. **Weggefallen** (nur bei `complete: true`):
   - `configured` → `disabled: true`, `missing: true`. Die VM bleibt an ihrem bisherigen Ort.
   - nicht `configured` → entfernt.
   - Ein verwalteter Ordner wird entfernt, wenn er danach leer ist. Ordner mit verbliebenen, deaktivierten VMs bleiben.
5. **Wieder da:**
   - `missing` → `missing` und `disabled` werden entfernt.
   - Ohne `missing`, also von dir selbst deaktiviert, bleibt `disabled` gesetzt.
6. **Unvollständiger Abruf** (`complete: false`): nur die Regeln 2, 3 und 5. Nichts wird entfernt oder deaktiviert.
7. Bei einem vollständigen Abruf wird `syncedAt` auf `now` gesetzt.

Der Renderer speichert das Ergebnis mit `persistVault`. Bezüge in Workspaces auf entfernte VMs bereinigt das vorhandene `removeNodeFromVault`. Der Abgleich nutzt dafür dieselbe Bereinigung.

## Oberfläche (Renderer)

### vCenter-Eintrag

- **Neu → „vCenter“** öffnet das Formular:
  - Felder: Name, URL, Benutzer, Passwort.
  - „Verbindung testen“ meldet sich an, liest die Rechenzentren und meldet sich wieder ab.
  - Bei `untrusted` erscheint der **Zertifikatsdialog**:
    - Er zeigt Fingerabdruck und Aussteller und bietet „Vertrauen“ / „Abbrechen“.
    - „Vertrauen“ speichert `fingerprint`.
    - Bei `changed` zeigt er alten und neuen Fingerabdruck. Die Schaltfläche heißt dann „Neuem Zertifikat vertrauen“.
- **Im Baum:**
  - Der Eintrag hat ein eigenes Symbol.
  - Aufklappen startet den Abgleich; die Zeile zeigt währenddessen „aktualisiert …“.
  - Der Tooltip zeigt „Stand: TT.MM. hh:mm“.
  - Fehler erscheinen als Hinweiszeile unter dem Eintrag, wie bei den Containern.
- **Kontextmenü:** „Aktualisieren“, „Alle verbinden“, „Bearbeiten“, „Entfernen“.
  - „Entfernen“ fragt nach mit „Entfernt den vCenter-Eintrag mit allen VMs und hinterlegten Zugangsdaten.“
- Nach dem Abgleich erscheint die Zusammenfassung als kurzer Hinweis, z. B. „3 neu · 1 weggefallen (deaktiviert) · 2 entfernt“.

### Verwaltete Ordner und VMs

- **Badges:**
  - **„aus“** für ausgeschaltete oder angehaltene VMs, die Zeile ist zusätzlich gedimmt.
  - **„einrichten“** für VMs, die noch nicht `configured` sind.
  - **„deaktiviert“** wie bei allen Verbindungen.
- **Gesperrt** bei verwalteten Knoten:
  - Umbenennen, Drag & Drop (weder ziehen noch hineinlegen), Löschen und „Neue Verbindung hier“.
  - Hineinlegen in den vCenter-Ordner selbst.
- **Doppelklick oder Enter:**
  - nicht `configured` → Einrichtungsformular,
  - `power !== 'on'` → Hinweis „Die VM „X“ ist ausgeschaltet.“,
  - sonst → verbinden. Das Deaktivieren hat Vorrang vor allem.
- **Einrichtungsformular** (verkleinertes `ConnectionForm`):
  - Nur lesbar: Name und von vCenter gemeldete Adresse.
  - Einstellbar:
    - Protokoll SSH/RDP, vorbelegt nach `guest`,
    - Port,
    - Benutzer,
    - Anmeldung (SSH) bzw. Passwort und Domäne (RDP),
    - „Eigene Adresse (überschreibt vCenter)“: ausgefüllt setzt sie `manualHost` und `host`, geleert setzt sie `host = reportedHost` zurück,
    - Symbol und Farbe,
    - Container-sudo (SSH).
  - Speichern setzt `configured`.
- **Kontextmenü:**
  - „Verbinden“, „Einrichten“ (nicht `configured`) bzw. „Bearbeiten“, „Deaktivieren“ bzw. „Aktivieren“.
  - Bei SSH außerdem „Dateien öffnen (SFTP)“ und „Container anzeigen“.
- **„Alle verbinden“** auf vCenter- und verwalteten Ordnern überspringt deaktivierte, ausgeschaltete und nicht eingerichtete VMs. Gemeldet wird z. B. „4 VMs übersprungen (ausgeschaltet oder nicht eingerichtet).“ Dazu kommt die bestehende Meldung für deaktivierte Verbindungen.
- Workspaces öffnen verwaltete VMs wie andere Verbindungen. Ausgeschaltete VMs werden wie deaktivierte übersprungen und gezählt.

## Sicherheit

- Das vCenter-Passwort steht nur im verschlüsselten Vault und im Main-Prozess. Es erscheint nie in Logs, Fehlermeldungen, IPC-Antworten oder abgedockten Fenstern.
- Terminus ruft nur lesende Endpunkte auf. Der Client hat keine Methode für schreibende Requests (außer der Sitzung).
- TLS wird immer geprüft. Es gibt keine Option, die Prüfung abzuschalten. Fingerabdrücke werden erst nach ausdrücklicher Bestätigung gespeichert.
- VM-Namen und Adressen aus vCenter sind Daten. Sie werden nie in Shell-Befehle eingesetzt; `host` geht wie bei jeder Verbindung direkt an ssh2 bzw. den RDP-Client.

## Fehlerbehandlung

| Fall | Meldung | Wirkung |
|---|---|---|
| 401/403 bei Anmeldung | „vCenter-Anmeldung fehlgeschlagen. Benutzer/Passwort prüfen.“ | kein Abgleich |
| Nicht erreichbar / DNS / Verbindungsfehler | „vCenter nicht erreichbar.“ | kein Abgleich |
| Timeout (Request oder gesamt) | „vCenter antwortet nicht rechtzeitig.“ | kein Abgleich |
| Unbekanntes Zertifikat | Zertifikatsdialog | Abgleich nach „Vertrauen“ |
| Geändertes Zertifikat | Warnung mit altem/neuem Fingerabdruck | kein Abgleich bis „Neuem Zertifikat vertrauen“ |
| Teilbaum nicht lesbar | „Einige Ordner waren nicht lesbar.“ | Abgleich ohne Entfernen/Deaktivieren |
| Vault gesperrt während des Abrufs | — | Ergebnis wird verworfen |

## Tests (vitest)

- **`reconcile.test.ts`:**
  - Neu, umbenannt, verschoben.
  - Weggefallen mit und ohne `configured`.
  - Wieder aufgetaucht: wegen `missing` deaktiviert vs. selbst deaktiviert.
  - `manualHost` bleibt erhalten.
  - Protokollwechsel nur bei nicht eingerichteten VMs.
  - Unvollständiger Abruf entfernt nichts.
  - Leere Ordner verschwinden, Ordner mit deaktivierten VMs bleiben.
  - `syncedAt` wird nur bei vollständigem Abruf gesetzt.
  - Ergebnis besteht die Konsistenzprüfung.
- **`client.test.ts` / `inventory.test.ts`** gegen einen lokalen HTTPS-Testserver mit selbst signiertem Zertifikat:
  - An- und Abmeldung, auch die Abmeldung nach einem Fehler.
  - Breitensuche über verschachtelte Ordner.
  - Gastdaten, fehlende Tools.
  - Fingerabdruck unbekannt, passend und geändert.
  - 401, Timeout, Teilfehler → `complete: false`.
  - Nur GET-Requests nach der Anmeldung.
  - Passwort taucht in keiner Fehlermeldung auf.
- **Schema und Konsistenz:**
  - Neue Felder sind optional, alte Vaults laden.
  - `managed` außerhalb eines vCenter-Ordners ist ungültig.
  - Doppelte `moref` ist ungültig.
- **`redactSecrets`:** Das vCenter-Passwort wird entfernt.
- **Formular-Helfer:**
  - Einrichten setzt `configured`.
  - Protokoll wird nach `guest` vorbelegt.
  - Eigene Adresse setzt bzw. löscht `manualHost`.
- **Helfer für „Alle verbinden“ und Workspaces:** Ausgeschaltete und nicht eingerichtete VMs werden übersprungen und gezählt.

## Umsetzungsreihenfolge

1. Machbarkeitsprüfung gegen das echte vCenter:
   - REST-Fragen aus „Zuerst zu prüfen“,
   - Systemzertifikate unter Electron 44.

   Das Ergebnis wird im Plan festgehalten.
2. Datenmodell, Schema, Konsistenz, `redactSecrets`.
3. `reconcile.ts` mit Tests.
4. HTTPS-Client mit Zertifikatsprüfung.
5. Inventar-Abruf und IPC.
6. vCenter-Formular, Zertifikatsdialog, Eintrag im Baum mit Abgleich beim Aufklappen.
7. Verwaltete Knoten im Baum: Badges, Sperren, Doppelklick-Logik, Einrichtungsformular.
8. „Alle verbinden“ und Workspaces für ausgeschaltete und nicht eingerichtete VMs.
9. README, CHANGELOG, Version 0.6.0.

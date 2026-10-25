# Import und Update-Hinweis – Validierung (bindend)

Urteil: **ready after corrections**. 0 Blocker, 8 Korrekturen (V1–V8). Alles nicht Genannte gilt aus der Spec `2026-10-24-import-update-design.md` wörtlich.

## Rulings

- **R-A Umfang:** WinSCP und mRemoteNG gehören in Stufe 1. Der Nutzer hat beide ausdrücklich für dieses Paket verlangt. Spec 7 („Extras: WinSCP, mRemoteNG“) ist damit aufgehoben.
- **R-B Passwörter:** Aus keiner Quelle werden Passwörter, Passphrasen oder Schlüsselinhalte importiert (Spec 4 gilt für alle vier Quellen).
- **R-C Update-Check standardmäßig an:** wie Spec 0, mit Schalter auch ohne Vault, Hinweistext, Changelog und README-Datenschutzabschnitt. Wird dem Nutzer im Abschlussbericht ausdrücklich genannt.
- **R-D Orphan-Test:** Nach Welle 1 darf `i18n-catalog.test.ts` (d) nur für neue Keys aus T5 rot sein; nach Welle 3 grün.

## Korrekturen

### V1 Vertrag `src/shared/import.ts` (ersetzt die betroffenen Teile von 3.1)

```ts
export type ImportSource = 'openssh' | 'putty' | 'winscp' | 'mremoteng';
export type ImportProtocol = 'ssh' | 'sftp' | 'rdp';
export type ImportNoteCode = 'ppkKey' | 'jumpUnsupported' | 'proxyDropped' | 'forwardsDropped' | 'keyUnresolved' | 'scpAsSftp';
export type ImportSkipCode = 'match' | 'include' | 'notSsh' | 'unsupported' | 'invalid' | 'tooMany';

export interface ImportCandidate {
  key: string;
  name: string;
  /** Default 'ssh'. sftp: WinSCP sessions. rdp: mRemoteNG RDP connections. */
  protocol: ImportProtocol;
  /** Folder path inside the import folder, outermost first; empty for top level. WinSCP "a/b/name", mRemoteNG containers. */
  folder: string[];
  host: string;
  port: number;
  username?: string;
  /** rdp only. */
  domain?: string;
  keyPath?: string;
  jumpKey?: string;
  forwards: ImportForward[];
  notes: ImportNoteCode[];
}

/** Nodes for the selected candidates, folders built from `folder`, in preview order. */
export function buildImportNodes(candidates: ImportCandidate[], selected: ReadonlySet<string>,
  newId?: () => string): { nodes: VaultNode[]; invalid: number; jumpsDropped: number };
```

`buildImportNodes` (ergänzt 3.4):
- `ssh` wie Spec 3.4. `sftp`: `{ id, type:'connection', name, tags:[], protocol:'sftp', host, port, username?, authentication, jumpHost? }` (keine `forwards`), Prüfung mit `SftpConnectionNodeSchema`. `rdp`: `{ id, type:'connection', name, tags:[], protocol:'rdp', host, port, username?, rdp: { clipboard: true, ...(domain ? { domain } : {}) } }`, Prüfung mit `RdpConnectionNodeSchema`, nie `password`.
- Ordner: Für jeden ausgewählten gültigen Knoten mit `folder.length > 0` werden Ordner-Knoten `{ id, type:'folder', name, children: [] }` angelegt bzw. wiederverwendet (gleicher Pfad = derselbe Ordner, Vergleich exakt). Leere Ordner entstehen nie. Rückgabe: die Knoten der obersten Ebene in Vorschau-Reihenfolge des ersten Kindes.
- `importDuplicates` vergleicht zusätzlich `protocol` (ssh und sftp gelten als gleich, rdp nur mit rdp).
- Die Parser aus 3.2 und 3.3 setzen `protocol: 'ssh'` und `folder: []`.

### V2 WinSCP-Parser `src/shared/import-winscp.ts` (neu)

```ts
/** Pure; text of a `reg export` of HKCU\Software\Martin Prikryl\WinSCP 2\Sessions, or a WinSCP.ini (already decoded). */
export function parseWinScp(text: string): Omit<ImportPreview, 'source' | 'file'>;
```
1. Gültige Abschnitte: `[HKEY_CURRENT_USER\Software\Martin Prikryl\WinSCP 2\Sessions\<roh>]` **oder** `[Sessions\<roh>]` (ini), `<roh>` ohne `\`, Vergleich ohne Groß-/Kleinschreibung. Andere Abschnitte ignorieren.
2. Name: `<roh>` mit `%XX` dekodiert. `Default Settings` still überspringen. Enthält der Name `/`, sind die Teile davor `folder`, der letzte Teil `name`. `key` = voller dekodierter Name.
3. Werte wie PuTTY (`"Name"="text"`, `"Name"=dword:…`); im ini-Format `Name=wert` (Zahl = dword, sonst Text, `%XX` dekodiert).
4. `FSProtocol` (dword, Standard 2): `0` → `sftp` mit Notiz `scpAsSftp`; `1`, `2` → `sftp`; alles andere (FTP 5, WebDAV 6/7, S3 8) → `unsupported`+1.
5. `HostName` Pflicht (`validImportHost`, sonst `invalid`+1). `PortNumber` Standard 22, 1–65535. `UserName`. `PublicKeyFile` → `keyPath` (`.ppk` → Notiz `ppkKey`). `Tunnel` = 1 → Notiz `jumpUnsupported`. Passwörter (`Password`, `TunnelPassword`) nie lesen.
6. Grenze 500 wie Spec.

### V3 mRemoteNG-Parser `src/shared/import-mremoteng.ts` (neu, ohne XML-Bibliothek)

```ts
/** Pure; text of confCons.xml. Throws AppError('core.importEncrypted') when FullFileEncryption="true". */
export function parseMRemoteNg(text: string): Omit<ImportPreview, 'source' | 'file'>;
```
1. Wurzel `<Connections … FullFileEncryption="true">` → `AppError('core.importEncrypted')`.
2. Tags `<Node …>`, `<Node …/>` und `</Node>` der Reihe nach mit einem Regex scannen (`/<Node\b([^>]*?)(\/?)>|<\/Node>/g`), Attribute mit `/(\w+)="([^"]*)"/g` lesen, XML-Entitäten `&amp; &lt; &gt; &quot; &apos;` und `&#NN;`/`&#xNN;` dekodieren. Ein Stapel offener `Type="Container"`-Knoten bildet `folder`.
3. `Type="Connection"`: `Protocol` `SSH2`/`SSH1` → `ssh` (Port Standard 22), `RDP` → `rdp` (Port Standard 3389, `Domain` → `domain`), alles andere → `unsupported`+1. `Hostname` Pflicht (`validImportHost`, sonst `invalid`+1), `Port` 1–65535, `Username`. `Password` nie lesen. `key` = `Id`-Attribut, sonst Ordnerpfad + Name.
4. Grenze 500.

### V4 Main `src/main/import-source.ts`
- `winscp`: wie PuTTY über `reg.exe export "HKCU\Software\Martin Prikryl\WinSCP 2\Sessions"`; Testhaken `SHELLHERD_WINSCP_REG_FILE`. Fehlt der Schlüssel (reg.exe Exit ≠ 0), leere Vorschau statt Fehler.
- `mremoteng`: Dateidialog, Standardpfad `%APPDATA%\mRemoteNG\confCons.xml`, Filter `*.xml`, Titel `main:dialogs.importMRemoteNg.title`. UTF-8 mit/ohne BOM.
- `z.enum(['openssh','putty','winscp','mremoteng'])`.

### V5 Fehlercode
`core.importEncrypted`: de „Die Datei ist verschlüsselt. Exportiere sie in mRemoteNG ohne vollständige Dateiverschlüsselung.“ / en „The file is encrypted. Export it from mRemoteNG without full file encryption.“

### V6 Texte (zusätzlich zu Spec 3.9)
`main.json`: `dialogs.importMRemoteNg.title` = „mRemoteNG-Verbindungsdatei auswählen“ / „Select mRemoteNG connection file“.
`vault.json` → `import`:

| Key | de-DE | en-US |
|---|---|---|
| `import.winscp` | Aus WinSCP … | From WinSCP … |
| `import.mremoteng` | Aus mRemoteNG (confCons.xml) … | From mRemoteNG (confCons.xml) … |
| `import.title.winscp` | Verbindungen aus WinSCP importieren | Import connections from WinSCP |
| `import.title.mremoteng` | Verbindungen aus mRemoteNG importieren | Import connections from mRemoteNG |
| `import.sourceRegistryWinscp` | Quelle: WinSCP-Sitzungen in der Windows-Registry | Source: WinSCP sessions in the Windows registry |
| `import.folder.winscp` | WinSCP-Import | WinSCP import |
| `import.folder.mremoteng` | mRemoteNG-Import | mRemoteNG import |
| `import.kind.sftp` | Dateien (SFTP) | Files (SFTP) |
| `import.kind.rdp` | Remotedesktop | Remote desktop |
| `import.inFolder` | in {{path}} | in {{path}} |
| `import.notes.scpAsSftp` | WinSCP-Sitzung mit SCP wird als SFTP übernommen. | WinSCP session with SCP is imported as SFTP. |
| `import.skipped.unsupported_one` / `_other` | {{count}} Sitzung mit anderem Protokoll übersprungen (FTP, Telnet, VNC …) / {{count}} Sitzungen mit anderem Protokoll übersprungen (FTP, Telnet, VNC …) | {{count}} session with another protocol skipped (FTP, Telnet, VNC …) / {{count}} sessions with another protocol skipped (FTP, Telnet, VNC …) |

Die Vorschau zeigt bei `protocol` ≠ `ssh` das Etikett `import.kind.*` und bei `folder.length > 0` „in a / b“ (Teile mit „ / “ verbunden). `import.hint` gilt unverändert für alle Quellen.

### V7 UI
Menü „Neu“ und Willkommensseite zeigen vier Einträge in der Reihenfolge OpenSSH, PuTTY, WinSCP, mRemoteNG.

### V8 Demo
`import-fixtures.mjs` schreibt zusätzlich `winscp.reg` (UTF-16LE mit BOM: `Default%20Settings`, `Prod/files-02` SFTP, `legacy-scp` mit FSProtocol 0, `ftp-site` FSProtocol 5, eine Sitzung mit `Tunnel`=1) und `confCons.xml` (Container `Kunden` mit SSH2 `kunde-ssh` und RDP `kunde-rdp` mit Domain, VNC-Knoten, eine Verbindung mit `Password`-Attribut, das nie erscheint). Treiber setzt `SHELLHERD_WINSCP_REG_FILE`. `screens.mjs` `import` zeigt zusätzlich `import-winscp.png` und `import-mremoteng.png`.

## Wellen (ersetzt Spec 5 in diesen Punkten)

| Welle | Task | Dateien |
|---|---|---|
| 1 | T1 Import-Kern (mit V1) | `src/shared/import.ts`, `import.test.ts` |
| 1 | T2 OpenSSH | `src/shared/import-openssh.ts`, `.test.ts` |
| 1 | T3 PuTTY | `src/shared/import-putty.ts`, `.test.ts` |
| 1 | T3b WinSCP (V2) | `src/shared/import-winscp.ts`, `.test.ts` |
| 1 | T3c mRemoteNG (V3) | `src/shared/import-mremoteng.ts`, `.test.ts` |
| 1 | T4 Update-Kern | wie Spec |
| 1 | T5 Texte (mit V5, V6) | wie Spec |
| 1 | T6 IPC | wie Spec |
| 1 | T7 Demo-Fakes (mit V8) | wie Spec |
| 2 | T8 Main (mit V4) | wie Spec |
| 2 | T9 Import-Dialog (mit V6-Anzeige) | wie Spec |
| 2 | T10 Update-Oberfläche | wie Spec |
| 2 | T12 Doku und Version | wie Spec, plus `CHANGELOG.en.md`, `docs/handbuch.md`, `docs/manual.md` |
| 3 | T11 App-Einbau (mit V7) | wie Spec |
| 3 | T13 Screenshots (mit V8) | wie Spec |

T1 bis T3c programmieren gegen den Vertrag in V1; die Parser importieren nur Typen aus `./import`.
Gates: nach jeder Welle `npm run typecheck` grün; `npx vitest run` grün bis auf R-D.

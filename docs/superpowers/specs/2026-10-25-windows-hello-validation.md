# Windows Hello – Validierung (bindend)

Urteil: **ready after corrections** (go-with-fixes). 2 Blocker (beide mit Fix), 11 Korrekturen, 9 Rulings. Dieser Anhang geht Spec `2026-10-25-windows-hello-design.md` und Plan vor. Was hier nicht geändert wird, gilt aus der Spec **wörtlich** (Rulings 2, Vertrag 3, Doku 5, run-app 6, Nicht-Ziele 7, manuelle Tests 11).

Geprüft gegen `c9a5638` (Node 24.20, TypeScript 5.9, Vitest 5.0.1, zod 4.6.5, csc 4.8.9221). Ausgangslage: `npm run typecheck` grün, `npx vitest run` 162 Dateien und 2 534 Tests grün.

**Belege aus dem Scratchpad** (`…\scratchpad\vhello\`):
- Eine Kopie von `src/` (mit Junction auf `node_modules`) hat den **gesamten Vertrag samt allen Korrekturen dieses Anhangs** bekommen: A, C, D, F, G1, G2 und die Pflicht-Tests aus Abschnitt 3.
  - Nach dem Stand von Welle 1: `tsc` für Node und Web grün, alle Tests grün.
  - Nach dem Stand von Welle 2: `tsc` grün, `vitest run src` mit 163 Dateien und 2 544 Tests grün. Darin enthalten sind `i18n-catalog.test.ts` (a bis g) und `design-tokens.test.ts`.
- **Der Helfer** wurde aus Spec 3.2 wörtlich mit `csc.exe /warnaserror+` gebaut (6 656 Byte). Gestartet wurde er nur mit Anfragen, die keinen Dialog auslösen; ein `sign` und ein `create` gab es nie.

  | Eingabe | Antwort | Zeit |
  |---|---|---|
  | `{"op":"status"}` | `{"ok":true,"available":true}` | 245 ms (kalt) |
  | `garbage`, leere Zeile, `null`, `[]`, `"status"`, `{"op":"x"}`, `{"op":5}` | jeweils `{"ok":false,"status":"failed"}` | 142–160 ms |
  | stdin sofort geschlossen | `{"ok":false,"status":"failed"}` | – |
  | `{"op":"status"}` ohne Zeilenende | `{"ok":true,"available":true}` | – |
- **`runHelper` aus Spec 3.6** lief unter Node gegen dieses Exe.
  - `available()` lieferte `true`.
  - Ein nicht vorhandenes Programm ergab `false` bzw. `core.helloUnavailable`.
  - Ein hängendes Programm, das eine halbe JSON-Zeile schreibt und dann schläft, wurde nach dem Zeitlimit beendet. `available()` lieferte dann `false`, und kein Prozess blieb zurück.
- **Krypto (HKDF und GCM) in Node gegengeprüft:** Rundlauf gelingt. Andere Signatur, anderer Salt und ein manipulierter Tag ergeben jeweils einen Fehler. Die Nonce ist bei jeder Verpackung neu.
- **Build-Skript mit Aktualitätsprüfung (K6)** in einer Kopie der Ordnerstruktur:
  1. Der erste Lauf baut.
  2. Der zweite Lauf meldet „ist aktuell“.
  3. Läuft das Exe und hält die Datei offen, kommt bei unveränderten Quellen trotzdem „ist aktuell“, gefolgt vom grünen Rauchtest.
  4. Bei geänderten Quellen und offener Datei kommt `CS0016` mit verständlicher Meldung und Exit 1.

## 1. Vertrag: was bindend ist

- **Kompiliert gegen den echten Code ohne Abweichung:** Spec 3.1 (A), 3.4 (crypto), 3.9 (Texte), 3.10 `hello.ts` (Renderer), `SettingsDialog`-Änderung und `app.json`, 3.11 `LockScreen` und `App` (mit K8).
- **Ersetzt durch diesen Anhang:**
  - Spec 3.5 `keyCopy` → K3
  - Spec 3.6 vollständig → K1
  - Spec 3.7 vollständig → K2
  - Spec 3.8 `helloEnable`/`helloDisable` und die Stelle in `saveVault` → K4
  - Spec 3.2 Build-Skript → K6
  - `HelloSetting.tsx` → K7
- Fakten aus dem Code, die die Spec stützen:
  - `ErrorCode` wird aus `de-DE/errors/*.json` abgeleitet (`src/shared/errors.ts:3-6`). Die neuen `core.hello*`-Codes existieren für TypeScript also erst, wenn D die `core.json` ergänzt hat. D und alle Nutzer der Codes liegen in Welle 1 oder später.
  - `handle` erlaubt Listener mit konkreten Parametertypen, weil `never[]` zuweisbar ist (`ipc.ts:55`).
  - `toVaultAppError` reicht `AppError` unverändert durch (`ipc-error.ts:4-5`).
  - `__dirname` ist unter Vitest 5 definiert (geprüft). Spec-Risiko 10 tritt nicht ein.
  - Im `electron`-Mock von `ipc.test.ts` fehlt `isPackaged`. Der Wert ist dort `undefined`, also falsy, und der Fake greift wie vorgesehen.
  - `app.isPackaged` ist eine Eigenschaft der echten App; im gebauten Paket liefert sie `true`.
  - `vault:save` → `saveVault` ist der einzige Weg, auf dem eine neue Datei mit neuem Salt entsteht (`App.tsx:368`). Ein „Speichern unter“ für einen offenen Vault gibt es nicht.
  - `saveCurrentVault` behält Salt und Schlüssel.
- **Zeilenanker der Spec.** Diese stimmen:
  - `crypto.ts`: `:19-21`, `:23-24`, `:28-31`, `:68`, `:98-107`, `:168-201`, `:203-261`, `:244-247`
  - `session.ts`: `:17-24`, `:34-36`, `:54-85`, `:130-138`
  - `vault/ipc.ts`: `:55-64`, `:65`, `:68`, `:83-137`, `:192-196`
  - `index.ts`: `:123`, `:360-376`
  - `LockScreen.tsx`: `:12`, `:47-54`, `:69`, `:74`, `:84`
  - `App.tsx`: `:195`, `:392-423`, `:638-650`, `:835-840`, `:984`
  - `SettingsDialog.tsx`: `:138-150`

  Diese sind falsch, für die Umsetzung aber ohne Belang:
  - `recent-vaults.ts:145-157` ist in Wahrheit `:15-27`.
  - `RecentVaults.has` steht bei `:72-76`, nicht bei `:199-203`.
  - Der `lastVaultFile`-Effekt in `App.tsx` steht bei `:255-261`.
- **i18n (`i18n-catalog.test.ts`).** Alle Texte aus Spec 3.9 und 3.10 bestehen (a) bis (g), im Scratchpad gelaufen:
  - kein `...`;
  - kein ` …` in en-US: „Waiting for Windows Hello…“;
  - keine Platzhalter.
  - **(d) verwaiste Keys:**
    - `core.hello*` stehen als Literale in `hello-helper.ts` und `hello.ts` (D, Welle 1).
    - `app:hello.*` stehen in `HelloSetting.tsx` (G1) und in `LockScreen.tsx`/`App.tsx` (G2). Beide liegen in Welle 2.
  - **(g) deutsche Literale:**
    - Kein neuer Code enthält Umlaute.
    - Die JSX-Zeilen mit `>` gefolgt von Text beginnen immer mit `{`.
    - Der deutsche Kommentarblock in `session.ts` beginnt mit `*` und ist damit ausgenommen.
- **Design (`design-tokens.test.ts`).** Es gibt kein neues CSS, keine Inline-Styles und keine Bewegung. Genutzt werden nur `secondary-button`, `settings-check`, `settings-hint` und `error-message`, und die gibt es schon (`settings-ui.css:7-8`).

## 2. Blocker

### B1 – Welle 1 endet rot: der Pflichttest „Exklusiv“ (Spec 10.3) scheitert mit dem Vertragscode
Der Fake-Zweig in `sign` läuft vollständig synchron: Er prüft `busy`, setzt `busy = true`, ruft `fakeSign` auf, und `finally` setzt `busy = false`. Das alles geschieht, bevor der zweite Aufruf überhaupt beginnt.

Beleg: `Promise.allSettled([sign(), sign()])` liefert mit Spec 3.6 `fulfilled, fulfilled`. Der Pflichttest erwartet einmal `core.helloBusy`. Das Gleiche gilt in run-app: Ein Doppelklick während einer Fake-Abfrage würde zwei Entsperrungen starten.

**Fix:** K1. Der Fake gibt einmal ab (`await Promise.resolve()`), wie eine echte Abfrage. Beleg nach dem Fix: `fulfilled, rejected (core.helloBusy)`, danach geht `sign` wieder.

### B2 – Ein Schlüssel überlebt die Sperre (Sicherheit)
Spec 3.8 `helloEnable` holt `keyCopy()` **vor** der Hello-Abfrage. Die Kopie liegt dann bis zu 120 s im Speicher, während der Nutzer am Windows-Dialog ist. Sperrt in dieser Zeit die Auto-Sperre (`index.ts:373`) oder der Nutzer den Vault, nullt `lock()` nur den Session-Schlüssel. Die Kopie bleibt, und nach der Geste wird sie sogar verpackt und gespeichert.

Das Gleiche passiert bei einem Vault-Wechsel während der Abfrage: Hello wird dann für einen Vault eingeschaltet, der nicht mehr offen ist. Damit ist die Zusage „Sperre nullt den Schlüssel“ (`session.ts:136`, Handbuch) verletzt.

**Fix:** K2, K3 und K4.
- Zuerst die Abfrage, danach erst die Kopie, und zwar nur, wenn noch derselbe Pfad mit demselben Salt entsperrt ist. Sonst kommt `core.vaultLocked`, und nichts wird gespeichert.
- Beleg: Der IPC-Test „stores nothing when the vault is locked during the enable prompt“ ist grün.

## 3. Korrekturen (wörtlicher Ersatz)

### K1 – `src/main/vault/hello-helper.ts` (D), vollständige Datei, ersetzt Spec 3.6
Änderungen gegenüber der Spec:
- B1: Der Fake gibt einmal ab.
- Neu ist `helloSignature`. Es lehnt Signaturen unter 256 Byte ab. Eine leere oder kurze Signatur, etwa durch einen Plattformfehler mit `Success`, ergäbe sonst einen Verpackungsschlüssel, den jeder aus der öffentlichen Challenge berechnen kann. Dann wäre der Vault-Schlüssel offline aus `hello-unlock.json` lesbar.

```ts
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';

import { AppError } from '../../shared/errors';
import type { ErrorCode } from '../../shared/errors';

/** Talks to Windows Hello; the only place that knows the helper program or the run-app fake. */
export interface HelloSigner {
  /** Never prompts; false on any failure. */
  available(): Promise<boolean>;
  /** Prompts. create = make the Shellherd Hello key if it is missing (enrollment only). Throws core.hello* codes. */
  sign(challenge: Buffer, create: boolean): Promise<Buffer>;
}

/** The user may take a while at the prompt; after this the helper is killed and the request fails. */
export const HELLO_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 30_000;
const MAX_REPLY = 16_384;
/** Windows Hello keys are RSA-2048: a real signature has 256 bytes. Anything shorter would make a weak wrapping key. */
const MIN_SIGNATURE_BYTES = 256;

/** Error code for a failed helper status; unknown text is core.helloFailed. */
export function helloFailure(status: unknown): ErrorCode {
  if (status === 'canceled') return 'core.helloCanceled';
  if (status === 'notFound') return 'core.helloStale';
  if (status === 'unavailable') return 'core.helloUnavailable';
  return 'core.helloFailed';
}

/** Parses the helper's single output line; ok:false and anything unreadable throw a coded error. */
export function readHelloReply(text: string): { available?: unknown; signature?: unknown } {
  let reply: unknown;
  try { reply = JSON.parse(text.trim()); } catch { throw new AppError('core.helloFailed'); }
  if (typeof reply !== 'object' || reply === null) throw new AppError('core.helloFailed');
  const { ok, status } = reply as { ok?: unknown; status?: unknown };
  if (ok !== true) throw new AppError(helloFailure(status));
  return reply as { available?: unknown; signature?: unknown };
}

/** Signature bytes from the helper reply; missing, oversized or too short → core.helloFailed. */
export function helloSignature(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new AppError('core.helloFailed');
  const signature = Buffer.from(value, 'base64');
  if (signature.length < MIN_SIGNATURE_BYTES) {
    signature.fill(0);
    throw new AppError('core.helloFailed');
  }
  return signature;
}

/** run-app hook: only an unpacked Shellherd reads SHELLHERD_HELLO_FAKE; a packaged build never does. */
export function fakeHelloMode(packaged: boolean, env: NodeJS.ProcessEnv): string | undefined {
  return packaged ? undefined : env.SHELLHERD_HELLO_FAKE;
}

/** Deterministic stand-in for the helper: 'ok' signs, 'reset' stands for a re-created Hello key, 'cancel' and 'unavailable' fail. */
function fakeSign(mode: string, challenge: Buffer): Buffer {
  if (mode === 'cancel') throw new AppError('core.helloCanceled');
  if (mode === 'unavailable') throw new AppError('core.helloUnavailable');
  return createHmac('sha256', mode === 'reset' ? 'shellherd-hello-fake-reset' : 'shellherd-hello-fake').update(challenge).digest();
}

/** Runs the helper once: one request line in, one line out; killed after the timeout (empty output → core.helloFailed). */
function runHelper(executable: string, request: object, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false });
    let output = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (output.length < MAX_REPLY) output += chunk; });
    // A missing or blocked helper (ENOENT, EACCES) means Windows Hello cannot be used here.
    child.on('error', () => { clearTimeout(timer); reject(new AppError('core.helloUnavailable')); });
    child.on('close', () => { clearTimeout(timer); resolve(output); });
    child.stdin.on('error', () => { /* close reports the failure */ });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

/** One prompt at a time; the fake is read on every call so a run-app scene can switch it. */
export function createHelloSigner(executable: string, packaged: boolean, env: NodeJS.ProcessEnv = process.env): HelloSigner {
  let busy = false;
  return {
    async available() {
      const mode = fakeHelloMode(packaged, env);
      if (mode !== undefined) return mode !== 'unavailable';
      try { return readHelloReply(await runHelper(executable, { op: 'status' }, STATUS_TIMEOUT_MS)).available === true; } catch { return false; }
    },
    async sign(challenge, create) {
      if (busy) throw new AppError('core.helloBusy');
      busy = true;
      try {
        const mode = fakeHelloMode(packaged, env);
        if (mode !== undefined) {
          // A real prompt takes a while: yield once so a second request meets the busy flag, as in production.
          await Promise.resolve();
          return fakeSign(mode, challenge);
        }
        return helloSignature(readHelloReply(await runHelper(executable, { op: 'sign', challenge: challenge.toString('base64'), create }, HELLO_TIMEOUT_MS)).signature);
      } finally {
        busy = false;
      }
    },
  };
}
```

### K2 – `src/main/vault/hello.ts` (D), vollständige Datei, ersetzt Spec 3.7
Änderungen gegenüber der Spec:
- B2: `enable(filePath, salt, takeKey)`. Die Abfrage kommt zuerst, `takeKey` erst danach, und `enable` nullt den Schlüssel selbst.
- `openVaultKey` nullt den Zwischenpuffer von `decipher.update`. Bisher blieb dort eine Klartextkopie des Vault-Schlüssels liegen, bis die Speicherbereinigung lief.
- `forgetRecent` entfernt **alle** Einträge zu einer ID. `recentId` faltet Unicode, `grantKey` nur ASCII; zwei Schreibweisen können deshalb dieselbe ID haben.
- `salt` erlaubt bis 4096 Zeichen statt 64. `EncryptedVaultFileSchema` begrenzt `kdf.salt` nicht (`schema.ts:299`). Ein längerer Salt würde sonst die **ganze** Datei ungültig machen, und alle Einträge gingen still verloren.

```ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { AppError } from '../../shared/errors';
import type { HelloStatus } from '../../shared/ipc';
import { MAX_RECENT_VAULTS } from '../app-settings';
import { grantKey, recentId } from './recent-vaults';
import type { HelloSigner } from './hello-helper';

const base64Of = (bytes: number) => z.string().max(64)
  .refine(text => /^[A-Za-z0-9+/]+={0,2}$/.test(text) && Buffer.from(text, 'base64').length === bytes);
const EntrySchema = z.object({
  filePath: z.string().min(1).max(4096),
  /** kdf.salt of the vault file the key belongs to; a replaced file has another one. */
  salt: z.string().min(1).max(4096),
  challenge: base64Of(32),
  nonce: base64Of(12),
  tag: base64Of(16),
  wrapped: base64Of(32),
}).strict();
const StoreSchema = z.object({ version: z.literal(1), vaults: z.array(EntrySchema).max(MAX_RECENT_VAULTS) });
export type HelloEntry = z.infer<typeof EntrySchema>;

/** AES-256-GCM key derived from the Hello signature; the signature is zeroed. */
function wrappingKey(signature: Buffer, challenge: Buffer): Buffer {
  try {
    return Buffer.from(hkdfSync('sha256', signature, challenge, 'shellherd-hello-v1', 32));
  } finally {
    signature.fill(0);
  }
}

const aad = (salt: string): Buffer => Buffer.from(`shellherd-hello:v1:${salt}`, 'utf8');

/** Wraps a vault key for the file with this KDF salt. Exported for tests. */
export function sealVaultKey(filePath: string, salt: string, vaultKey: Buffer, challenge: Buffer, signature: Buffer): HelloEntry {
  const key = wrappingKey(signature, challenge);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(salt));
    const wrapped = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    return {
      filePath, salt,
      challenge: challenge.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      wrapped: wrapped.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

/** Unwraps the vault key; another signature or salt gives core.helloStale. No plaintext copy stays behind. Exported for tests. */
export function openVaultKey(entry: HelloEntry, signature: Buffer): Buffer {
  const key = wrappingKey(signature, Buffer.from(entry.challenge, 'base64'));
  let plain: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'));
    decipher.setAAD(aad(entry.salt));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    plain = decipher.update(Buffer.from(entry.wrapped, 'base64'));
    decipher.final();
    return Buffer.from(plain);
  } catch {
    throw new AppError('core.helloStale');
  } finally {
    plain?.fill(0);
    key.fill(0);
  }
}

/** Wrapped vault keys for Windows Hello, per vault path, in hello-unlock.json next to settings.json. Never holds a password. */
export class HelloVaults {
  constructor(private readonly file: string, private readonly signer: HelloSigner) {}

  async status(filePath: string): Promise<HelloStatus> {
    return { available: await this.signer.available(), enrolled: this.find(filePath) !== undefined };
  }

  /**
   * Prompts first, then wraps the vault key that takeKey returns (zeroed here) for filePath; newest first, at most 8 vaults.
   * takeKey runs after the prompt, so no key copy waits through it; it throws if the vault was locked or switched meanwhile.
   */
  async enable(filePath: string, salt: string, takeKey: () => Buffer): Promise<HelloStatus> {
    const challenge = randomBytes(32);
    const signature = await this.signer.sign(challenge, true);
    let vaultKey: Buffer;
    try {
      vaultKey = takeKey();
    } catch (error) {
      signature.fill(0);
      throw error;
    }
    try {
      const entry = sealVaultKey(filePath, salt, vaultKey, challenge, signature);
      const key = grantKey(filePath);
      this.write([entry, ...this.entries().filter(item => grantKey(item.filePath) !== key)].slice(0, MAX_RECENT_VAULTS));
    } finally {
      vaultKey.fill(0);
    }
    return { available: true, enrolled: true };
  }

  /** Removes the entry of filePath; throws core.settingsWriteFailed if the file cannot be written. */
  forget(filePath: string): void {
    const key = grantKey(filePath);
    const entries = this.entries();
    const kept = entries.filter(item => grantKey(item.filePath) !== key);
    if (kept.length !== entries.length) this.write(kept);
  }

  /** Best effort: an entry that cannot be removed is caught again by the salt check or the next unwrap. */
  forgetQuietly(filePath: string): void {
    try { this.forget(filePath); } catch { /* see above */ }
  }

  /** Same removal for every entry of a recent-list id (recentId); never throws. */
  forgetRecent(id: unknown): void {
    for (const entry of this.entries().filter(item => recentId(item.filePath) === id)) this.forgetQuietly(entry.filePath);
  }

  /** Prompts and returns the vault key of filePath; the caller owns it. Stale entries are removed. */
  async unwrap(filePath: string, salt: string): Promise<Buffer> {
    const entry = this.find(filePath);
    if (!entry) throw new AppError('core.helloStale');
    // A replaced or new vault file: no prompt for a key that cannot fit.
    if (entry.salt !== salt) { this.forgetQuietly(filePath); throw new AppError('core.helloStale'); }
    let signature: Buffer;
    try {
      signature = await this.signer.sign(Buffer.from(entry.challenge, 'base64'), false);
    } catch (error) {
      // The Shellherd Hello key is gone (Windows Hello set up again): every stored entry is useless.
      if (error instanceof AppError && error.code === 'core.helloStale') {
        try { this.write([]); } catch { /* the next unlock reports the same */ }
      }
      throw error;
    }
    try {
      return openVaultKey(entry, signature);
    } catch (error) {
      this.forgetQuietly(filePath);
      throw error;
    }
  }

  private find(filePath: string): HelloEntry | undefined {
    const key = grantKey(filePath);
    return this.entries().find(entry => grantKey(entry.filePath) === key);
  }

  /** Missing, unreadable or invalid file → no entries; the next write replaces it. */
  private entries(): HelloEntry[] {
    try {
      const parsed = StoreSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return parsed.success ? parsed.data.vaults : [];
    } catch {
      return [];
    }
  }

  private write(vaults: HelloEntry[]): void {
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, vaults }, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      throw new AppError('core.settingsWriteFailed');
    }
  }
}
```

### K3 – `src/main/vault/session.ts` (C): `keyCopy` wird zu `helloTarget` und `keyCopy(filePath, salt)`
Spec 3.5 gilt mit **einer** Änderung: Die Methode `keyCopy()` aus dem Spec-Block wird durch genau diese zwei Methoden ersetzt, an derselben Stelle zwischen `openWithKey` und `open`:
```ts
  /** File and KDF salt of the unlocked vault, for Windows Hello; core.vaultLocked without one. */
  public helloTarget(): { filePath: string; salt: string } {
    const session = this.requireSession();
    return { filePath: session.filePath, salt: session.kdf.salt };
  }

  /** Copy of the session key, only while the same file with the same KDF salt is unlocked; the caller zeroes it. */
  public keyCopy(filePath: string, salt: string): Buffer {
    const session = this.requireSession();
    if (session.filePath !== filePath || session.kdf.salt !== salt) throw new AppError('core.vaultLocked');
    return Buffer.from(session.key);
  }
```
Die Importe aus Spec 3.5 gelten wörtlich. `AppError` ist schon importiert (`session.ts:1`).

### K4 – `src/main/vault/ipc.ts` (F)
Spec 3.8 gilt mit diesen Änderungen:
- **`saveVault`:** Die zwei Zeilen „`// A new vault file has a new salt …`“ und `hello.forgetQuietly(filePath);` stehen **direkt nach** `const filePath = await saveVault(…);` (vor `await vaultSessionManager.unlock(`), nicht nach `recent.touch`. Sonst bleibt der Eintrag liegen, wenn das Entsperren der neuen Datei scheitert.
- **`helloEnable` und `helloDisable`** ersetzen die beiden Handler aus Spec 3.8 wörtlich:
```ts
  handle(IPC_CHANNELS.helloEnable, () => {
    const { filePath, salt } = vaultSessionManager.helloTarget();
    // The key is copied only after the prompt: a lock during the prompt leaves no copy behind and stores nothing.
    return hello.enable(filePath, salt, () => vaultSessionManager.keyCopy(filePath, salt));
  });
  handle(IPC_CHANNELS.helloDisable, () => {
    const { filePath } = vaultSessionManager.helloTarget();
    hello.forget(filePath);
    return hello.status(filePath);
  });
```
- Alles andere aus Spec 3.8 gilt wörtlich: Importe, `hello`, `requireAllowedPath`, `finishUnlock`, `removeRecentVault`, der Umbau von `unlockVault`, `helloStatus` und `helloUnlock`. Spec-Risiko 10 entfällt (`__dirname` geht in Vitest).

### K5 – Pflicht-Tests, wörtlich (C, D, F, G1)
Sie ersetzen Spec 10.1 bis 10.5. Alle sind im Scratchpad grün gelaufen.

**C – `src/main/vault/crypto.test.ts`:**
- Den Import `import { encryptVault } from './crypto';` ersetzen durch `import { encryptVault, unlockVault, unlockVaultWithKey } from './crypto';`.
- Am Dateiende anfügen:
```ts

describe('unlockVaultWithKey', () => {
  it('opens with the right key and zeroes a wrong or short one', async () => {
    const file = await encryptVault(exampleVault, 'ein gutes testpasswort', TEST_OPTIONS);
    const { key } = await unlockVault(file, 'ein gutes testpasswort');
    const opened = unlockVaultWithKey(file, key);
    expect(opened.vault).toEqual(exampleVault);
    expect(opened.key).toBe(key);
    expect(opened.kdf).toEqual(file.kdf);
    const wrong = Buffer.alloc(32, 1);
    expect(() => unlockVaultWithKey(file, wrong)).toThrow(expect.objectContaining({ code: 'core.wrongPassword' }));
    expect(wrong.equals(Buffer.alloc(32))).toBe(true);
    const short = Buffer.alloc(31, 1);
    expect(() => unlockVaultWithKey(file, short)).toThrow(expect.objectContaining({ code: 'core.vaultKeyLength' }));
    expect(short.equals(Buffer.alloc(31))).toBe(true);
  });
});
```
**C – `src/main/vault/session.test.ts`**, am Dateiende anfügen (Importe sind schon vorhanden):
```ts

describe('Windows Hello in the session', () => {
  it('opens with a stored key, keeps the session on a wrong one and copies the key only for the same file', async () => {
    const { filePath, password } = await createTestVault();
    const manager = new VaultSessionManager();
    await manager.unlock(filePath, password);
    const file = await readEncryptedVaultFile(filePath);
    expect(manager.helloTarget()).toEqual({ filePath, salt: file.kdf.salt });
    const copy = manager.keyCopy(filePath, file.kdf.salt);
    expect(() => manager.keyCopy(filePath, 'b3RoZXItc2FsdA==')).toThrow(expect.objectContaining({ code: 'core.vaultLocked' }));
    expect(() => manager.keyCopy(`${filePath}.other`, file.kdf.salt)).toThrow(expect.objectContaining({ code: 'core.vaultLocked' }));

    const wrong = Buffer.alloc(32, 1);
    expect(() => manager.openWithKey(filePath, file, wrong)).toThrow(expect.objectContaining({ code: 'core.wrongPassword' }));
    expect(wrong.equals(Buffer.alloc(32))).toBe(true);
    expect(manager.isUnlocked()).toBe(true);

    manager.lock();
    const snapshot = manager.openWithKey(filePath, file, Buffer.from(copy));
    copy.fill(0);
    expect(snapshot.vault).toEqual(exampleVault);
    expect(manager.isUnlocked()).toBe(true);
    expect(manager.lockedVault()).toBeUndefined();
    await manager.save({ ...snapshot.vault, name: 'Hello' });
    expect((await decryptVault(await readEncryptedVaultFile(filePath), password)).name).toBe('Hello');

    manager.lock();
    expect(() => manager.helloTarget()).toThrow(expect.objectContaining({ code: 'core.vaultLocked' }));
    expect(() => manager.keyCopy(filePath, file.kdf.salt)).toThrow(expect.objectContaining({ code: 'core.vaultLocked' }));
  });
});
```
**D – `src/main/vault/hello-helper.test.ts` (neu), vollständig:**
```ts
import { describe, expect, it } from 'vitest';

import { createHelloSigner, fakeHelloMode, helloSignature, readHelloReply } from './hello-helper';

const MISSING = 'C:\\shellherd-missing\\Shellherd.Hello.exe';
const challenge = Buffer.alloc(32, 7);

describe('Windows Hello helper connection', () => {
  it('ignores the run-app fake in a packaged build', async () => {
    expect(fakeHelloMode(true, { SHELLHERD_HELLO_FAKE: 'ok' })).toBeUndefined();
    expect(fakeHelloMode(false, { SHELLHERD_HELLO_FAKE: 'ok' })).toBe('ok');
    const packaged = createHelloSigner(MISSING, true, { SHELLHERD_HELLO_FAKE: 'ok' });
    expect(await packaged.available()).toBe(false);
    await expect(packaged.sign(challenge, false)).rejects.toMatchObject({ code: 'core.helloUnavailable' });
  });

  it('signs deterministically with the fake and reads the environment on every call', async () => {
    const env: NodeJS.ProcessEnv = { SHELLHERD_HELLO_FAKE: 'ok' };
    const signer = createHelloSigner(MISSING, false, env);
    const first = await signer.sign(challenge, false);
    expect(await signer.sign(challenge, false)).toEqual(first);
    env.SHELLHERD_HELLO_FAKE = 'reset';
    expect(await signer.sign(challenge, false)).not.toEqual(first);
    env.SHELLHERD_HELLO_FAKE = 'cancel';
    await expect(signer.sign(challenge, false)).rejects.toMatchObject({ code: 'core.helloCanceled' });
    env.SHELLHERD_HELLO_FAKE = 'unavailable';
    await expect(signer.sign(challenge, false)).rejects.toMatchObject({ code: 'core.helloUnavailable' });
    expect(await signer.available()).toBe(false);
  });

  it('runs one prompt at a time', async () => {
    const signer = createHelloSigner(MISSING, false, { SHELLHERD_HELLO_FAKE: 'ok' });
    const results = await Promise.allSettled([signer.sign(challenge, false), signer.sign(challenge, false)]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'core.helloBusy' } });
    expect((await signer.sign(challenge, false)).length).toBe(32);
  });

  it('reads the helper reply', () => {
    expect(readHelloReply('{"ok":true,"available":true}\r\n')).toEqual({ ok: true, available: true });
    const codes = { canceled: 'core.helloCanceled', notFound: 'core.helloStale', unavailable: 'core.helloUnavailable', x: 'core.helloFailed' };
    for (const [status, code] of Object.entries(codes)) {
      expect(() => readHelloReply(JSON.stringify({ ok: false, status }))).toThrow(expect.objectContaining({ code }));
    }
    for (const text of ['', 'garbage', 'null', '[]']) expect(() => readHelloReply(text)).toThrow(expect.objectContaining({ code: 'core.helloFailed' }));
  });

  it('accepts only signatures of RSA-2048 size or more', () => {
    expect(helloSignature(Buffer.alloc(256, 1).toString('base64'))).toEqual(Buffer.alloc(256, 1));
    for (const value of [Buffer.alloc(255, 1).toString('base64'), '', 42, undefined, 'A'.repeat(4097)]) {
      expect(() => helloSignature(value)).toThrow(expect.objectContaining({ code: 'core.helloFailed' }));
    }
  });
});
```
**D – `src/main/vault/hello.test.ts` (neu), vollständig:**
```ts
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../shared/errors';
import { HelloVaults, openVaultKey, sealVaultKey } from './hello';
import type { HelloSigner } from './hello-helper';
import { recentId } from './recent-vaults';

const SALT = 'c2FsdC1vZi10aGUtdmF1bHQ=';
const OTHER_SALT = 'b3RoZXItc2FsdA==';
const PATH = 'C:\\A\\v.term';

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'shellherd-hello-')), 'hello-unlock.json');
  const signer = { secret: 'one', fail: undefined as AppError | undefined };
  const sign = vi.fn(async (challenge: Buffer) => {
    if (signer.fail) throw signer.fail;
    return createHmac('sha256', signer.secret).update(challenge).digest();
  });
  const fake: HelloSigner = { available: async () => true, sign };
  const hello = new HelloVaults(file, fake);
  const vaultKey = randomBytes(32);
  const enable = (path = PATH, salt = SALT) => hello.enable(path, salt, () => Buffer.from(vaultKey));
  return { file, signer, sign, hello, vaultKey, enable };
}

describe('HelloVaults', () => {
  it('round-trips the vault key and never writes it in clear', async () => {
    const { file, hello, vaultKey, enable } = setup();
    expect(await enable()).toEqual({ available: true, enrolled: true });
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(vaultKey.toString('base64'));
    expect(text).not.toContain(vaultKey.toString('hex'));
    expect(await hello.unwrap(PATH, SALT)).toEqual(vaultKey);
  });

  it('zeroes the key it was given', async () => {
    const { hello } = setup();
    const copy = randomBytes(32);
    await hello.enable(PATH, SALT, () => copy);
    expect(copy.equals(Buffer.alloc(32))).toBe(true);
  });

  it('stores nothing when takeKey throws', async () => {
    const { file, hello } = setup();
    await expect(hello.enable(PATH, SALT, () => { throw new AppError('core.vaultLocked'); })).rejects.toMatchObject({ code: 'core.vaultLocked' });
    expect(() => readFileSync(file, 'utf8')).toThrow();
  });

  it('drops the entry of another salt without a prompt', async () => {
    const { hello, sign, enable } = setup();
    await enable();
    sign.mockClear();
    await expect(hello.unwrap(PATH, OTHER_SALT)).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(sign).not.toHaveBeenCalled();
    expect(await hello.status(PATH)).toEqual({ available: true, enrolled: false });
  });

  it('drops the entry when the signature changed', async () => {
    const { hello, signer, enable } = setup();
    await enable();
    signer.secret = 'two';
    await expect(hello.unwrap(PATH, SALT)).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(await hello.status(PATH)).toEqual({ available: true, enrolled: false });
  });

  it('keeps the entry after a cancel and drops every entry when the Hello key is gone', async () => {
    const { hello, signer, enable } = setup();
    await enable('C:\\A\\one.term');
    await enable('C:\\A\\two.term');
    signer.fail = new AppError('core.helloCanceled');
    await expect(hello.unwrap('C:\\A\\one.term', SALT)).rejects.toMatchObject({ code: 'core.helloCanceled' });
    expect((await hello.status('C:\\A\\one.term')).enrolled).toBe(true);
    signer.fail = new AppError('core.helloStale');
    await expect(hello.unwrap('C:\\A\\one.term', SALT)).rejects.toMatchObject({ code: 'core.helloStale' });
    expect((await hello.status('C:\\A\\two.term')).enrolled).toBe(false);
  });

  it('matches paths like the grant list and keeps at most eight vaults', async () => {
    const { hello, enable } = setup();
    await enable();
    expect((await hello.status('c:\\a\\V.TERM')).enrolled).toBe(true);
    expect((await hello.status('C:\\B\\v.term')).enrolled).toBe(false);
    await enable('c:\\a\\v.term');
    for (let index = 0; index < 8; index += 1) await enable(`C:\\many\\${index}.term`);
    expect((await hello.status(PATH)).enrolled).toBe(false);
    expect((await hello.status('C:\\many\\0.term')).enrolled).toBe(true);
  });

  it('forgets by path and by recent id', async () => {
    const { hello, enable } = setup();
    await enable();
    hello.forgetRecent(42);
    expect((await hello.status(PATH)).enrolled).toBe(true);
    hello.forgetRecent(recentId(PATH));
    expect((await hello.status(PATH)).enrolled).toBe(false);
    await enable();
    hello.forget(PATH);
    expect((await hello.status(PATH)).enrolled).toBe(false);
  });

  it('treats a broken file as empty and writes it anew', async () => {
    const { file, hello, enable } = setup();
    await enable();
    const valid = JSON.parse(readFileSync(file, 'utf8')) as { vaults: Record<string, unknown>[] };
    for (const content of ['{', JSON.stringify({ version: 2, vaults: valid.vaults }), JSON.stringify({ version: 1, vaults: [{ ...valid.vaults[0], extra: 1 }] })]) {
      writeFileSync(file, content);
      expect((await hello.status(PATH)).enrolled).toBe(false);
    }
    await enable();
    expect((await hello.status(PATH)).enrolled).toBe(true);
  });

  it('binds the wrapped key to the vault salt and uses a fresh nonce', () => {
    const challenge = randomBytes(32);
    const signature = (): Buffer => createHmac('sha256', 'one').update(challenge).digest();
    const vaultKey = randomBytes(32);
    const entry = sealVaultKey(PATH, SALT, vaultKey, challenge, signature());
    expect(openVaultKey(entry, signature())).toEqual(vaultKey);
    expect(entry.nonce).not.toBe(sealVaultKey(PATH, SALT, vaultKey, challenge, signature()).nonce);
    expect(() => openVaultKey({ ...entry, salt: OTHER_SALT }, signature())).toThrow(expect.objectContaining({ code: 'core.helloStale' }));
  });
});
```
**F – `src/main/vault/ipc.test.ts`:**
- Die Zeile 1 wird zu `import { mkdtempSync, readFileSync } from 'node:fs';`.
- Die Zeile 5 wird zu `import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';`.
- Direkt nach Zeile 6 (`import { IPC_CHANNELS } …`) kommen diese Importe:
```ts
import type { UnlockVaultResult } from '../../shared/ipc';
import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import { exampleVault } from '../../shared/vault/example';
import { encryptVault } from './crypto';
import { recentId } from './recent-vaults';
```
- Am Dateiende, nach dem bestehenden `describe`, anfügen. Es muss **nach** dem bestehenden Block stehen, denn dessen `beforeAll` registriert die Handler und setzt `mocks.userData`:
```ts

describe('Windows Hello in the IPC handlers (run-app fake)', () => {
  const filePath = 'C:\\hello\\v.term';
  const password = 'synthetic-hello-pw';
  const options = { memoryKiB: 16_384, iterations: 1, parallelism: 1 };
  let file: EncryptedVaultFile;
  beforeAll(async () => {
    process.env.SHELLHERD_HELLO_FAKE = 'ok';
    file = await encryptVault(exampleVault, password, options);
    expect(await invoke(IPC_CHANNELS.vaultDropFile, filePath)).toBe(filePath);
  });
  afterAll(() => { delete process.env.SHELLHERD_HELLO_FAKE; });
  beforeEach(async () => {
    process.env.SHELLHERD_HELLO_FAKE = 'ok';
    mocks.read.mockResolvedValue(file);
    await invoke(IPC_CHANNELS.unlockVault, { filePath, password });
    await invoke(IPC_CHANNELS.helloDisable);
  });

  it('refuses network, device and unknown paths before any file access', async () => {
    mocks.read.mockClear();
    for (const path of ['\\\\srv\\s\\v.term', '//srv/s/v.term', '\\\\?\\UNC\\srv\\s\\v.term', '\\\\.\\pipe\\v.term', 'C:\\never\\granted.term']) {
      await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath: path })).rejects.toMatchObject({ code: 'core.vaultPathNotAllowed' });
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('enables, locks and unlocks the same vault with Windows Hello', async () => {
    expect(await invoke(IPC_CHANNELS.helloEnable)).toEqual({ available: true, enrolled: true });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: true });
    expect(readFileSync(join(mocks.userData, 'hello-unlock.json'), 'utf8')).not.toContain(password);
    await invoke(IPC_CHANNELS.lockVault);
    const result = await invoke(IPC_CHANNELS.helloUnlock, { filePath }) as UnlockVaultResult;
    expect(result.vault).toEqual(exampleVault);
    expect(result.filePath).toBe(filePath);
  });

  it('stores nothing when the vault is locked during the enable prompt', async () => {
    const enabling = invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    await expect(enabling).rejects.toMatchObject({ code: 'core.vaultLocked' });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });

  it('drops the entry of a replaced file without a prompt', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    mocks.read.mockResolvedValue(await encryptVault(exampleVault, password, options));
    process.env.SHELLHERD_HELLO_FAKE = 'cancel';   // a prompt would end in core.helloCanceled
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath })).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });

  it('drops the entry after a re-created Windows Hello key', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    process.env.SHELLHERD_HELLO_FAKE = 'reset';
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath })).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });

  it('keeps the entry after a canceled prompt', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    process.env.SHELLHERD_HELLO_FAKE = 'cancel';
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath })).rejects.toMatchObject({ code: 'core.helloCanceled' });
    process.env.SHELLHERD_HELLO_FAKE = 'ok';
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: true });
  });

  it('disables, rejects bad input and needs an unlocked vault to enable', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    expect(await invoke(IPC_CHANNELS.helloDisable)).toEqual({ available: true, enrolled: false });
    await expect(invoke(IPC_CHANNELS.helloStatus, 42)).rejects.toMatchObject({ code: 'core.invalidRequest' });
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath: 42 })).rejects.toMatchObject({ code: 'core.vaultFileMissing' });
    await invoke(IPC_CHANNELS.lockVault);
    await expect(invoke(IPC_CHANNELS.helloEnable)).rejects.toMatchObject({ code: 'core.vaultLocked' });
  });

  it('forgets the entry with the recent-list entry', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.removeRecentVault, recentId(filePath));
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });
});
```
**G1 – `src/renderer/src/hello.test.ts` (neu), vollständig:**
```ts
import { describe, expect, it } from 'vitest';

import { AppError } from '../../shared/errors';
import { helloReady, isHelloCancel } from './hello';

describe('Windows Hello in the renderer', () => {
  it('recognizes a canceled prompt, also through IPC', () => {
    expect(isHelloCancel(new AppError('core.helloCanceled'))).toBe(true);
    expect(isHelloCancel(new Error(`Error invoking remote method 'vault:hello-unlock': ${new AppError('core.helloCanceled').message}`))).toBe(true);
    expect(isHelloCancel(new AppError('core.helloStale'))).toBe(false);
    expect(isHelloCancel(new Error('x'))).toBe(false);
  });

  it('offers the button only when Windows Hello is set up and the vault enrolled', () => {
    expect(helloReady(null)).toBe(false);
    expect(helloReady({ available: false, enrolled: true })).toBe(false);
    expect(helloReady({ available: true, enrolled: false })).toBe(false);
    expect(helloReady({ available: true, enrolled: true })).toBe(true);
  });
});
```

### K6 – Build robust gegen gesperrte Helfer (B): `scripts/build-hello.mjs` und `scripts/build-rdp-host.mjs`
**Befund:** Der Hello-Helfer läuft nur kurz (rund 150 ms für `status`, höchstens 120 s für eine Abfrage). Gesperrt ist er also nur, wenn ein Build genau in diesem Moment läuft.

Der Fehler des Nutzers (`CS0016` bei laufender Demo-App) kommt vom **RDP-Helfer**. Der läuft als Dauerprozess, solange eine RDP-Sitzung offen ist. `dev` ruft `build:rdp-host` **vor** `build:hello` auf und bricht schon dort ab.

**Fix für beide Skripte:** `csc` läuft nur, wenn die Quellen, das Manifest oder das Skript selbst neuer sind als das vorhandene Exe. Schlägt `csc` trotzdem fehl, steht eine verständliche Meldung da, und der Exit-Code ist 1. Ist die vorhandene exe aktuell, ist eine offene Datei also kein Problem mehr. Ist sie veraltet und gesperrt, bricht der Build ab, statt eine veraltete exe auszuliefern.

`git checkout` setzt bei geänderten Dateien die mtime neu, also wird nach einem Branch-Wechsel neu gebaut. Ein `--force` gibt es nicht; in CI und im Release ist `out/` immer leer.

**`scripts/build-hello.mjs` (neu), vollständig** (ersetzt Spec 3.2, im Scratchpad gelaufen):
```js
// Builds the Windows Hello helper with the C# compiler that ships with Windows (.NET Framework 4.8).
// WinRT types come from the metadata in System32\WinMetadata: no SDK, NuGet or Visual Studio required.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('Hello-Helfer wird nur unter Windows gebaut - übersprungen.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'native', 'Shellherd.Hello');
// --out <dir> builds elsewhere, e.g. while a running Shellherd locks out/hello.
const outFlag = process.argv.indexOf('--out');
const outputDir = outFlag > 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : join(root, 'out', 'hello');
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
const framework = join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const metadata = join(systemRoot, 'System32', 'WinMetadata');
const csc = join(framework, 'csc.exe');
// System.Runtime.WindowsRuntime.dll (AsTask, ToArray) expects the SDK's merged Windows.winmd; Program.cs does without it on purpose.
const references = [
  ...['System.dll', 'System.Core.dll', 'System.Runtime.dll', 'System.Web.Extensions.dll'].map(file => join(framework, file)),
  ...['Windows.Foundation.winmd', 'Windows.Security.winmd', 'Windows.Storage.winmd'].map(file => join(metadata, file)),
];
for (const file of [csc, ...references]) {
  if (!existsSync(file)) {
    console.error(`Fehlt: ${file}`);
    process.exit(1);
  }
}

const executable = join(outputDir, 'Shellherd.Hello.exe');
const inputs = [join(source, 'Program.cs'), join(source, 'app.manifest'), fileURLToPath(import.meta.url)];
const builtAt = existsSync(executable) ? statSync(executable).mtimeMs : 0;
// Up to date: no csc run, so a Shellherd that holds the helper open does not break `npm run dev` (CS0016).
if (builtAt > 0 && inputs.every(file => statSync(file).mtimeMs <= builtAt)) {
  console.log(`Hello-Helfer ist aktuell: ${executable}`);
} else {
  mkdirSync(outputDir, { recursive: true });
  try {
    execFileSync(csc, [
      '/nologo', '/noconfig', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+',
      `/win32manifest:${join(source, 'app.manifest')}`,
      ...references.map(reference => `/reference:${reference}`),
      `/out:${executable}`,
      join(source, 'Program.cs'),
    ], { stdio: 'inherit' });
  } catch {
    console.error('Hello-Helfer nicht gebaut. Hält ein laufendes Shellherd die Datei offen, Shellherd beenden und erneut bauen oder mit --out <Ordner> woanders bauen.');
    process.exit(1);
  }
}

// Smoke test without a prompt: "status" only asks whether Windows Hello is set up.
const reply = JSON.parse(execFileSync(executable, [], { input: '{"op":"status"}\n', encoding: 'utf8', windowsHide: true, timeout: 30_000 }));
if (typeof reply.ok !== 'boolean') {
  console.error(`Hello-Helfer antwortet unerwartet: ${JSON.stringify(reply)}`);
  process.exit(1);
}
console.log(`Hello-Helfer bereit: ${executable} (Windows Hello ${reply.available === true ? 'verfügbar' : 'nicht verfügbar'})`);
```
**`scripts/build-rdp-host.mjs`**, drei Änderungen (im Scratchpad gelaufen):
1. Zeile 4 wird zu `import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';`.
2. Direkt nach `const sources = …;` einfügen:
```js
const executable = join(outputDir, 'Shellherd.RdpHost.exe');
const builtAt = existsSync(executable) ? statSync(executable).mtimeMs : 0;
// Up to date: no csc run, so a Shellherd with an open RDP session does not break `npm run dev` (CS0016).
if (builtAt > 0 && [...sources, join(source, 'app.manifest'), fileURLToPath(import.meta.url)].every(file => statSync(file).mtimeMs <= builtAt)) {
  console.log(`RDP-Helfer ist aktuell: ${executable}`);
  process.exit(0);
}
```
3. Der Block ab `mkdirSync(outputDir, { recursive: true });` bis zum Dateiende wird ersetzt durch:
```js
mkdirSync(outputDir, { recursive: true });
try {
  execFileSync(csc, [
    '/nologo', '/noconfig', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+',
    `/win32manifest:${join(source, 'app.manifest')}`,
    ...references.map(reference => `/reference:${join(framework, reference)}`),
    `/out:${executable}`,
    ...sources,
  ], { stdio: 'inherit' });
} catch {
  console.error('RDP-Helfer nicht gebaut. Hält ein laufendes Shellherd die Datei offen, Shellherd beenden und erneut bauen oder mit --out <Ordner> woanders bauen.');
  process.exit(1);
}
console.log(`RDP-Helfer gebaut: ${executable}`);
```
`Program.cs` und `app.manifest` aus Spec 3.2 gelten wörtlich; sie sind unverändert gebaut und gestartet worden.

### K7 – `HelloSetting.tsx` (G1): Fokus bleibt während der Abfrage
Spec 3.10 gilt, nur das `<input>` wird wörtlich zu (zwei Zeilen, dazu die Kommentarzeile davor):
```tsx
      {/* aria-disabled while the prompt is open: the checkbox keeps the focus; the controlled value ignores clicks meanwhile. */}
      <input type="checkbox" checked={status.enrolled} disabled={busy} aria-disabled={pending || undefined} aria-describedby={`${id}-hint`}
        onChange={event => { if (!pending) change(event.target.checked); }} />
```
Grund: Wäre das Kästchen `disabled`, verlöre es während der Abfrage den Fokus. Das ist dieselbe Regel wie bei den Knöpfen (Spec R3.2).

### K8 – `App.tsx` (G2): Fokus nach „passt nicht mehr“ auf dem Öffnen-Bildschirm
Spec 3.11 Punkt 2 gilt, nur der `useEffect` wird ersetzt. `helloOpenShown` kommt direkt nach `helloOpenRef` dazu:
```tsx
  const helloOpenShown = useRef(false);
  const openHelloReady = helloReady(openHello);
  useEffect(() => {
    if (openHelloReady && !passwordInputRef.current?.value) helloOpenRef.current?.focus();
    // A stale key hides the focused button: the password is the way on.
    if (!openHelloReady && helloOpenShown.current && document.activeElement === document.body) passwordInputRef.current?.focus();
    helloOpenShown.current = openHelloReady;
  }, [openHelloReady]);
```
Grund: Spec R3.4 verlangt den Fokus im Passwortfeld, sobald der Knopf verschwindet. Ein `focus()` direkt im `catch` von `handleHelloOpen` greift nicht, denn das Feld ist bis zum nächsten Render noch `disabled={busy}`.

Der Sperrbildschirm braucht das nicht. `LockScreen` fokussiert das Feld selbst, und das ist dort nur `readOnly`.

### K9 – run-app (H): Selektor im Block `lock`, Text in SKILL.md
- `.claude/skills/run-app/screens.mjs`, Block `lock()`: Beide Vorkommen von `click('.lock-screen .secondary-button')` werden zu `click('.lock-screen .form-actions .secondary-button')`. Der Hello-Knopf steht außerhalb von `.form-actions`, damit trifft der Block nie den Hello-Knopf.
- Im neuen Block `hello` (Spec 6.2) wird `await click('.lock-screen button:has-text("Andere Vault-Datei")');` zu `await click('.lock-screen .form-actions .secondary-button');`. Die Kommentarzeile darüber entfällt.
- SKILL.md, neuer Stolperstein: Es gilt der Text aus Spec 6.3 **ohne** die letzten zwei Sätze („Bricht der Treiber … über `/eval` aufrufen.“). An ihre Stelle tritt: „Den Fake nie außerhalb des Treibers setzen: Einträge, die der Fake verpackt, lassen sich mit dem festen Fake-Schlüssel entpacken (`npm run dev` nutzt das echte Profil).“

### K10 – Release-Kommentar (B)
`.github/workflows/release.yml`: Der Kommentar `# check:version, typecheck, electron-vite build, RDP helper, then electron-builder` wird zu `# check:version, typecheck, electron-vite build, RDP and Hello helpers, then electron-builder`.

### K11 – Dateien schreiben, Zeilenenden
Die bestehenden Dateien haben CRLF. Die Umsetzer ändern sie mit Edit-Werkzeugen und schreiben nie die ganze Datei mit LF neu. Neue Dateien sind beliebig, `core.autocrlf` ist `true`.

## 4. Rulings

- **V-R1 Determinismus bestätigt, M3 bleibt Release-Gate.**
  - RSASSA-PKCS1-v1_5 ist nach RFC 8017 (§8.2, §9.2 EMSA-PKCS1-v1_5) deterministisch: Die Kodierung enthält weder Salt noch Zufall, und dieselbe Nachricht ergibt mit demselben Schlüssel dieselbe Signatur. Das gilt auch im TPM (`TPM_ALG_RSASSA`).
  - Microsofts Windows-Hello-Doku für `KeyCredentialManager` beschreibt RSA-2048-Schlüssel. Der Server im offiziellen Login-Beispiel prüft mit `AsymmetricAlgorithmNames.RsaSignPkcs1Sha256`. Das ist ausdrücklich PKCS#1 v1.5 mit SHA-256, nicht PSS und nicht ECDSA.
  - **Kein Blocker.** Die Belegquelle ist mein Kenntnisstand der Microsoft-Doku; in dieser Sitzung war kein Abruf möglich.
  - Lokal ist es ohne Dialog nicht belegbar, denn der Schlüssel `Shellherd.VaultUnlock` existiert nicht, und `create` ist verboten. M3 entscheidet weiter vor dem Release.
  - Wäre die Signatur doch zufällig, wäre das ein sicheres Versagen: „passt nicht mehr“, Eintrag gelöscht, Passwort geht.
- **V-R2 Fake-Schranke `app.isPackaged` reicht, mit dokumentierter Grenze.**
  - `isPackaged` prüft nur, ob die exe `electron.exe` heißt. Wer die installierte `Shellherd.exe` in `electron.exe` umbenennt, schaltet den Fake ein.
  - Das braucht Codeausführung unter dem Konto. Damit lässt sich ohnehin `app.asar` im nutzerbeschreibbaren Installationsordner ersetzen (Spec-Risiko 6). Neue Angriffsfläche entsteht also nicht.
  - Ein mit dem Fake geöffneter echter Eintrag ergibt GCM-Fehler und `helloStale`. Ein Geheimnis wird dabei nicht frei, schlimmstenfalls wird der Eintrag gelöscht.
  - Der Renderer kann die Variable nicht setzen. Es gibt keinen IPC-Kanal, der `process.env` schreibt; die `/main`-Route gehört Playwright und existiert nur unter dem Treiber.
  - Hingenommen. Dazu der Hinweis in SKILL.md (K9).
- **V-R3 `vault:hello-status` ohne `vaultPathAllowed`.** Der Kanal liest die Vault-Datei nie. `grantKey` ist eine reine Zeichenkettenoperation (`win32.resolve`, kein Dateizugriff). Ein kompromittierter Renderer erfährt nur, ob für einen Pfad ein Eintrag existiert. Hingenommen.
- **V-R4 Abfrage ohne Klick durch einen kompromittierten Renderer.** `helloUnlock` lässt sich ohne Klick aufrufen und zeigt dann eine echte Windows-Abfrage. Ohne Bestätigung des Nutzers entsteht nichts. Mit Bestätigung erhält der Renderer nur, was er nach einer Passworteingabe auch erhielte: `vault`. Der Vault-Schlüssel verlässt Main nie. R3.3 gilt für die UI; im Main gibt es keine Drosselung. Hingenommen.
- **V-R5 Kein Fenster-Handle für die Abfrage.**
  - `KeyCredential` hat keine dokumentierte HWND-Schnittstelle; `IUserConsentVerifierInterop` gilt nur für das verworfene Ja/Nein.
  - Der Helfer bekommt kein Handle und nimmt keinen Pfad an. Er liest nur eine stdin-Zeile und ruft WinRT auf. Ein Dateizugriff findet nicht statt.
  - `FindWindow` sucht nach dem Klassennamen `Credential Dialog Xaml Host`. Trifft es ein fremdes Fenster dieser Klasse, ist das harmlos, denn es wird nur nach vorn geholt. Bestätigt durch M1 und M7.
  - Geprüft für Main, und zwar am Code und im Scratchpad:
    - Zeitlimit mit `kill` und `close`;
    - kaputte oder halbe Ausgabe → `helloFailed`;
    - `ENOENT` → `helloUnavailable`;
    - stdin-Fehler abgefangen;
    - Ausgabe auf 16 KiB begrenzt;
    - nur eine Abfrage zur Zeit.
- **V-R6 `notFound` löscht alle Einträge (R2.3 bestätigt).** Das passiert nur mit `create: false` nach `IsSupportedAsync() === true`. Ein vorübergehendes `NotFound`, etwa in RDP, kostet höchstens ein neues Einschalten und gibt nichts frei. Hingenommen, M13 prüft das.
- **V-R7 Die Signatur liegt kurz als JS-String vor.** Die base64-Ausgabe des Helfers ist ein unveränderlicher V8-String und lässt sich nicht nullen. Der Buffer wird in `wrappingKey` genullt. Dasselbe gilt schon für das Passwort im IPC. Hingenommen.
- **V-R8 Die Aktualität richtet sich nach der mtime (K6), nicht nach einem Hash.** Das ist einfach, und nach jedem `git checkout` wird richtig gebaut. Einen Fall „exe neuer als die Quellen, aber aus anderen Quellen gebaut“ gibt es nur nach einem Kopieren von Hand. Hingenommen.
- **V-R9 Der Fehler nach dem Wechsel während der Abfrage ist `core.vaultLocked`.** Der Text lautet „Es ist kein Vault entsperrt.“. Er passt für Sperre und Auto-Sperre, beim seltenen Wechsel während der Abfrage nur ungefähr. Ein eigener Code lohnt sich nicht.

## 5. Sicherheitsprüfung (Ergebnis)

| Frage | Ergebnis |
|---|---|
| **HKDF** | `hkdfSync('sha256', IKM = Signatur, salt = Challenge (32 Byte, zufällig je Einschalten, öffentlich), info = 'shellherd-hello-v1', L = 32)` ist korrekt nach RFC 5869. Das Geheimnis steckt allein in der Signatur (256 Byte RSA, nur nach Geste); K1 erzwingt die Mindestlänge. `Buffer.from(ArrayBuffer)` teilt den Speicher, `key.fill(0)` nullt also das Ergebnis selbst. |
| **AES-GCM** | Die Nonce ist bei jeder Verpackung frisch (`randomBytes(12)`, belegt). Zusätzlich ist auch der Schlüssel je Einschalten neu, weil die Challenge neu ist. Eine Wiederverwendung der Nonce ist ausgeschlossen. Der Tag wird in `decipher.final()` geprüft, seine Länge erzwingt das Schema (16 Byte). Die AAD bindet `kdf.salt`. Andere Signatur, anderer Salt und ein anderer Tag ergeben `helloStale` (belegt). |
| **Schlüssel im Speicher** | `helloUnlock`: Die Datei wird **vor** der Abfrage gelesen, der Schlüssel geht nach dem Entpacken sofort in die Session. Bei einem Fehler wird er genullt. `helloEnable`: Mit B2/K2 bis K4 entsteht die Kopie erst nach der Abfrage, nur für dieselbe Session, und sie wird im `finally` genullt. `openVaultKey` nullt seinen Zwischenpuffer (K2). Signatur und Verpackungsschlüssel werden genullt. |
| **Manipulierte `hello-unlock.json`** | Ein Eintrag wirkt nur für den angefragten Pfad (`grantKey`). Sein `filePath` wird nie geöffnet. Die Freigabeprüfung läuft auf dem **angefragten** Pfad und **vor** jedem Lesen (`requireAllowedPath`, belegt mit UNC-, Geräte- und unbekannten Pfaden, `mocks.read` wird nicht aufgerufen). Ein umgehängter Eintrag öffnet nur eine Datei mit demselben Salt, also eine Kopie desselben Vaults. Einen gültigen Eintrag kann ein Angreifer ohne Hello-Geste nicht erzeugen. Kaputt, `version` ≠ 1, ein Feld zu viel oder mehr als 8 Einträge ergeben „leer“, das ist höchstens ein Ausfall. |
| **Renderer-Eingaben** | `helloEnable` und `helloDisable` nehmen nichts entgegen; Pfad, Salt und Schlüssel kommen aus der Session. `helloUnlock` nimmt nur `filePath` (Typ und Länge geprüft), `helloStatus` nur einen String bis 4 096 Zeichen. Ein Vault-Schlüssel lässt sich nicht einschleusen. Alle Kanäle laufen über `guard` = `requireMain`. |
| **Freigabeliste** | Sie gilt auch für den Hello-Weg: eine gemeinsame `requireAllowedPath` für `unlockVault` und `helloUnlock`. Der Hello-Weg gibt keinen Pfad frei. |
| **Fake** | Im Paket ist er wirkungslos (`fakeHelloMode(true, …)`, Test), Grenze siehe V-R2. Der Renderer kann ihn nicht setzen. |
| **Lebenszyklus** | Keinen ungültigen Eintrag, der etwas öffnet: Neue Datei (`vault:save`, K4) oder ersetzte Datei (Salt-Prüfung ohne Abfrage) entfernt den Eintrag. Auch neu eingerichtetes Hello (alle), `×` in `Zuletzt benutzt` (alle Schreibweisen, K2) und Ausschalten entfernen ihn. Sperre und Wechsel während des Einschaltens speichern nichts (B2). `saveCurrentVault` behält Salt und Schlüssel; das Anhängen von `.term` lässt den alten Eintrag für die alte, unveränderte Datei stehen, harmlos. „Passwort ändern“ gibt es nicht (R2.1). Ein gelöschter Vault behält seinen Eintrag, bis acht neuere ihn verdrängen; der Eintrag öffnet nur Kopien bzw. Sicherungen derselben Datei und nur mit Geste. |
| **Helfer** | Das Protokoll ist robust: eine Zeile hinein, eine heraus, Exit 0, kaputte Eingaben ergeben `failed` (belegt). In Main gibt es Zeitlimit, `kill`, eine Ausgabegrenze, `ENOENT`, `shell: false`, keine Argumente, `stderr` verworfen. Den Pfad bestimmt nur Main (`resourcesPath` bzw. `out/hello`). |
| **Paketierung** | Die Ergänzungen in `electron-builder.yml` (`!out/hello/**`, `extraResources`) sowie die Scripts `dev`, `build` und `build:hello` passen. CI baut mit Rauchtest. Die Gefahr einer gesperrten Datei behebt K6, auch für den RDP-Helfer, der den gemeldeten `CS0016` verursacht hat. Läuft der Rauchtest auf dem CI-Server in die Zeitgrenze von 30 s, fallen CI **und** Release aus. Den Fall sieht man zuerst in CI auf `staging` (Spec-Risiko 4). |
| **Projektregeln** | Main liest den Vault nur über die bestehende Freigabe. Keine Secrets im Log: Der Helfer schreibt nur stdout an Main, und `AppError` trägt keinen Text. Keine Ausführung ohne Klick: Ohne Klick startet der Helfer nur mit `status`, das keine Abfrage zeigt. Die kubeconfig ist nicht berührt. |

## 6. Endgültige Wellen und Tasks (exklusive Dateien)

Gate nach **jeder** Welle: `npm run typecheck` und `npx vitest run` vollständig grün. Der bekannte Flake in `fakes.test.mjs` (mfa) gilt nach einem erneuten Lauf als grün.

Umsetzer schreiben nur ihre eigenen Dateien und committen nie. Innerhalb einer Welle darf ein Task den Vertrag eines Nachbarn derselben Welle benutzen.

Belegt im Scratchpad:
- Nach Welle 1 sind beide `tsc`-Läufe und alle Tests grün.
- Nach Welle 2 sind `tsc` und 163 Dateien mit 2 544 Tests grün.

| Welle | Task | Dateien (exklusiv) | Inhalt | Pflicht-Tests |
|---|---|---|---|---|
| 1 | **A** Vertrag | `src/shared/ipc.ts`, `src/preload/index.ts` | Spec 3.1 wörtlich | keine (Typecheck) |
| 1 | **B** Helfer und Paketierung | `native/Shellherd.Hello/Program.cs` (neu), `native/Shellherd.Hello/app.manifest` (neu), `scripts/build-hello.mjs` (neu), `scripts/build-rdp-host.mjs`, `electron-builder.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` | Spec 3.2 (`Program.cs`, `app.manifest`, `electron-builder.yml`, `ci.yml`) wörtlich, K6, K10; danach `node scripts/build-hello.mjs` zweimal ausführen (bauen, „ist aktuell“) und beide Ausgaben ins Ledger | Rauchtest im Skript |
| 1 | **C** Krypto und Session | `src/main/vault/crypto.ts`, `src/main/vault/crypto.test.ts`, `src/main/vault/session.ts`, `src/main/vault/session.test.ts` | Spec 3.4, Spec 3.5 mit K3 | K5/C |
| 1 | **D** Hello in Main | `src/main/vault/hello.ts` (neu), `src/main/vault/hello.test.ts` (neu), `src/main/vault/hello-helper.ts` (neu), `src/main/vault/hello-helper.test.ts` (neu), `src/shared/locales/{de-DE,en-US}/errors/core.json` | K1, K2, Spec 3.9 (Keys direkt nach `vaultPathNotAllowed`, in der Reihenfolge `helloCanceled`, `helloUnavailable`, `helloStale`, `helloFailed`, `helloBusy`) | K5/D |
| 1 | **E** Doku und Version | `docs/handbuch.md`, `docs/manual.md`, `CHANGELOG.md`, `CHANGELOG.en.md`, `package.json`, `package-lock.json` (nur die Root-Version oben und `packages[""].version` auf 0.26.0) | Spec 3.3, Abschnitt 5 wörtlich | `version.test.ts` grün (2 Punkte je Sprache, Datum `2026-10-25`) |
| 2 | **F** IPC | `src/main/vault/ipc.ts`, `src/main/vault/ipc.test.ts` | Spec 3.8 mit K4 | K5/F, die bestehenden 4 Tests bleiben unverändert grün |
| 2 | **G1** Renderer-Basis | `src/renderer/src/hello.ts` (neu), `src/renderer/src/hello.test.ts` (neu), `src/renderer/src/components/HelloSetting.tsx` (neu), `src/renderer/src/components/SettingsDialog.tsx`, `src/shared/locales/{de-DE,en-US}/app.json` | Spec 3.10 mit K7; Block `hello` als **letzter** Schlüssel der obersten Ebene in `app.json` | K5/G1 |
| 2 | **G2** Einbindung | `src/renderer/src/components/LockScreen.tsx`, `src/renderer/src/App.tsx` | Spec 3.11 mit K8 | keine (run-app) |
| 3 | **H** Demo | `.claude/skills/run-app/driver.mjs`, `.claude/skills/run-app/screens.mjs`, `.claude/skills/run-app/SKILL.md` | Spec 6 mit K9 | `fakes.test.mjs` bleibt grün |

Folgerungen aus der Tabelle:
- G1 macht `vaultPath` zur Pflicht-Prop von `SettingsDialog`, G2 reicht sie in `App.tsx` durch. Beide liegen in Welle 2, also ist der Typecheck erst am Wellenende grün.
- `app:hello.*` legt G1 an, G2 benutzt die Keys. Das ist dieselbe Welle, (d) ist am Wellenende erfüllt.
- `ci.yml` (B) ruft `build:hello` auf, das E in `package.json` anlegt. Beide liegen in Welle 1.

Nach Welle 3 erledigt der Orchestrator Folgendes:
1. `npm run build` lokal. Darin baut `build:hello` und läuft der Rauchtest.
2. run-app nach Spec 6, jeden der vier Screenshots ansehen. Den Block `lock` laufen lassen, er belegt K9.
3. Prüfer-Review.
4. Die manuellen Tests M1 bis M13 durch den Nutzer. **M3 entscheidet über das Release** (V-R1).
5. Release 0.26.0 nur über `staging`.

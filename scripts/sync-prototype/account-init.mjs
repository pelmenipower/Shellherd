// Interactive setup: password is not accepted through argv or environment variables.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { CUSTOM_PASSWORD_MIN, createAccount, generatePassword, writeInitialPassword } from './account-auth.mjs';
let terminal; let muted = false; let created = false; let success = false; let passwordFile = null;
const target = process.argv[2];
try {
  if (!target || process.argv.length !== 3 || !process.stdin.isTTY || !process.stdout.isTTY) throw Error('Interactive terminal required');
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
  terminal = createInterface({ input: process.stdin, output, terminal: true });
  terminal.on('SIGINT', () => { terminal.close(); });
  const username = await terminal.question('Server-Benutzername: ');
  const useGenerated = !/^n/i.test((await terminal.question('Generiertes Passwort verwenden? [J/n] ')).trim());
  let password;
  if (useGenerated) {
    password = generatePassword();
  } else {
    muted = true; process.stdout.write('Serverpasswort (mindestens 20 Zeichen, NICHT das Vault-Passwort): ');
    password = await terminal.question(''); process.stdout.write('\nServerpasswort wiederholen: ');
    const repeat = await terminal.question(''); process.stdout.write('\n');
    if (password !== repeat || password.length < CUSTOM_PASSWORD_MIN) throw Error('Mismatch');
  }
  const account = await createAccount(username, password);
  const handle = await open(target, 'wx', 0o600); created = true;
  if (useGenerated) {
    // The generated password never goes to stdout (container logs, scrollback): it lands in a 0600 file next to the config.
    // Written only after the exclusive create succeeded, so a repeated init cannot replace the live account's file.
    passwordFile = await writeInitialPassword(target, password);
    process.stdout.write(`Serverpasswort liegt in ${passwordFile} (nur für dich lesbar). Die Datei wird nach der ersten Geräteanmeldung gelöscht.\n`);
  }
  try { await handle.writeFile(JSON.stringify({ serverId: randomBytes(32).toString('hex'), namespace: randomBytes(16).toString('hex'), passwordPolicy: useGenerated ? 'generated' : 'custom', account })); await handle.sync(); }
  finally { await handle.close(); }
  success = true; console.log('Serverkonfiguration mit Passwort-Hash erstellt. Keine Vault-Schlüssel gespeichert.');
} catch { console.error('Einrichtung fehlgeschlagen. Interaktives Terminal, Benutzernamen, Passwörter und neuen Dateipfad prüfen.'); process.exitCode = 1; }
finally { terminal?.close(); if (created && !success) await unlink(target).catch(() => {}); if (passwordFile && !success) await unlink(passwordFile).catch(() => {}); }

const READ_ONLY = 'Die Vault-Datei ist schreibgeschützt.';

const MESSAGES: ReadonlyMap<string, string> = new Map([
  ['EACCES', READ_ONLY],
  ['EPERM', READ_ONLY],
  ['EROFS', READ_ONLY],
  ['EBUSY', 'Die Vault-Datei ist von einem anderen Programm gesperrt.'],
  ['ENOENT', 'Der Ordner der Vault-Datei ist nicht erreichbar.'],
  ['ENOSPC', 'Auf dem Laufwerk ist kein Platz mehr.'],
]);

/** German cause for a failed vault write, by errno code; undefined for unknown codes. */
export function vaultWriteMessage(code: string | undefined): string | undefined {
  return code === undefined ? undefined : MESSAGES.get(code);
}

/** True when `text` is one of the messages above (the renderer passes only these through). */
export function isVaultWriteMessage(text: string): boolean {
  return new Set(MESSAGES.values()).has(text);
}

export interface EncryptedVaultFile {
  format: 'terminus-encrypted-vault';
  version: 1;

  kdf: {
    algorithm: 'argon2id';

    /**
     * Zufälliger Salt als Base64.
     * Verhindert vorberechnete Passworttabellen.
     */
    salt: string;

    /**
     * Speicherbedarf von Argon2id in KiB.
     */
    memoryKiB: number;

    /**
     * Anzahl der Argon2id-Durchläufe.
     */
    iterations: number;

    /**
     * Anzahl paralleler Berechnungsstränge.
     */
    parallelism: number;
  };

  cipher: {
    algorithm: 'aes-256-gcm';

    /**
     * Zufälliger Nonce als Base64.
     * Muss für jede Verschlüsselung neu erzeugt werden.
     */
    nonce: string;

    /**
     * Erkennt falsche Passwörter und manipulierte Dateien.
     */
    authTag: string;
  };

  /**
   * Verschlüsselter JSON-Inhalt als Base64.
   */
  payload: string;
}
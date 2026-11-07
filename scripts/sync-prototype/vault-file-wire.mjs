// Strict ciphertext container check, not a claim that the server can verify encryption.
const check = ok => { if (!ok) throw Error('Encrypted Vault rejected'); };
const keys = (value, expected) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected.split(',').sort().join(','));
function base64(value, size) { check(typeof value === 'string' && value.length <= 1048576); const b = Buffer.from(value, 'base64'); check(b.toString('base64') === value && (size === undefined ? b.length > 0 : b.length === size)); }
export function validateVaultFile(wire) {
  check(typeof wire === 'string' && Buffer.byteLength(wire) <= 1048576);
  const file = JSON.parse(wire); check(JSON.stringify(file) === wire);
  keys(file, 'format,version,kdf,cipher,payload'); check(file.format === 'terminus-encrypted-vault' && file.version === 1);
  keys(file.kdf, 'algorithm,salt,memoryKiB,iterations,parallelism');
  check(file.kdf.algorithm === 'argon2id' && file.kdf.memoryKiB === 65536 && file.kdf.iterations === 3 && file.kdf.parallelism === 1); base64(file.kdf.salt, 16);
  keys(file.cipher, 'algorithm,nonce,authTag'); check(file.cipher.algorithm === 'aes-256-gcm'); base64(file.cipher.nonce, 12); base64(file.cipher.authTag, 16); base64(file.payload);
  return file;
}

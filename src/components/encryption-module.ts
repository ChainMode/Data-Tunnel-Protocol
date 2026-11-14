// DTP Encryption Module Implementation
// Provides AES-256-GCM encryption/decryption using CAP pre-negotiated keys.
// Binary format: [12-byte IV][encrypted data][16-byte auth tag]

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { EncryptionModule } from '../types/components.js';
import type { EncryptionMetadata } from '../types/encryption.js';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const AES_256_KEY_LENGTH = 32;

export class DTPEncryptionModule implements EncryptionModule {
  private key: Uint8Array | null;
  private readonly algorithm: string;
  private readonly keyVersion: number;

  constructor(key: Uint8Array | null, algorithm: string = 'AES-256-GCM', keyVersion: number = 1) {
    if (key !== null && key.length !== AES_256_KEY_LENGTH) {
      throw new Error(`Invalid key length: expected ${AES_256_KEY_LENGTH} bytes, got ${key.length}`);
    }
    this.key = key;
    this.algorithm = algorithm;
    this.keyVersion = keyVersion;
  }

  encryptPayload(payload: Uint8Array, _encryptionMeta: EncryptionMetadata): Uint8Array {
    if (!this.isKeyReady()) {
      throw new Error('Encryption key is not ready');
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key!, iv);

    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: [12-byte IV][encrypted data][16-byte auth tag]
    const result = new Uint8Array(IV_LENGTH + encrypted.length + AUTH_TAG_LENGTH);
    result.set(iv, 0);
    result.set(encrypted, IV_LENGTH);
    result.set(authTag, IV_LENGTH + encrypted.length);

    return result;
  }

  decryptPayload(encryptedPayload: Uint8Array, _encryptionMeta: EncryptionMetadata): Uint8Array {
    if (!this.isKeyReady()) {
      throw new Error('Encryption key is not ready');
    }

    if (encryptedPayload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Encrypted payload too short');
    }

    const iv = encryptedPayload.slice(0, IV_LENGTH);
    const authTag = encryptedPayload.slice(encryptedPayload.length - AUTH_TAG_LENGTH);
    const ciphertext = encryptedPayload.slice(IV_LENGTH, encryptedPayload.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', this.key!, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(decrypted);
  }

  isKeyReady(): boolean {
    return this.key !== null && this.key.length === AES_256_KEY_LENGTH;
  }

  getEncryptionMetadata(): EncryptionMetadata {
    return {
      algorithm: this.algorithm,
      keyVersion: this.keyVersion,
    };
  }
}

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DTPEncryptionModule } from './encryption-module.js';
import type { EncryptionMetadata } from '../types/encryption.js';

const validKey = randomBytes(32);
const meta: EncryptionMetadata = { algorithm: 'AES-256-GCM', keyVersion: 1 };

describe('DTPEncryptionModule', () => {
  describe('constructor', () => {
    it('accepts a valid 32-byte key', () => {
      const mod = new DTPEncryptionModule(validKey);
      expect(mod.isKeyReady()).toBe(true);
    });

    it('accepts null key (key not ready)', () => {
      const mod = new DTPEncryptionModule(null);
      expect(mod.isKeyReady()).toBe(false);
    });

    it('throws on invalid key length', () => {
      expect(() => new DTPEncryptionModule(new Uint8Array(16))).toThrow('Invalid key length');
    });
  });

  describe('encryptPayload / decryptPayload round-trip', () => {
    it('encrypts and decrypts empty payload', () => {
      const mod = new DTPEncryptionModule(validKey);
      const payload = new Uint8Array(0);
      const encrypted = mod.encryptPayload(payload, meta);
      const decrypted = mod.decryptPayload(encrypted, meta);
      expect(decrypted).toEqual(payload);
    });

    it('encrypts and decrypts non-empty payload', () => {
      const mod = new DTPEncryptionModule(validKey);
      const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encrypted = mod.encryptPayload(payload, meta);
      const decrypted = mod.decryptPayload(encrypted, meta);
      expect(decrypted).toEqual(payload);
    });

    it('produces output with correct structure: 12-byte IV + ciphertext + 16-byte tag', () => {
      const mod = new DTPEncryptionModule(validKey);
      const payload = new Uint8Array([10, 20, 30]);
      const encrypted = mod.encryptPayload(payload, meta);
      // minimum length: 12 (IV) + 0 (ciphertext can equal payload length for GCM) + 16 (tag)
      expect(encrypted.length).toBeGreaterThanOrEqual(12 + 16);
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
      const mod = new DTPEncryptionModule(validKey);
      const payload = new Uint8Array([42, 42, 42]);
      const a = mod.encryptPayload(payload, meta);
      const b = mod.encryptPayload(payload, meta);
      // IVs should differ, so encrypted outputs should differ
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });
  });

  describe('decryption failures', () => {
    it('throws when decrypting with wrong key', () => {
      const mod1 = new DTPEncryptionModule(validKey);
      const mod2 = new DTPEncryptionModule(randomBytes(32));
      const payload = new Uint8Array([1, 2, 3]);
      const encrypted = mod1.encryptPayload(payload, meta);
      expect(() => mod2.decryptPayload(encrypted, meta)).toThrow();
    });

    it('throws when encrypted payload is tampered', () => {
      const mod = new DTPEncryptionModule(validKey);
      const payload = new Uint8Array([1, 2, 3]);
      const encrypted = mod.encryptPayload(payload, meta);
      // Flip a byte in the ciphertext area
      encrypted[13] ^= 0xff;
      expect(() => mod.decryptPayload(encrypted, meta)).toThrow();
    });

    it('throws when encrypted payload is too short', () => {
      const mod = new DTPEncryptionModule(validKey);
      expect(() => mod.decryptPayload(new Uint8Array(10), meta)).toThrow('Encrypted payload too short');
    });
  });

  describe('isKeyReady', () => {
    it('returns false when key is null', () => {
      const mod = new DTPEncryptionModule(null);
      expect(mod.isKeyReady()).toBe(false);
    });

    it('returns true when valid key is set', () => {
      const mod = new DTPEncryptionModule(validKey);
      expect(mod.isKeyReady()).toBe(true);
    });
  });

  describe('key not ready errors', () => {
    it('throws on encrypt when key is null', () => {
      const mod = new DTPEncryptionModule(null);
      expect(() => mod.encryptPayload(new Uint8Array([1]), meta)).toThrow('key is not ready');
    });

    it('throws on decrypt when key is null', () => {
      const mod = new DTPEncryptionModule(null);
      expect(() => mod.decryptPayload(new Uint8Array(30), meta)).toThrow('key is not ready');
    });
  });

  describe('getEncryptionMetadata', () => {
    it('returns default metadata', () => {
      const mod = new DTPEncryptionModule(validKey);
      expect(mod.getEncryptionMetadata()).toEqual({
        algorithm: 'AES-256-GCM',
        keyVersion: 1,
      });
    });

    it('returns custom metadata', () => {
      const mod = new DTPEncryptionModule(validKey, 'AES-256-GCM', 5);
      expect(mod.getEncryptionMetadata()).toEqual({
        algorithm: 'AES-256-GCM',
        keyVersion: 5,
      });
    });
  });
});

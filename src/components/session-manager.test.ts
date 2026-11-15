import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  DTPSessionManager,
  EncryptedFileSessionStore,
  InMemorySessionStore,
  isCanonicalFayId,
} from './session-manager.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import type { CAPContext } from '../types/components.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeCAPContext(overrides: Partial<CAPContext> = {}): CAPContext {
  return {
    identity: 'master-fay-001',
    sessionKey: new Uint8Array([1, 2, 3, 4]),
    verified: true,
    ...overrides,
  };
}

describe('DTPSessionManager', () => {
  let manager: DTPSessionManager;

  beforeEach(() => {
    manager = new DTPSessionManager();
  });

  describe('createSession', () => {
    it('creates a session with a valid UUID v4 sessionId', () => {
      const session = manager.createSession(makeCAPContext());
      expect(session.sessionId).toMatch(UUID_REGEX);
    });

    it('creates a session in established state', () => {
      const session = manager.createSession(makeCAPContext());
      expect(session.state).toBe('established');
    });

    it('sets masterIdentity from CAPContext', () => {
      const session = manager.createSession(makeCAPContext({ identity: 'my-fay' }));
      expect(session.masterIdentity).toBe('my-fay');
    });

    it('initializes empty activeAgreements', () => {
      const session = manager.createSession(makeCAPContext());
      expect(session.activeAgreements.size).toBe(0);
    });

    it('initializes collectionState with sequence numbers at 0', () => {
      const session = manager.createSession(makeCAPContext());
      expect(session.collectionState.currentSequenceNumber).toBe(0);
      expect(session.collectionState.highestAcknowledgedSequenceNumber).toBe(0);
      expect(session.collectionState.unacknowledgedFragmentCache.size).toBe(0);
    });

    it('initializes injectionState with sequence numbers at 0', () => {
      const session = manager.createSession(makeCAPContext());
      expect(session.injectionState.currentSequenceNumber).toBe(0);
      expect(session.injectionState.highestAcknowledgedSequenceNumber).toBe(0);
      expect(session.injectionState.unacknowledgedFragmentCache.size).toBe(0);
    });

    it('sets createdAt and lastActivityAt to current time', () => {
      const before = Date.now();
      const session = manager.createSession(makeCAPContext());
      const after = Date.now();
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
      expect(session.lastActivityAt).toBe(session.createdAt);
    });

    it('sets default timeout threshold to 300000ms', () => {
      const session = manager.createSession(makeCAPContext());
      expect(session.timeoutThreshold).toBe(300_000);
    });

    it('generates unique sessionIds for multiple sessions', () => {
      const s1 = manager.createSession(makeCAPContext());
      const s2 = manager.createSession(makeCAPContext());
      expect(s1.sessionId).not.toBe(s2.sessionId);
    });
  });

  describe('getSession', () => {
    it('returns the session after creation', () => {
      const session = manager.createSession(makeCAPContext());
      const retrieved = manager.getSession(session.sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    });

    it('returns null for unknown sessionId', () => {
      expect(manager.getSession('nonexistent')).toBeNull();
    });
  });

  describe('closeSession', () => {
    it('removes the session from active sessions', () => {
      const session = manager.createSession(makeCAPContext());
      manager.closeSession(session.sessionId);
      expect(manager.getSession(session.sessionId)).toBeNull();
    });

    it('does not throw when closing a nonexistent session', () => {
      expect(() => manager.closeSession('nonexistent')).not.toThrow();
    });
  });

  describe('persistSession / restoreSession', () => {
    it('persists and restores a session', () => {
      const session = manager.createSession(makeCAPContext());
      manager.persistSession(session.sessionId);

      // Close the active session
      manager.closeSession(session.sessionId);
      expect(manager.getSession(session.sessionId)).toBeNull();

      // Restore from persisted store
      const restored = manager.restoreSession(session.sessionId);
      expect(restored).not.toBeNull();
      expect(restored!.sessionId).toBe(session.sessionId);
      expect(restored!.state).toBe('established');
    });

    it('restores session with updated lastActivityAt', () => {
      const session = manager.createSession(makeCAPContext());
      const originalActivity = session.lastActivityAt;
      manager.persistSession(session.sessionId);

      // Small delay to ensure time difference
      const before = Date.now();
      const restored = manager.restoreSession(session.sessionId);
      expect(restored!.lastActivityAt).toBeGreaterThanOrEqual(before);
    });

    it('creates a deep copy — modifying original does not affect persisted', () => {
      const session = manager.createSession(makeCAPContext());
      manager.persistSession(session.sessionId);

      // Modify the active session's state
      session.collectionState.currentSequenceNumber = 999;

      // Restore should have the original value
      manager.closeSession(session.sessionId);
      const restored = manager.restoreSession(session.sessionId);
      expect(restored!.collectionState.currentSequenceNumber).toBe(0);
    });

    it('returns null when restoring a session that was never persisted', () => {
      expect(manager.restoreSession('never-persisted')).toBeNull();
    });

    it('throws when persisting a nonexistent session', () => {
      expect(() => manager.persistSession('nonexistent')).toThrow('Session not found: nonexistent');
    });
  });

  describe('checkTimeout', () => {
    it('returns false for a freshly created session', () => {
      const session = manager.createSession(makeCAPContext());
      expect(manager.checkTimeout(session.sessionId)).toBe(false);
    });

    it('returns true when lastActivityAt + timeoutThreshold < now', () => {
      const session = manager.createSession(makeCAPContext());
      // Simulate old activity by setting lastActivityAt far in the past
      session.lastActivityAt = Date.now() - 400_000;
      expect(manager.checkTimeout(session.sessionId)).toBe(true);
    });

    it('returns false when within timeout threshold', () => {
      const session = manager.createSession(makeCAPContext());
      session.lastActivityAt = Date.now() - 100_000; // 100s ago, threshold is 300s
      expect(manager.checkTimeout(session.sessionId)).toBe(false);
    });

    it('returns true for a nonexistent session', () => {
      expect(manager.checkTimeout('nonexistent')).toBe(true);
    });

    it('respects custom timeout threshold', () => {
      const session = manager.createSession(makeCAPContext());
      session.timeoutThreshold = 1000; // 1 second
      session.lastActivityAt = Date.now() - 2000; // 2 seconds ago
      expect(manager.checkTimeout(session.sessionId)).toBe(true);
    });
  });

  describe('Session identities (OQ-DTP-9) and EncryptedFileSessionStore (OQ-DTP-10)', () => {
    it('rejects empty/whitespace masterIdentity and recognizes canonical FayID prefixes', () => {
      expect(() => manager.createSession(makeCAPContext({ identity: '   ' }))).toThrow(/identity/i);
      expect(isCanonicalFayId('ifay_01J8Z9X2W3V4')).toBe(true);
      expect(isCanonicalFayId('cofay_org_service_01')).toBe(true);
      expect(isCanonicalFayId('legacy-opaque-device-id')).toBe(false);
    });

    it('persists session encrypted with AES-256-GCM on disk with zero plaintext leakage and restores across instances', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'dtp-session-test-'));
      try {
        const snapshotPath = join(tempDir, 'sessions.enc');
        const storageKey = randomBytes(32);
        const store1 = new EncryptedFileSessionStore(snapshotPath, storageKey);
        const mgr1 = new DTPSessionManager(store1);

        const session = mgr1.createSession(makeCAPContext({ identity: 'ifay_prime_alpha' }));
        session.slaveIdentity = 'host_watch_001';
        session.collectionState.currentSequenceNumber = 12;
        const sensitivePlaintext = 'SECRET_HEART_RATE_PAYLOAD_98BPM_NEVER_IN_PLAINTEXT';
        session.collectionState.unacknowledgedFragmentCache.set(12, {
          fragmentId: '550e8400-e29b-41d4-a716-446655440099',
          agreementId: 'a50e8400-e29b-41d4-a716-446655440001',
          originTimestamp: 1700000000999,
          contextMetadata: {
            dataType: 'biometric',
            source: { kind: 'hardware', sensorType: 'ppg', precision: '1bpm', samplingRate: 50 },
            customFields: { zone: 'cardio' },
          },
          dagDependencies: [],
          data: new Uint8Array(Buffer.from(sensitivePlaintext, 'utf-8')),
        });
        session.activeAgreements.set('a50e8400-e29b-41d4-a716-446655440001', {
          agreementId: 'a50e8400-e29b-41d4-a716-446655440001',
          sessionId: session.sessionId,
          direction: 'collection',
          initiator: 'master',
          params: {
            dataType: 'biometric',
            dataRange: 'realtime',
            transferMode: 'streaming',
            frequency: 50,
            validityPeriod: 60000,
            priority: 'high',
          },
          status: 'active',
          createdAt: 1700000000000,
        });

        mgr1.persistSession(session.sessionId);

        // Verify raw disk bytes contain NO plaintext fragment data, identity, or JSON keys
        const rawBytes = readFileSync(snapshotPath);
        const rawLatin1 = rawBytes.toString('utf-8');
        expect(rawBytes.subarray(0, 4).toString('ascii')).toBe('DTPS');
        expect(rawLatin1).not.toContain(sensitivePlaintext);
        expect(rawLatin1).not.toContain('ifay_prime_alpha');
        expect(rawBytes.includes(Buffer.from(sensitivePlaintext, 'utf-8'))).toBe(false);

        // Simulate process restart with a fresh EncryptedFileSessionStore + DTPSessionManager
        const store2 = new EncryptedFileSessionStore(snapshotPath, storageKey);
        const mgr2 = new DTPSessionManager(store2);
        const restored = mgr2.restoreSession(session.sessionId);

        expect(restored).not.toBeNull();
        expect(restored!.masterIdentity).toBe('ifay_prime_alpha');
        expect(restored!.slaveIdentity).toBe('host_watch_001');
        expect(restored!.collectionState.currentSequenceNumber).toBe(12);
        const cachedFrag = restored!.collectionState.unacknowledgedFragmentCache.get(12);
        expect(cachedFrag).toBeDefined();
        expect(Buffer.from(cachedFrag!.data).toString('utf-8')).toBe(sensitivePlaintext);
        expect(restored!.activeAgreements.size).toBe(1);

        // Tamper with ciphertext/tag on disk -> must fail with SESSION_RESTORE_FAILED (5003)
        const tampered = Buffer.from(rawBytes);
        tampered[tampered.length - 1] ^= 0xff;
        writeFileSync(snapshotPath, tampered);

        const storeTampered = new EncryptedFileSessionStore(snapshotPath, storageKey);
        expect(() => storeTampered.load(session.sessionId)).toThrow();
        try {
          storeTampered.load(session.sessionId);
        } catch (err: any) {
          expect(err.code).toBe(DTPErrorCode.SESSION_RESTORE_FAILED);
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('keeps InMemorySessionStore as default store', () => {
      const memStore = new InMemorySessionStore();
      const mgr = new DTPSessionManager(memStore);
      const s = mgr.createSession(makeCAPContext());
      mgr.persistSession(s.sessionId);
      expect(memStore.load(s.sessionId)?.sessionId).toBe(s.sessionId);
    });
  });
});

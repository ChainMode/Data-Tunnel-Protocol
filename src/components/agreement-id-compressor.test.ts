import { describe, it, expect, beforeEach } from 'vitest';
import { AgreementIdCompressor } from './agreement-id-compressor.js';
import { DTPErrorCode } from '../errors/index.js';
import type { LogicalFrame } from '../types/index.js';

/** Helper to build a minimal LogicalFrame with a given agreementId. */
function makeFrame(agreementId: string | null, fragmentId = 'frag-1'): LogicalFrame {
  return {
    header: {
      protocolVersion: { major: 1, minor: 0 },
      frameType: 'data',
      fragmentId,
      agreementId,
      originTimestamp: Date.now(),
      dagDependencies: [],
      encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
      sequenceNumber: 0,
    },
    payload: new Uint8Array([1, 2, 3]),
  };
}

describe('AgreementIdCompressor', () => {
  let compressor: AgreementIdCompressor;

  beforeEach(() => {
    compressor = new AgreementIdCompressor();
  });

  // ── Batch compress ──

  describe('compress (batch)', () => {
    it('keeps agreementId on the first frame of a run', () => {
      const frames = [makeFrame('a-1'), makeFrame('a-1'), makeFrame('a-1')];
      const result = compressor.compress(frames);
      expect(result[0].header.agreementId).toBe('a-1');
    });

    it('sets agreementId to null on consecutive frames with the same id', () => {
      const frames = [makeFrame('a-1'), makeFrame('a-1'), makeFrame('a-1')];
      const result = compressor.compress(frames);
      expect(result[1].header.agreementId).toBeNull();
      expect(result[2].header.agreementId).toBeNull();
    });

    it('keeps agreementId when it changes between frames', () => {
      const frames = [makeFrame('a-1'), makeFrame('a-2'), makeFrame('a-2')];
      const result = compressor.compress(frames);
      expect(result[0].header.agreementId).toBe('a-1');
      expect(result[1].header.agreementId).toBe('a-2');
      expect(result[2].header.agreementId).toBeNull();
    });

    it('handles single-frame batch', () => {
      const result = compressor.compress([makeFrame('a-1')]);
      expect(result[0].header.agreementId).toBe('a-1');
    });

    it('handles empty batch', () => {
      expect(compressor.compress([])).toEqual([]);
    });

    it('preserves frames with null agreementId as-is', () => {
      const frames = [makeFrame(null), makeFrame(null)];
      const result = compressor.compress(frames);
      expect(result[0].header.agreementId).toBeNull();
      expect(result[1].header.agreementId).toBeNull();
    });
  });

  // ── Batch decompress ──

  describe('decompress (batch)', () => {
    it('restores null agreementIds from the last seen id', () => {
      const frames = [makeFrame('a-1'), makeFrame(null), makeFrame(null)];
      const result = compressor.decompress(frames);
      expect(result[0].header.agreementId).toBe('a-1');
      expect(result[1].header.agreementId).toBe('a-1');
      expect(result[2].header.agreementId).toBe('a-1');
    });

    it('switches context when a new agreementId appears', () => {
      const frames = [makeFrame('a-1'), makeFrame(null), makeFrame('a-2'), makeFrame(null)];
      const result = compressor.decompress(frames);
      expect(result[0].header.agreementId).toBe('a-1');
      expect(result[1].header.agreementId).toBe('a-1');
      expect(result[2].header.agreementId).toBe('a-2');
      expect(result[3].header.agreementId).toBe('a-2');
    });

    it('throws AGREEMENT_NOT_FOUND when first frame has null agreementId', () => {
      const frames = [makeFrame(null), makeFrame('a-1')];
      try {
        compressor.decompress(frames);
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(DTPErrorCode.AGREEMENT_NOT_FOUND);
      }
    });

    it('handles empty batch', () => {
      expect(compressor.decompress([])).toEqual([]);
    });
  });

  // ── Round-trip: compress then decompress ──

  describe('compress → decompress round-trip', () => {
    it('restores original agreementIds after compress + decompress', () => {
      const original = [
        makeFrame('a-1', 'f1'),
        makeFrame('a-1', 'f2'),
        makeFrame('a-2', 'f3'),
        makeFrame('a-2', 'f4'),
        makeFrame('a-1', 'f5'),
      ];
      const compressed = compressor.compress(original);
      const restored = compressor.decompress(compressed);

      for (let i = 0; i < original.length; i++) {
        expect(restored[i].header.agreementId).toBe(original[i].header.agreementId);
      }
    });
  });

  // ── Stateful streaming: compressFrame ──

  describe('compressFrame (streaming)', () => {
    it('keeps id on first frame, nulls consecutive same-id frames', () => {
      const r1 = compressor.compressFrame(makeFrame('a-1'));
      const r2 = compressor.compressFrame(makeFrame('a-1'));
      const r3 = compressor.compressFrame(makeFrame('a-1'));
      expect(r1.header.agreementId).toBe('a-1');
      expect(r2.header.agreementId).toBeNull();
      expect(r3.header.agreementId).toBeNull();
    });

    it('keeps id when it changes', () => {
      compressor.compressFrame(makeFrame('a-1'));
      const r2 = compressor.compressFrame(makeFrame('a-2'));
      expect(r2.header.agreementId).toBe('a-2');
    });
  });

  // ── Stateful streaming: decompressFrame ──

  describe('decompressFrame (streaming)', () => {
    it('restores null agreementId from last seen', () => {
      compressor.decompressFrame(makeFrame('a-1'));
      const r2 = compressor.decompressFrame(makeFrame(null));
      expect(r2.header.agreementId).toBe('a-1');
    });

    it('throws AGREEMENT_NOT_FOUND when first frame has null agreementId', () => {
      try {
        compressor.decompressFrame(makeFrame(null));
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe(DTPErrorCode.AGREEMENT_NOT_FOUND);
      }
    });

    it('updates context when a new id appears', () => {
      compressor.decompressFrame(makeFrame('a-1'));
      compressor.decompressFrame(makeFrame('a-2'));
      const r3 = compressor.decompressFrame(makeFrame(null));
      expect(r3.header.agreementId).toBe('a-2');
    });
  });

  // ── Reset ──

  describe('reset', () => {
    it('clears streaming state so next decompressFrame with null throws', () => {
      compressor.decompressFrame(makeFrame('a-1'));
      compressor.reset();
      expect(() => compressor.decompressFrame(makeFrame(null))).toThrow();
    });

    it('clears compress state so next same-id frame is not compressed', () => {
      compressor.compressFrame(makeFrame('a-1'));
      compressor.reset();
      const r = compressor.compressFrame(makeFrame('a-1'));
      expect(r.header.agreementId).toBe('a-1');
    });
  });
});

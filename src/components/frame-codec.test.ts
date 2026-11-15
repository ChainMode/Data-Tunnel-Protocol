import { describe, it, expect } from 'vitest';
import { DTPFrameCodec, canonicalizeJson } from './frame-codec.js';
import type { LogicalFrame } from '../types/index.js';

const codec = new DTPFrameCodec();

function makeFrame(overrides?: Partial<LogicalFrame['header']>, payload?: Uint8Array): LogicalFrame {
  return {
    header: {
      protocolVersion: { major: 1, minor: 0 },
      frameType: 'data',
      fragmentId: '550e8400-e29b-41d4-a716-446655440000',
      agreementId: 'a50e8400-e29b-41d4-a716-446655440001',
      originTimestamp: 1700000000000,
      dagDependencies: [],
      encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
      sequenceNumber: 42,
      ...overrides,
    },
    payload: payload ?? new Uint8Array([1, 2, 3, 4]),
  };
}

describe('DTPFrameCodec', () => {
  describe('serialize / deserialize round-trip', () => {
    it('should round-trip a data frame', () => {
      const frame = makeFrame({ frameType: 'data' });
      const serialized = codec.serialize(frame);
      const deserialized = codec.deserialize(serialized);

      expect(deserialized.header).toEqual(frame.header);
      expect(deserialized.payload).toEqual(frame.payload);
    });

    it('should round-trip a request frame', () => {
      const frame = makeFrame({ frameType: 'request' });
      const result = codec.deserialize(codec.serialize(frame));
      expect(result.header.frameType).toBe('request');
      expect(result.header).toEqual(frame.header);
    });

    it('should round-trip a response frame', () => {
      const frame = makeFrame({ frameType: 'response' });
      const result = codec.deserialize(codec.serialize(frame));
      expect(result.header.frameType).toBe('response');
    });

    it('should round-trip a control frame', () => {
      const frame = makeFrame({ frameType: 'control' });
      const result = codec.deserialize(codec.serialize(frame));
      expect(result.header.frameType).toBe('control');
    });
  });

  describe('edge cases', () => {
    it('should handle empty payload', () => {
      const frame = makeFrame({}, new Uint8Array(0));
      const result = codec.deserialize(codec.serialize(frame));
      expect(result.payload).toEqual(new Uint8Array(0));
      expect(result.header).toEqual(frame.header);
    });

    it('should handle null agreementId', () => {
      const frame = makeFrame({ agreementId: null });
      const result = codec.deserialize(codec.serialize(frame));
      expect(result.header.agreementId).toBeNull();
    });

    it('should handle dagDependencies with entries', () => {
      const frame = makeFrame({
        dagDependencies: [
          { targetFragmentId: 'dep-1', relationType: 'derived_from' },
          { targetFragmentId: 'dep-2', relationType: 'annotates' },
          { targetFragmentId: 'dep-3', relationType: 'supersedes' },
        ],
      });
      const result = codec.deserialize(codec.serialize(frame));
      expect(result.header.dagDependencies).toEqual(frame.header.dagDependencies);
    });

    it('should handle large payload', () => {
      const largePayload = new Uint8Array(10000);
      for (let i = 0; i < largePayload.length; i++) {
        largePayload[i] = i % 256;
      }
      const frame = makeFrame({}, largePayload);
      const result = codec.deserialize(codec.serialize(frame));
      expect(result.payload).toEqual(largePayload);
    });
  });

  describe('deserialize error handling', () => {
    it('should throw on data shorter than 4 bytes', () => {
      expect(() => codec.deserialize(new Uint8Array([1, 2]))).toThrow(
        'too short'
      );
    });

    it('should throw when header length exceeds data', () => {
      // header length = 9999 but only 4 bytes total
      const bad = new Uint8Array([0, 0, 0x27, 0x0f]);
      expect(() => codec.deserialize(bad)).toThrow('expected at least');
    });

    it('should throw on invalid JSON header', () => {
      const garbage = new Uint8Array([0, 0, 0, 3, 0xff, 0xfe, 0xfd]);
      expect(() => codec.deserialize(garbage)).toThrow('header JSON parse failed');
    });
  });

  describe('prettyPrint', () => {
    it('should include all key header fields in output', () => {
      const frame = makeFrame();
      const output = codec.prettyPrint(frame);

      // Protocol version
      expect(output).toContain('1.0');
      // Frame type
      expect(output).toContain('data');
      // Fragment ID
      expect(output).toContain('550e8400-e29b-41d4-a716-446655440000');
      // Agreement ID
      expect(output).toContain('a50e8400-e29b-41d4-a716-446655440001');
      // Timestamp
      expect(output).toContain('1700000000000');
      // Sequence number
      expect(output).toContain('42');
      // Encryption info
      expect(output).toContain('AES-256-GCM');
      // Payload size
      expect(output).toContain('4 bytes');
    });

    it('should show (none) for null agreementId', () => {
      const frame = makeFrame({ agreementId: null });
      const output = codec.prettyPrint(frame);
      expect(output).toContain('(none)');
    });

    it('should display DAG dependencies when present', () => {
      const frame = makeFrame({
        dagDependencies: [
          { targetFragmentId: 'dep-1', relationType: 'derived_from' },
          { targetFragmentId: 'dep-2', relationType: 'annotates' },
        ],
      });
      const output = codec.prettyPrint(frame);
      expect(output).toContain('derived_from');
      expect(output).toContain('dep-1');
      expect(output).toContain('annotates');
      expect(output).toContain('dep-2');
    });

    it('should show (none) for empty DAG dependencies', () => {
      const frame = makeFrame({ dagDependencies: [] });
      const output = codec.prettyPrint(frame);
      expect(output).toContain('DAG Dependencies : (none)');
    });

    it('should return a multi-line string', () => {
      const frame = makeFrame();
      const output = codec.prettyPrint(frame);
      const lines = output.split('\n');
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe('RFC 8785 JCS canonical header wire encoding (OQ-DTP-7)', () => {
    it('serializes header JSON keys in strict lexicographical UTF-16 order', () => {
      const frame = makeFrame({
        dagDependencies: [
          { targetFragmentId: 'dep-1', relationType: 'derived_from' },
        ],
      });
      const bytes = codec.serialize(frame);
      const headerLen =
        ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
      const headerJson = Buffer.from(bytes.slice(4, 4 + headerLen)).toString('utf-8');

      // Top-level keys in JCS order:
      // agreementId, dagDependencies, encryptionMetadata, fragmentId, frameType, originTimestamp, protocolVersion, sequenceNumber
      // Nested DAGEdge keys in JCS order: relationType, targetFragmentId
      expect(headerJson).toBe(
        '{"agreementId":"a50e8400-e29b-41d4-a716-446655440001",' +
        '"dagDependencies":[{"relationType":"derived_from","targetFragmentId":"dep-1"}],' +
        '"encryptionMetadata":{"algorithm":"AES-256-GCM","keyVersion":1},' +
        '"fragmentId":"550e8400-e29b-41d4-a716-446655440000",' +
        '"frameType":"data",' +
        '"originTimestamp":1700000000000,' +
        '"protocolVersion":{"major":1,"minor":0},' +
        '"sequenceNumber":42}'
      );
    });

    it('canonicalizeJson produces identical output regardless of input property insertion order', () => {
      const a = { z: 1, a: { d: true, b: 'hello' }, m: [3, { y: null, x: -0 }] };
      const b = { m: [3, { x: 0, y: null }], a: { b: 'hello', d: true }, z: 1 };
      expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
      expect(canonicalizeJson(a)).toBe('{"a":{"b":"hello","d":true},"m":[3,{"x":0,"y":null}],"z":1}');
    });

    it('rejects frames missing protocolVersion header field', () => {
      const rawJson = JSON.stringify({
        frameType: 'data',
        fragmentId: 'f1',
        agreementId: null,
        originTimestamp: 1,
        dagDependencies: [],
        encryptionMetadata: { algorithm: 'AES-256-GCM', keyVersion: 1 },
        sequenceNumber: 1,
      });
      const hdr = Buffer.from(rawJson, 'utf-8');
      const buf = new Uint8Array(4 + hdr.length);
      buf[0] = (hdr.length >>> 24) & 0xff;
      buf[1] = (hdr.length >>> 16) & 0xff;
      buf[2] = (hdr.length >>> 8) & 0xff;
      buf[3] = hdr.length & 0xff;
      buf.set(hdr, 4);
      expect(() => codec.deserialize(buf)).toThrow(/protocolVersion/i);
    });
  });
});

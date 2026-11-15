// DTP Frame Codec Implementation
// Serializes/deserializes LogicalFrame to/from binary format.
// Normative DTP 1.0 Wire Format (OQ-DTP-7):
//   [4 bytes header length (big-endian uint32)]
//   [RFC 8785 JCS canonical UTF-8 JSON header bytes]
//   [payload bytes (12B IV + AES-256-GCM ciphertext + 16B AuthTag for encrypted frames)]

import type { LogicalFrame, FrameHeader, FrameType } from '../types/index.js';
import type { FrameCodec } from '../types/index.js';

const VALID_FRAME_TYPES = new Set<FrameType>(['data', 'request', 'response', 'control']);

/** Encode a string to UTF-8 bytes using Buffer (Node.js). */
function stringToBytes(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'utf-8'));
}

/** Decode UTF-8 bytes to a string using Buffer (Node.js). */
function bytesToString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * Serialize any JSON-compatible value according to RFC 8785
 * JSON Canonicalization Scheme (JCS):
 * - No insignificant whitespace
 * - Object property names sorted lexicographically by UTF-16 code units
 * - ECMAScript Number serialization (-0 normalized to 0; NaN/Infinity rejected)
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new Error('RFC 8785 JCS does not allow non-finite numbers (NaN/Infinity)');
      }
      if (Object.is(value, -0)) {
        return '0';
      }
      return JSON.stringify(value);
    }
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map((item) =>
          item === undefined ? 'null' : canonicalizeJson(item),
        );
        return `[${items.join(',')}]`;
      }

      const record = value as Record<string, unknown>;
      // Default JS sort compares UTF-16 code units in ascending order (RFC 8785 §3.2.3)
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      const props = keys.map(
        (k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`,
      );
      return `{${props.join(',')}}`;
    }
    default:
      throw new Error(`Unsupported value type in JCS canonicalization: ${typeof value}`);
  }
}

/** Intermediate JSON-safe representation of FrameHeader (payload handled separately) */
interface SerializedHeader {
  protocolVersion: FrameHeader['protocolVersion'];
  frameType: FrameHeader['frameType'];
  fragmentId: FrameHeader['fragmentId'];
  agreementId: FrameHeader['agreementId'];
  originTimestamp: FrameHeader['originTimestamp'];
  dagDependencies: FrameHeader['dagDependencies'];
  encryptionMetadata: FrameHeader['encryptionMetadata'];
  sequenceNumber: FrameHeader['sequenceNumber'];
}

export class DTPFrameCodec implements FrameCodec {
  /**
   * Serialize a LogicalFrame into a Uint8Array using RFC 8785 JCS header encoding.
   * Format: [4-byte header length BE uint32] [JCS UTF-8 header JSON bytes] [payload bytes]
   */
  serialize(frame: LogicalFrame): Uint8Array {
    const headerObj: SerializedHeader = {
      protocolVersion: {
        major: frame.header.protocolVersion.major,
        minor: frame.header.protocolVersion.minor,
      },
      frameType: frame.header.frameType,
      fragmentId: frame.header.fragmentId,
      agreementId: frame.header.agreementId,
      originTimestamp: frame.header.originTimestamp,
      dagDependencies: frame.header.dagDependencies.map((dep) => ({
        targetFragmentId: dep.targetFragmentId,
        relationType: dep.relationType,
      })),
      encryptionMetadata: {
        algorithm: frame.header.encryptionMetadata.algorithm,
        keyVersion: frame.header.encryptionMetadata.keyVersion,
      },
      sequenceNumber: frame.header.sequenceNumber,
    };

    const headerJson = canonicalizeJson(headerObj);
    const headerBytes = stringToBytes(headerJson);
    const headerLength = headerBytes.length;

    // 4 bytes for header length + header bytes + payload bytes
    const result = new Uint8Array(4 + headerLength + frame.payload.length);

    // Write header length as big-endian uint32
    result[0] = (headerLength >>> 24) & 0xff;
    result[1] = (headerLength >>> 16) & 0xff;
    result[2] = (headerLength >>> 8) & 0xff;
    result[3] = headerLength & 0xff;

    // Write canonical header JSON bytes
    result.set(headerBytes, 4);

    // Write payload bytes
    result.set(frame.payload, 4 + headerLength);

    return result;
  }

  /**
   * Deserialize a Uint8Array back into a LogicalFrame.
   * Enforces mandatory protocolVersion and core header field structure,
   * while ignoring unknown optional fields for same-MAJOR forward compatibility.
   */
  deserialize(data: Uint8Array): LogicalFrame {
    if (data.length < 4) {
      throw new Error('Invalid frame data: too short to contain header length');
    }

    // Read header length (big-endian uint32)
    const headerLength =
      ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;

    if (data.length < 4 + headerLength) {
      throw new Error(
        `Invalid frame data: expected at least ${4 + headerLength} bytes, got ${data.length}`,
      );
    }

    // Decode header JSON
    const headerBytes = data.slice(4, 4 + headerLength);
    const headerJson = bytesToString(headerBytes);

    let parsed: unknown;
    try {
      parsed = JSON.parse(headerJson);
    } catch {
      throw new Error('Invalid frame data: header JSON parse failed');
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid frame data: header JSON must be an object');
    }

    const headerObj = parsed as Partial<SerializedHeader>;

    // Mandatory protocolVersion check (cannot infer or default)
    if (
      typeof headerObj.protocolVersion !== 'object' ||
      headerObj.protocolVersion === null ||
      !Number.isInteger(headerObj.protocolVersion.major) ||
      headerObj.protocolVersion.major < 0 ||
      !Number.isInteger(headerObj.protocolVersion.minor) ||
      headerObj.protocolVersion.minor < 0
    ) {
      throw new Error('Invalid frame data: missing or malformed protocolVersion');
    }

    if (typeof headerObj.frameType !== 'string' || !VALID_FRAME_TYPES.has(headerObj.frameType as FrameType)) {
      throw new Error('Invalid frame data: missing or invalid frameType');
    }

    if (typeof headerObj.fragmentId !== 'string') {
      throw new Error('Invalid frame data: missing or invalid fragmentId');
    }

    if (headerObj.agreementId !== null && typeof headerObj.agreementId !== 'string') {
      throw new Error('Invalid frame data: invalid agreementId');
    }

    if (typeof headerObj.originTimestamp !== 'number' || !Number.isFinite(headerObj.originTimestamp)) {
      throw new Error('Invalid frame data: invalid originTimestamp');
    }

    if (!Array.isArray(headerObj.dagDependencies)) {
      throw new Error('Invalid frame data: invalid dagDependencies');
    }

    if (
      typeof headerObj.encryptionMetadata !== 'object' ||
      headerObj.encryptionMetadata === null ||
      typeof headerObj.encryptionMetadata.algorithm !== 'string' ||
      typeof headerObj.encryptionMetadata.keyVersion !== 'number'
    ) {
      throw new Error('Invalid frame data: invalid encryptionMetadata');
    }

    if (
      typeof headerObj.sequenceNumber !== 'number' ||
      !Number.isInteger(headerObj.sequenceNumber) ||
      headerObj.sequenceNumber < 0
    ) {
      throw new Error('Invalid frame data: invalid sequenceNumber');
    }

    // Extract payload
    const payload = data.slice(4 + headerLength);

    const header: FrameHeader = {
      protocolVersion: {
        major: headerObj.protocolVersion.major,
        minor: headerObj.protocolVersion.minor,
      },
      frameType: headerObj.frameType,
      fragmentId: headerObj.fragmentId,
      agreementId: headerObj.agreementId,
      originTimestamp: headerObj.originTimestamp,
      dagDependencies: headerObj.dagDependencies,
      encryptionMetadata: {
        algorithm: headerObj.encryptionMetadata.algorithm,
        keyVersion: headerObj.encryptionMetadata.keyVersion,
      },
      sequenceNumber: headerObj.sequenceNumber,
    };

    return { header, payload: new Uint8Array(payload) };
  }

  /**
   * Pretty print a LogicalFrame as human-readable multi-line text.
   * Includes all key header fields, payload size, and DAG dependencies.
   */
  prettyPrint(frame: LogicalFrame): string {
    const h = frame.header;
    const lines: string[] = [
      `=== LogicalFrame ===`,
      `Protocol Version : ${h.protocolVersion.major}.${h.protocolVersion.minor}`,
      `Frame Type       : ${h.frameType}`,
      `Fragment ID      : ${h.fragmentId}`,
      `Agreement ID     : ${h.agreementId ?? '(none)'}`,
      `Timestamp        : ${h.originTimestamp}`,
      `Sequence Number  : ${h.sequenceNumber}`,
      `Encryption       : ${h.encryptionMetadata.algorithm} (key v${h.encryptionMetadata.keyVersion})`,
      `Payload Size     : ${frame.payload.length} bytes`,
    ];

    if (h.dagDependencies.length > 0) {
      lines.push(`DAG Dependencies :`);
      for (const dep of h.dagDependencies) {
        lines.push(`  - ${dep.relationType} -> ${dep.targetFragmentId}`);
      }
    } else {
      lines.push(`DAG Dependencies : (none)`);
    }

    return lines.join('\n');
  }
}

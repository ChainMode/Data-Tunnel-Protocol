// DTP Frame Codec Implementation
// Serializes/deserializes LogicalFrame to/from binary format.
// Binary format: [4 bytes header length (big-endian uint32)] [header JSON bytes] [payload bytes]

import type { LogicalFrame, FrameHeader } from '../types/index.js';
import type { FrameCodec } from '../types/index.js';

/** Encode a string to UTF-8 bytes using Buffer (Node.js). */
function stringToBytes(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'utf-8'));
}

/** Decode UTF-8 bytes to a string using Buffer (Node.js). */
function bytesToString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf-8');
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
   * Serialize a LogicalFrame into a Uint8Array.
   * Format: [4-byte header length BE uint32] [header JSON bytes] [payload bytes]
   */
  serialize(frame: LogicalFrame): Uint8Array {
    const headerObj: SerializedHeader = {
      protocolVersion: frame.header.protocolVersion,
      frameType: frame.header.frameType,
      fragmentId: frame.header.fragmentId,
      agreementId: frame.header.agreementId,
      originTimestamp: frame.header.originTimestamp,
      dagDependencies: frame.header.dagDependencies,
      encryptionMetadata: frame.header.encryptionMetadata,
      sequenceNumber: frame.header.sequenceNumber,
    };

    const headerJson = JSON.stringify(headerObj);
    const headerBytes = stringToBytes(headerJson);
    const headerLength = headerBytes.length;

    // 4 bytes for header length + header bytes + payload bytes
    const result = new Uint8Array(4 + headerLength + frame.payload.length);

    // Write header length as big-endian uint32
    result[0] = (headerLength >>> 24) & 0xff;
    result[1] = (headerLength >>> 16) & 0xff;
    result[2] = (headerLength >>> 8) & 0xff;
    result[3] = headerLength & 0xff;

    // Write header JSON bytes
    result.set(headerBytes, 4);

    // Write payload bytes
    result.set(frame.payload, 4 + headerLength);

    return result;
  }

  /**
   * Deserialize a Uint8Array back into a LogicalFrame.
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
        `Invalid frame data: expected at least ${4 + headerLength} bytes, got ${data.length}`
      );
    }

    // Decode header JSON
    const headerBytes = data.slice(4, 4 + headerLength);
    const headerJson = bytesToString(headerBytes);

    let headerObj: SerializedHeader;
    try {
      headerObj = JSON.parse(headerJson) as SerializedHeader;
    } catch {
      throw new Error('Invalid frame data: header JSON parse failed');
    }

    // Extract payload
    const payload = data.slice(4 + headerLength);

    const header: FrameHeader = {
      protocolVersion: headerObj.protocolVersion,
      frameType: headerObj.frameType,
      fragmentId: headerObj.fragmentId,
      agreementId: headerObj.agreementId,
      originTimestamp: headerObj.originTimestamp,
      dagDependencies: headerObj.dagDependencies,
      encryptionMetadata: headerObj.encryptionMetadata,
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

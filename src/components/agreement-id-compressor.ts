// Agreement_ID Compression Module for DTP
// Implements Agreement_ID compression for consecutive fragments belonging to the same agreement.
// Requirements: 4.1, 4.2, 4.3, 4.4

import type { LogicalFrame, AgreementID } from '../types/index.js';
import { DTPErrorCode } from '../errors/index.js';

/**
 * Compresses and decompresses Agreement_ID fields on LogicalFrame batches and streams.
 *
 * Compression: consecutive frames with the same agreementId have the id set to null
 * after the first occurrence.
 *
 * Decompression: null agreementId fields are restored from the last seen agreementId.
 */
export class AgreementIdCompressor {
  private lastCompressedId: AgreementID | null = null;
  private lastDecompressedId: AgreementID | null = null;

  // ── Batch methods ──

  /**
   * Compress a batch of frames: only the first frame in a run of the same
   * agreementId keeps the full id; subsequent frames get null.
   */
  compress(frames: LogicalFrame[]): LogicalFrame[] {
    let lastId: AgreementID | null = null;

    return frames.map((frame) => {
      const currentId = frame.header.agreementId;
      if (currentId !== null && currentId === lastId) {
        return {
          ...frame,
          header: { ...frame.header, agreementId: null },
        };
      }
      lastId = currentId;
      return frame;
    });
  }

  /**
   * Decompress a batch of frames: null agreementId fields are restored
   * from the most recent non-null agreementId in the batch.
   *
   * Throws AGREEMENT_NOT_FOUND if the first frame has a null agreementId
   * (no context to restore from).
   */
  decompress(frames: LogicalFrame[]): LogicalFrame[] {
    let lastId: AgreementID | null = null;

    return frames.map((frame, index) => {
      const currentId = frame.header.agreementId;
      if (currentId !== null) {
        lastId = currentId;
        return frame;
      }
      // null agreementId — need to restore
      if (lastId === null) {
        throw Object.assign(
          new Error(`Cannot decompress frame at index ${index}: no prior Agreement_ID in context`),
          { code: DTPErrorCode.AGREEMENT_NOT_FOUND },
        );
      }
      return {
        ...frame,
        header: { ...frame.header, agreementId: lastId },
      };
    });
  }

  // ── Stateful single-frame (streaming) methods ──

  /**
   * Stateful compress for a single frame. Tracks the last agreementId across calls.
   */
  compressFrame(frame: LogicalFrame): LogicalFrame {
    const currentId = frame.header.agreementId;
    if (currentId !== null && currentId === this.lastCompressedId) {
      return {
        ...frame,
        header: { ...frame.header, agreementId: null },
      };
    }
    this.lastCompressedId = currentId;
    return frame;
  }

  /**
   * Stateful decompress for a single frame. Restores null agreementId from
   * the last seen value.
   *
   * Throws AGREEMENT_NOT_FOUND if agreementId is null and no prior id exists.
   */
  decompressFrame(frame: LogicalFrame): LogicalFrame {
    const currentId = frame.header.agreementId;
    if (currentId !== null) {
      this.lastDecompressedId = currentId;
      return frame;
    }
    if (this.lastDecompressedId === null) {
      throw Object.assign(
        new Error('Cannot decompress frame: no prior Agreement_ID in context'),
        { code: DTPErrorCode.AGREEMENT_NOT_FOUND },
      );
    }
    return {
      ...frame,
      header: { ...frame.header, agreementId: this.lastDecompressedId },
    };
  }

  /** Reset internal streaming state. */
  reset(): void {
    this.lastCompressedId = null;
    this.lastDecompressedId = null;
  }
}

// Agreement_ID Compression Module for DTP
// Implements deterministic Agreement_ID batch & stream compression (OQ-DTP-6).
// Contextual omission of agreementId applies per ordered logical stream batch and
// resets on explicit new agreementId or non-data control/negotiation frame boundaries.

import type { LogicalFrame, AgreementID } from '../types/index.js';
import { DTPErrorCode } from '../errors/index.js';

/**
 * Compresses and decompresses Agreement_ID fields on LogicalFrame batches and streams.
 *
 * OQ-DTP-6 Rules:
 * 1. Within an ordered batch, consecutive data frames with the same non-null agreementId
 *    omit agreementId (set to null) after the first frame in the run.
 * 2. Any explicit non-null agreementId immediately switches the active compression context.
 * 3. Any frame boundary with null agreementId (e.g. control frame) or explicit reset()
 *    clears the context so interleaved streams cannot silently inherit stale IDs.
 */
export class AgreementIdCompressor {
  private lastCompressedId: AgreementID | null = null;
  private lastDecompressedId: AgreementID | null = null;

  // ── Batch methods ──

  /**
   * Compress an ordered batch of frames: only the first frame in a run of the same
   * agreementId keeps the full id; subsequent frames in the run get null.
   */
  compress(frames: LogicalFrame[]): LogicalFrame[] {
    let lastId: AgreementID | null = null;

    return frames.map((frame) => {
      if (frame.header.frameType !== 'data') {
        // Non-data frame boundary resets compression context (OQ-DTP-6)
        lastId = null;
        return frame;
      }
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
   * Decompress an ordered batch of frames: null agreementId fields on data frames
   * are restored from the most recent non-null agreementId in the current batch context.
   *
   * Throws AGREEMENT_NOT_FOUND (3001) if a data frame has a null agreementId
   * with no prior Agreement_ID in the current context.
   */
  decompress(frames: LogicalFrame[]): LogicalFrame[] {
    let lastId: AgreementID | null = null;

    return frames.map((frame, index) => {
      if (frame.header.frameType !== 'data') {
        lastId = null;
        return frame;
      }
      const currentId = frame.header.agreementId;
      if (currentId !== null) {
        lastId = currentId;
        return frame;
      }
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
   * Stateful compress for a single frame. Tracks the last agreementId across calls,
   * resetting on non-data frame boundaries.
   */
  compressFrame(frame: LogicalFrame): LogicalFrame {
    if (frame.header.frameType !== 'data') {
      this.lastCompressedId = null;
      return frame;
    }
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
   * the last seen value in the current ordered stream context.
   *
   * Throws AGREEMENT_NOT_FOUND (3001) if agreementId is null and no prior id exists.
   */
  decompressFrame(frame: LogicalFrame): LogicalFrame {
    if (frame.header.frameType !== 'data') {
      this.lastDecompressedId = null;
      return frame;
    }
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

  /** Reset internal streaming state (e.g. on frame/batch boundary when interleaved agreements are active). */
  reset(): void {
    this.lastCompressedId = null;
    this.lastDecompressedId = null;
  }

  /** Explicit frame-boundary hook for interleaved agreement streams (OQ-DTP-6). */
  onFrameBoundary(): void {
    this.reset();
  }
}

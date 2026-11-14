// DTP Resume Manager Implementation
// Manages sequence-number-based resume mechanism, including Fragment caching and breakpoint recovery.

import type { ResumeManager, ResumeReport } from '../types/components.js';
import type { Fragment } from '../types/fragment.js';
import type { SequenceNumber } from '../types/frame.js';
import type { TransferDirection } from '../types/agreement.js';
import { DTPErrorCode } from '../errors/error-codes.js';

/** Default maximum buffer size for unacknowledged fragments */
const DEFAULT_MAX_BUFFER_SIZE = 1000;

export class DTPResumeManager implements ResumeManager {
  /** Unacknowledged fragment cache keyed by sequence number */
  private readonly cache = new Map<SequenceNumber, Fragment>();

  /** Tracks the last cached sequence number for monotonic-increase validation */
  private lastCachedSequenceNumber: SequenceNumber | null = null;

  /** Highest received sequence numbers per direction */
  private readonly highestReceived = new Map<TransferDirection, SequenceNumber>([
    ['collection', 0],
    ['injection', 0],
  ]);

  /** Maximum number of fragments the cache can hold */
  private readonly maxBufferSize: number;

  constructor(maxBufferSize: number = DEFAULT_MAX_BUFFER_SIZE) {
    this.maxBufferSize = maxBufferSize;
  }

  // ─── Sender-side methods ───

  cacheFragment(fragment: Fragment, sequenceNumber: SequenceNumber): void {
    if (this.lastCachedSequenceNumber !== null && sequenceNumber <= this.lastCachedSequenceNumber) {
      throw new Error(
        `Sequence number must be monotonically increasing: got ${sequenceNumber}, ` +
        `last was ${this.lastCachedSequenceNumber} (error code: ${DTPErrorCode.BUFFER_FULL})`,
      );
    }
    this.cache.set(sequenceNumber, fragment);
    this.lastCachedSequenceNumber = sequenceNumber;
  }

  acknowledgeUpTo(sequenceNumber: SequenceNumber): void {
    for (const key of this.cache.keys()) {
      if (key <= sequenceNumber) {
        this.cache.delete(key);
      }
    }
  }

  getUnacknowledgedFragments(): Fragment[] {
    return [...this.cache.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, fragment]) => fragment);
  }

  isBufferFull(): boolean {
    return this.cache.size >= this.maxBufferSize;
  }

  // ─── Receiver-side methods ───

  getHighestReceivedSequenceNumber(direction: TransferDirection): SequenceNumber {
    return this.highestReceived.get(direction) ?? 0;
  }

  reportResumePoint(): ResumeReport {
    return {
      collectionHighest: this.highestReceived.get('collection') ?? 0,
      injectionHighest: this.highestReceived.get('injection') ?? 0,
    };
  }

  // ─── Additional helper ───

  /**
   * Record that a sequence number was received for a given direction.
   * Updates the highest received sequence number if the new value is greater.
   */
  recordReceived(direction: TransferDirection, sequenceNumber: SequenceNumber): void {
    const current = this.highestReceived.get(direction) ?? 0;
    if (sequenceNumber > current) {
      this.highestReceived.set(direction, sequenceNumber);
    }
  }
}

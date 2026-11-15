// DTP Resume Manager Implementation
// Manages sequence-number-based resume mechanism, Fragment caching,
// breakpoint recovery, and bounded retransmission tracking (OQ-DTP-11).

import type { ResumeManager, ResumeReport } from '../types/components.js';
import type { Fragment } from '../types/fragment.js';
import type { SequenceNumber } from '../types/frame.js';
import type { TransferDirection } from '../types/agreement.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  ErrorHandler,
} from './error-handler.js';

/** Default maximum buffer size for unacknowledged fragments */
const DEFAULT_MAX_BUFFER_SIZE = 1000;

export interface RetryDecision {
  allowed: boolean;
  attempt: number;
  delayMs: number;
}

export class DTPResumeManager implements ResumeManager {
  /** Unacknowledged fragment cache keyed by sequence number */
  private readonly cache = new Map<SequenceNumber, Fragment>();

  /** Per-sequence-number retransmission attempt counter (OQ-DTP-11) */
  private readonly retryCounts = new Map<SequenceNumber, number>();

  /** Tracks the last cached sequence number for monotonic-increase validation */
  private lastCachedSequenceNumber: SequenceNumber | null = null;

  /** Highest received sequence numbers per direction */
  private readonly highestReceived = new Map<TransferDirection, SequenceNumber>([
    ['collection', 0],
    ['injection', 0],
  ]);

  /** Maximum number of fragments the cache can hold */
  private readonly maxBufferSize: number;

  /** Maximum retransmission attempts before terminal failure (OQ-DTP-11) */
  readonly maxRetries: number;

  /** Base delay in ms for exponential backoff (OQ-DTP-11) */
  readonly baseDelayMs: number;

  constructor(
    maxBufferSize: number = DEFAULT_MAX_BUFFER_SIZE,
    maxRetries: number = DEFAULT_MAX_RETRIES,
    baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  ) {
    this.maxBufferSize = maxBufferSize;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
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
    this.retryCounts.set(sequenceNumber, 0);
    this.lastCachedSequenceNumber = sequenceNumber;
  }

  acknowledgeUpTo(sequenceNumber: SequenceNumber): void {
    for (const key of this.cache.keys()) {
      if (key <= sequenceNumber) {
        this.cache.delete(key);
        this.retryCounts.delete(key);
      }
    }
  }

  getUnacknowledgedFragments(): Fragment[] {
    return [...this.cache.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, fragment]) => fragment);
  }

  /** Return sorted [sequenceNumber, Fragment] entries currently awaiting acknowledgment */
  getUnacknowledgedEntries(): Array<[SequenceNumber, Fragment]> {
    return [...this.cache.entries()].sort(([a], [b]) => a - b);
  }

  /** Remove a specific fragment from cache (e.g. after terminal retry exhaustion) */
  evictFragment(sequenceNumber: SequenceNumber): void {
    this.cache.delete(sequenceNumber);
    this.retryCounts.delete(sequenceNumber);
  }

  /** Get current retry count for a cached sequence number */
  getRetryCount(sequenceNumber: SequenceNumber): number {
    return this.retryCounts.get(sequenceNumber) ?? 0;
  }

  /**
   * Record a retransmission attempt for a cached fragment (OQ-DTP-11).
   * Returns { allowed: false } once maxRetries has already been reached.
   */
  recordRetryAttempt(sequenceNumber: SequenceNumber): RetryDecision {
    const current = this.retryCounts.get(sequenceNumber) ?? 0;
    if (current >= this.maxRetries) {
      return {
        allowed: false,
        attempt: current,
        delayMs: 0,
      };
    }
    const delayMs = ErrorHandler.computeBackoffDelay(current, this.baseDelayMs);
    const nextAttempt = current + 1;
    this.retryCounts.set(sequenceNumber, nextAttempt);
    return {
      allowed: true,
      attempt: nextAttempt,
      delayMs,
    };
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

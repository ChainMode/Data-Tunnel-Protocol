// DTP Error Handler Utility
// Creates ErrorNotificationFrames for different error types,
// handles same-MAJOR version checking (OQ-DTP-2), and provides bounded
// retransmission backoff and agreement error helpers (OQ-DTP-11).

import type { ErrorNotificationFrame } from '../errors/error-codes.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import type { FragmentID, AgreementID, ProtocolVersion } from '../types/frame.js';

/** Current protocol version */
export const CURRENT_VERSION: ProtocolVersion = { major: 1, minor: 0 };

/**
 * Minimum supported major version.
 * Aligned with Faying-Protocol (OQ-DTP-2): backward compatibility is guaranteed
 * ONLY within the same MAJOR version (no cross-MAJOR-1 compatibility).
 */
export const MIN_SUPPORTED_MAJOR = CURRENT_VERSION.major;

/** Default maximum retransmission attempts (OQ-DTP-11) */
export const DEFAULT_MAX_RETRIES = 3;

/** Default base delay in milliseconds for exponential backoff (OQ-DTP-11) */
export const DEFAULT_BASE_DELAY_MS = 200;

export class ErrorHandler {
  /**
   * Create an ErrorNotificationFrame for a frame deserialization failure (1001).
   */
  static createDeserializationError(relatedFrameId?: FragmentID): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.FRAME_DESERIALIZATION_FAILED,
      errorMessage: 'Frame deserialization failed: invalid binary data',
      relatedFrameId,
    };
  }

  /**
   * Create an ErrorNotificationFrame for a decryption failure (2001).
   */
  static createDecryptionError(relatedFrameId?: FragmentID): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.DECRYPTION_FAILED,
      errorMessage: 'Payload decryption failed',
      relatedFrameId,
    };
  }

  /**
   * Create an ErrorNotificationFrame for unknown agreement (3001).
   */
  static createAgreementNotFoundError(
    relatedAgreementId?: AgreementID,
    relatedFrameId?: FragmentID,
  ): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.AGREEMENT_NOT_FOUND,
      errorMessage: `Agreement not found: ${relatedAgreementId ?? 'null'}`,
      relatedFrameId,
      relatedAgreementId,
    };
  }

  /**
   * Create an ErrorNotificationFrame for expired agreement (3002).
   */
  static createAgreementExpiredError(
    relatedAgreementId: AgreementID,
    relatedFrameId?: FragmentID,
  ): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.AGREEMENT_EXPIRED,
      errorMessage: `Agreement expired: ${relatedAgreementId}`,
      relatedFrameId,
      relatedAgreementId,
    };
  }

  /**
   * Create an ErrorNotificationFrame for DAG cycle detection (4001).
   */
  static createDagCycleError(relatedFrameId: FragmentID): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.DAG_CYCLE_DETECTED,
      errorMessage: `DAG cycle detected for fragment: ${relatedFrameId}`,
      relatedFrameId,
    };
  }

  /**
   * Create an ErrorNotificationFrame for buffer full condition (6001).
   */
  static createBufferFullError(): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.BUFFER_FULL,
      errorMessage: 'Sender buffer is full, sending paused',
    };
  }

  /**
   * Create an ErrorNotificationFrame for retransmission timeout (6002).
   */
  static createRetransmissionTimeoutError(
    relatedFrameId?: FragmentID,
    details?: Record<string, unknown>,
  ): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.RETRANSMISSION_TIMEOUT,
      errorMessage: 'Retransmission timeout: fragment not acknowledged in time',
      relatedFrameId,
      ...(details ? { details } : {}),
    };
  }

  /**
   * Create a terminal ErrorNotificationFrame when maxRetries is exhausted (OQ-DTP-11).
   */
  static createRetransmissionExhaustedError(
    relatedFrameId: FragmentID | undefined,
    attempts: number,
    maxRetries: number = DEFAULT_MAX_RETRIES,
  ): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.RETRANSMISSION_TIMEOUT,
      errorMessage: `Retransmission failed after ${attempts} attempts (maxRetries=${maxRetries})`,
      relatedFrameId,
      details: {
        attempts,
        maxRetries,
        terminal: true,
      },
    };
  }

  /**
   * Compute exponential backoff delay in milliseconds: baseDelayMs * 2^attempt (OQ-DTP-11).
   */
  static computeBackoffDelay(attempt: number, baseDelayMs: number = DEFAULT_BASE_DELAY_MS): number {
    if (!Number.isInteger(attempt) || attempt < 0) {
      throw new Error(`Invalid retry attempt: ${attempt}`);
    }
    if (baseDelayMs <= 0 || !Number.isFinite(baseDelayMs)) {
      throw new Error(`Invalid baseDelayMs: ${baseDelayMs}`);
    }
    return baseDelayMs * Math.pow(2, attempt);
  }

  /**
   * Create an ErrorNotificationFrame for version incompatibility (7001).
   * Includes the receiver's highest supported version in details.
   */
  static createVersionIncompatibleError(
    highestSupportedVersion: ProtocolVersion,
  ): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.VERSION_INCOMPATIBLE,
      errorMessage: `Protocol version incompatible. Highest supported version: ${highestSupportedVersion.major}.${highestSupportedVersion.minor}`,
      details: {
        highestSupportedVersion,
      },
    };
  }

  /**
   * Check if a received protocol version is compatible with the current engine (OQ-DTP-2).
   * Compatible iff version.major === CURRENT_VERSION.major and minor is a non-negative integer.
   */
  static isVersionCompatible(version: ProtocolVersion): boolean {
    if (
      !Number.isInteger(version.major) ||
      !Number.isInteger(version.minor) ||
      version.minor < 0
    ) {
      return false;
    }
    return version.major === CURRENT_VERSION.major;
  }
}

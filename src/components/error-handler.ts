// DTP Error Handler Utility
// Creates ErrorNotificationFrames for different error types,
// handles version checking, and provides retransmission timeout support.
// Requirements: 14.1, 14.2, 14.4, 14.5, 15.1, 15.2, 15.3

import type { ErrorNotificationFrame } from '../errors/error-codes.js';
import { DTPErrorCode } from '../errors/error-codes.js';
import type { FragmentID, AgreementID, ProtocolVersion } from '../types/frame.js';

/** Current protocol version */
export const CURRENT_VERSION: ProtocolVersion = { major: 1, minor: 0 };

/** Minimum supported major version (supports current and previous major) */
export const MIN_SUPPORTED_MAJOR = 0;

export class ErrorHandler {
  /**
   * Create an ErrorNotificationFrame for a frame deserialization failure.
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
   * Create an ErrorNotificationFrame for a decryption failure.
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
   * Create an ErrorNotificationFrame for buffer full condition.
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
   * Create an ErrorNotificationFrame for retransmission timeout.
   */
  static createRetransmissionTimeoutError(relatedFrameId?: FragmentID): ErrorNotificationFrame {
    return {
      frameType: 'control',
      controlType: 'error_notification',
      errorCode: DTPErrorCode.RETRANSMISSION_TIMEOUT,
      errorMessage: 'Retransmission timeout: fragment not acknowledged in time',
      relatedFrameId,
    };
  }

  /**
   * Create an ErrorNotificationFrame for version incompatibility.
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
   * Check if a received protocol version is compatible with the current engine.
   * Compatible if: version.major <= CURRENT_VERSION.major AND version.major >= MIN_SUPPORTED_MAJOR
   * Returns true if compatible, false if incompatible.
   */
  static isVersionCompatible(version: ProtocolVersion): boolean {
    // Reject versions with major version higher than current
    if (version.major > CURRENT_VERSION.major) {
      return false;
    }
    // Reject versions with major version lower than minimum supported
    if (version.major < MIN_SUPPORTED_MAJOR) {
      return false;
    }
    return true;
  }
}

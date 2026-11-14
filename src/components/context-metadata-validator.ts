// Context Metadata Validator for DTP
// Validates that context metadata contains all required fields based on source type.
// Requirements: 8.1, 8.2, 8.3, 8.4

import type { ContextMetadata } from '../types/index.js';

/** Validation result: either valid or invalid with a list of errors. */
export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

/**
 * Validates ContextMetadata attached to Fragments.
 *
 * - Hardware source: requires non-empty sensorType, non-empty precision, positive samplingRate
 * - Software source: requires non-empty appIdentifier, non-empty sharingMethod
 * - Always: requires non-empty dataType
 * - customFields: always valid (extensible by design)
 */
export class ContextMetadataValidator {
  validate(metadata: ContextMetadata): ValidationResult {
    const errors: string[] = [];

    // dataType is always required
    if (typeof metadata.dataType !== 'string' || metadata.dataType.length === 0) {
      errors.push('dataType must be a non-empty string');
    }

    const source = metadata.source;

    if (source.kind === 'hardware') {
      if (typeof source.sensorType !== 'string' || source.sensorType.length === 0) {
        errors.push('hardware source: sensorType must be a non-empty string');
      }
      if (typeof source.precision !== 'string' || source.precision.length === 0) {
        errors.push('hardware source: precision must be a non-empty string');
      }
      if (typeof source.samplingRate !== 'number' || source.samplingRate <= 0) {
        errors.push('hardware source: samplingRate must be a positive number');
      }
    } else if (source.kind === 'software') {
      if (typeof source.appIdentifier !== 'string' || source.appIdentifier.length === 0) {
        errors.push('software source: appIdentifier must be a non-empty string');
      }
      if (typeof source.sharingMethod !== 'string' || source.sharingMethod.length === 0) {
        errors.push('software source: sharingMethod must be a non-empty string');
      }
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }
}

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextMetadataValidator } from './context-metadata-validator.js';
import type { ContextMetadata } from '../types/index.js';

describe('ContextMetadataValidator', () => {
  let validator: ContextMetadataValidator;

  beforeEach(() => {
    validator = new ContextMetadataValidator();
  });

  // ── Valid metadata ──

  describe('valid metadata', () => {
    it('accepts valid hardware source metadata', () => {
      const metadata: ContextMetadata = {
        dataType: 'heart_rate',
        source: { kind: 'hardware', sensorType: 'PPG', precision: '±1bpm', samplingRate: 100 },
        customFields: {},
      };
      expect(validator.validate(metadata)).toEqual({ valid: true });
    });

    it('accepts valid software source metadata', () => {
      const metadata: ContextMetadata = {
        dataType: 'location',
        source: { kind: 'software', appIdentifier: 'com.example.maps', sharingMethod: 'api_push' },
        customFields: {},
      };
      expect(validator.validate(metadata)).toEqual({ valid: true });
    });

    it('accepts metadata with custom fields', () => {
      const metadata: ContextMetadata = {
        dataType: 'temperature',
        source: { kind: 'hardware', sensorType: 'thermometer', precision: '±0.1°C', samplingRate: 1 },
        customFields: { unit: 'celsius', location: 'outdoor', nested: { a: 1 } },
      };
      expect(validator.validate(metadata)).toEqual({ valid: true });
    });

    it('accepts metadata with empty custom fields', () => {
      const metadata: ContextMetadata = {
        dataType: 'steps',
        source: { kind: 'hardware', sensorType: 'accelerometer', precision: '±5steps', samplingRate: 50 },
        customFields: {},
      };
      expect(validator.validate(metadata)).toEqual({ valid: true });
    });
  });

  // ── dataType validation ──

  describe('dataType validation', () => {
    it('rejects empty dataType', () => {
      const metadata: ContextMetadata = {
        dataType: '',
        source: { kind: 'hardware', sensorType: 'PPG', precision: '±1bpm', samplingRate: 100 },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('dataType must be a non-empty string');
      }
    });
  });

  // ── Hardware source validation ──

  describe('hardware source validation', () => {
    it('rejects empty sensorType', () => {
      const metadata: ContextMetadata = {
        dataType: 'heart_rate',
        source: { kind: 'hardware', sensorType: '', precision: '±1bpm', samplingRate: 100 },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('hardware source: sensorType must be a non-empty string');
      }
    });

    it('rejects empty precision', () => {
      const metadata: ContextMetadata = {
        dataType: 'heart_rate',
        source: { kind: 'hardware', sensorType: 'PPG', precision: '', samplingRate: 100 },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('hardware source: precision must be a non-empty string');
      }
    });

    it('rejects zero samplingRate', () => {
      const metadata: ContextMetadata = {
        dataType: 'heart_rate',
        source: { kind: 'hardware', sensorType: 'PPG', precision: '±1bpm', samplingRate: 0 },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('hardware source: samplingRate must be a positive number');
      }
    });

    it('rejects negative samplingRate', () => {
      const metadata: ContextMetadata = {
        dataType: 'heart_rate',
        source: { kind: 'hardware', sensorType: 'PPG', precision: '±1bpm', samplingRate: -10 },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('hardware source: samplingRate must be a positive number');
      }
    });

    it('collects multiple errors for hardware source', () => {
      const metadata: ContextMetadata = {
        dataType: '',
        source: { kind: 'hardware', sensorType: '', precision: '', samplingRate: -1 },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(4);
      }
    });
  });

  // ── Software source validation ──

  describe('software source validation', () => {
    it('rejects empty appIdentifier', () => {
      const metadata: ContextMetadata = {
        dataType: 'location',
        source: { kind: 'software', appIdentifier: '', sharingMethod: 'api_push' },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('software source: appIdentifier must be a non-empty string');
      }
    });

    it('rejects empty sharingMethod', () => {
      const metadata: ContextMetadata = {
        dataType: 'location',
        source: { kind: 'software', appIdentifier: 'com.example.app', sharingMethod: '' },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContain('software source: sharingMethod must be a non-empty string');
      }
    });

    it('collects multiple errors for software source', () => {
      const metadata: ContextMetadata = {
        dataType: '',
        source: { kind: 'software', appIdentifier: '', sharingMethod: '' },
        customFields: {},
      };
      const result = validator.validate(metadata);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(3);
      }
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { DTPResumeManager } from './resume-manager.js';
import type { Fragment } from '../types/fragment.js';

function makeFragment(id: string): Fragment {
  return {
    fragmentId: id,
    agreementId: 'agreement-001',
    originTimestamp: Date.now(),
    contextMetadata: {
      dataType: 'test',
      source: { kind: 'software', appIdentifier: 'test-app', sharingMethod: 'api' },
      customFields: {},
    },
    dagDependencies: [],
    data: new Uint8Array([1, 2, 3]),
  };
}

describe('DTPResumeManager', () => {
  let manager: DTPResumeManager;

  beforeEach(() => {
    manager = new DTPResumeManager();
  });

  describe('cacheFragment', () => {
    it('caches a fragment with its sequence number', () => {
      manager.cacheFragment(makeFragment('f1'), 1);
      const fragments = manager.getUnacknowledgedFragments();
      expect(fragments).toHaveLength(1);
      expect(fragments[0].fragmentId).toBe('f1');
    });

    it('caches multiple fragments with increasing sequence numbers', () => {
      manager.cacheFragment(makeFragment('f1'), 1);
      manager.cacheFragment(makeFragment('f2'), 2);
      manager.cacheFragment(makeFragment('f3'), 3);
      expect(manager.getUnacknowledgedFragments()).toHaveLength(3);
    });

    it('throws if sequence number is not monotonically increasing', () => {
      manager.cacheFragment(makeFragment('f1'), 5);
      expect(() => manager.cacheFragment(makeFragment('f2'), 3)).toThrow(
        /Sequence number must be monotonically increasing/,
      );
    });

    it('throws if sequence number equals the last cached one', () => {
      manager.cacheFragment(makeFragment('f1'), 5);
      expect(() => manager.cacheFragment(makeFragment('f2'), 5)).toThrow(
        /Sequence number must be monotonically increasing/,
      );
    });
  });

  describe('acknowledgeUpTo', () => {
    it('removes all fragments with sequence number <= given value', () => {
      manager.cacheFragment(makeFragment('f1'), 1);
      manager.cacheFragment(makeFragment('f2'), 2);
      manager.cacheFragment(makeFragment('f3'), 3);
      manager.acknowledgeUpTo(2);
      const remaining = manager.getUnacknowledgedFragments();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].fragmentId).toBe('f3');
    });

    it('removes all fragments when acknowledging the highest', () => {
      manager.cacheFragment(makeFragment('f1'), 1);
      manager.cacheFragment(makeFragment('f2'), 2);
      manager.acknowledgeUpTo(2);
      expect(manager.getUnacknowledgedFragments()).toHaveLength(0);
    });

    it('does nothing when acknowledging below all cached sequence numbers', () => {
      manager.cacheFragment(makeFragment('f1'), 5);
      manager.cacheFragment(makeFragment('f2'), 10);
      manager.acknowledgeUpTo(3);
      expect(manager.getUnacknowledgedFragments()).toHaveLength(2);
    });

    it('handles empty cache gracefully', () => {
      expect(() => manager.acknowledgeUpTo(10)).not.toThrow();
    });
  });

  describe('getUnacknowledgedFragments', () => {
    it('returns fragments sorted by sequence number', () => {
      manager.cacheFragment(makeFragment('f1'), 1);
      manager.cacheFragment(makeFragment('f3'), 3);
      manager.cacheFragment(makeFragment('f2'), 5);
      const fragments = manager.getUnacknowledgedFragments();
      expect(fragments.map((f) => f.fragmentId)).toEqual(['f1', 'f3', 'f2']);
    });

    it('returns empty array when no fragments are cached', () => {
      expect(manager.getUnacknowledgedFragments()).toEqual([]);
    });
  });

  describe('isBufferFull', () => {
    it('returns false when cache is below max buffer size', () => {
      manager.cacheFragment(makeFragment('f1'), 1);
      expect(manager.isBufferFull()).toBe(false);
    });

    it('returns true when cache reaches max buffer size', () => {
      const smallManager = new DTPResumeManager(3);
      smallManager.cacheFragment(makeFragment('f1'), 1);
      smallManager.cacheFragment(makeFragment('f2'), 2);
      smallManager.cacheFragment(makeFragment('f3'), 3);
      expect(smallManager.isBufferFull()).toBe(true);
    });

    it('returns false for empty cache', () => {
      expect(manager.isBufferFull()).toBe(false);
    });

    it('uses default max buffer size of 1000', () => {
      // Cache 999 fragments — should not be full
      for (let i = 1; i <= 999; i++) {
        manager.cacheFragment(makeFragment(`f${i}`), i);
      }
      expect(manager.isBufferFull()).toBe(false);
      manager.cacheFragment(makeFragment('f1000'), 1000);
      expect(manager.isBufferFull()).toBe(true);
    });
  });

  describe('getHighestReceivedSequenceNumber', () => {
    it('returns 0 initially for collection direction', () => {
      expect(manager.getHighestReceivedSequenceNumber('collection')).toBe(0);
    });

    it('returns 0 initially for injection direction', () => {
      expect(manager.getHighestReceivedSequenceNumber('injection')).toBe(0);
    });

    it('returns the highest recorded sequence number for a direction', () => {
      manager.recordReceived('collection', 5);
      manager.recordReceived('collection', 10);
      expect(manager.getHighestReceivedSequenceNumber('collection')).toBe(10);
    });

    it('does not update if a lower sequence number is recorded', () => {
      manager.recordReceived('injection', 10);
      manager.recordReceived('injection', 3);
      expect(manager.getHighestReceivedSequenceNumber('injection')).toBe(10);
    });

    it('tracks directions independently', () => {
      manager.recordReceived('collection', 7);
      manager.recordReceived('injection', 15);
      expect(manager.getHighestReceivedSequenceNumber('collection')).toBe(7);
      expect(manager.getHighestReceivedSequenceNumber('injection')).toBe(15);
    });
  });

  describe('reportResumePoint', () => {
    it('returns zeros when no data has been received', () => {
      const report = manager.reportResumePoint();
      expect(report).toEqual({ collectionHighest: 0, injectionHighest: 0 });
    });

    it('returns correct highest sequence numbers for both directions', () => {
      manager.recordReceived('collection', 42);
      manager.recordReceived('injection', 99);
      const report = manager.reportResumePoint();
      expect(report).toEqual({ collectionHighest: 42, injectionHighest: 99 });
    });

    it('reflects only the highest values after multiple recordings', () => {
      manager.recordReceived('collection', 5);
      manager.recordReceived('collection', 20);
      manager.recordReceived('collection', 10);
      manager.recordReceived('injection', 3);
      manager.recordReceived('injection', 50);
      const report = manager.reportResumePoint();
      expect(report).toEqual({ collectionHighest: 20, injectionHighest: 50 });
    });
  });

  describe('recordReceived', () => {
    it('updates highest for a direction when given a higher value', () => {
      manager.recordReceived('collection', 1);
      manager.recordReceived('collection', 5);
      expect(manager.getHighestReceivedSequenceNumber('collection')).toBe(5);
    });

    it('ignores lower values', () => {
      manager.recordReceived('collection', 10);
      manager.recordReceived('collection', 2);
      expect(manager.getHighestReceivedSequenceNumber('collection')).toBe(10);
    });

    it('ignores equal values', () => {
      manager.recordReceived('injection', 7);
      manager.recordReceived('injection', 7);
      expect(manager.getHighestReceivedSequenceNumber('injection')).toBe(7);
    });
  });

  describe('constructor with custom maxBufferSize', () => {
    it('respects custom max buffer size', () => {
      const small = new DTPResumeManager(2);
      small.cacheFragment(makeFragment('f1'), 1);
      expect(small.isBufferFull()).toBe(false);
      small.cacheFragment(makeFragment('f2'), 2);
      expect(small.isBufferFull()).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryTransportAdapter } from './transport-adapter.js';
import type { TransportEndpoint, ConnectionState } from '../types/components.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeEndpoint(overrides: Partial<TransportEndpoint> = {}): TransportEndpoint {
  return {
    protocol: 'websocket',
    address: 'localhost',
    port: 8080,
    ...overrides,
  };
}

describe('InMemoryTransportAdapter', () => {
  let adapter: InMemoryTransportAdapter;

  beforeEach(() => {
    adapter = new InMemoryTransportAdapter();
  });

  describe('connect', () => {
    it('returns a connection with a valid UUID v4 connectionId', () => {
      const conn = adapter.connect(makeEndpoint());
      expect(conn.connectionId).toMatch(UUID_REGEX);
    });

    it('returns a connection in connected state', () => {
      const conn = adapter.connect(makeEndpoint());
      expect(conn.state).toBe('connected');
    });

    it('generates unique connectionIds for multiple connections', () => {
      const c1 = adapter.connect(makeEndpoint());
      const c2 = adapter.connect(makeEndpoint());
      expect(c1.connectionId).not.toBe(c2.connectionId);
    });

    it('fires connection state change event on connect', () => {
      const handler = vi.fn();
      adapter.onConnectionStateChange(handler);
      const conn = adapter.connect(makeEndpoint());
      expect(handler).toHaveBeenCalledWith(conn.connectionId, 'connected');
    });
  });

  describe('disconnect', () => {
    it('changes connection state to disconnected', () => {
      const conn = adapter.connect(makeEndpoint());
      adapter.disconnect(conn.connectionId);
      expect(adapter.getConnection(conn.connectionId)?.state).toBe('disconnected');
    });

    it('fires connection state change event on disconnect', () => {
      const conn = adapter.connect(makeEndpoint());
      const handler = vi.fn();
      adapter.onConnectionStateChange(handler);
      adapter.disconnect(conn.connectionId);
      expect(handler).toHaveBeenCalledWith(conn.connectionId, 'disconnected');
    });

    it('does not throw when disconnecting an unknown connectionId', () => {
      expect(() => adapter.disconnect('nonexistent')).not.toThrow();
    });
  });

  describe('send', () => {
    it('throws when sending on an unknown connectionId', () => {
      expect(() => adapter.send('nonexistent', new Uint8Array([1]))).toThrow('Connection not found');
    });

    it('throws when sending on a disconnected connection', () => {
      const conn = adapter.connect(makeEndpoint());
      adapter.disconnect(conn.connectionId);
      expect(() => adapter.send(conn.connectionId, new Uint8Array([1]))).toThrow('Connection is not active');
    });
  });

  describe('onReceive', () => {
    it('registers a receive handler without error', () => {
      expect(() => adapter.onReceive(() => {})).not.toThrow();
    });
  });

  describe('onConnectionStateChange', () => {
    it('supports multiple handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      adapter.onConnectionStateChange(h1);
      adapter.onConnectionStateChange(h2);
      const conn = adapter.connect(makeEndpoint());
      expect(h1).toHaveBeenCalledWith(conn.connectionId, 'connected');
      expect(h2).toHaveBeenCalledWith(conn.connectionId, 'connected');
    });
  });

  describe('paired adapters', () => {
    let adapterA: InMemoryTransportAdapter;
    let adapterB: InMemoryTransportAdapter;

    beforeEach(() => {
      adapterA = new InMemoryTransportAdapter();
      adapterB = new InMemoryTransportAdapter();
      InMemoryTransportAdapter.pair(adapterA, adapterB);
    });

    it('creates mirrored connection on paired adapter when connecting', () => {
      const stateHandler = vi.fn();
      adapterB.onConnectionStateChange(stateHandler);
      adapterA.connect(makeEndpoint());
      // adapterB should have received a connected event for the mirrored connection
      expect(stateHandler).toHaveBeenCalledTimes(1);
      expect(stateHandler).toHaveBeenCalledWith(expect.any(String), 'connected');
    });

    it('delivers sent data to paired adapter receive handlers', () => {
      const receiveHandler = vi.fn();
      adapterB.onReceive(receiveHandler);

      const conn = adapterA.connect(makeEndpoint());
      const data = new Uint8Array([10, 20, 30]);
      adapterA.send(conn.connectionId, data);

      expect(receiveHandler).toHaveBeenCalledTimes(1);
      const [remoteConnId, receivedData] = receiveHandler.mock.calls[0];
      expect(remoteConnId).toMatch(UUID_REGEX);
      expect(receivedData).toEqual(data);
    });

    it('supports bidirectional communication', () => {
      const receiveA = vi.fn();
      const receiveB = vi.fn();
      adapterA.onReceive(receiveA);
      adapterB.onReceive(receiveB);

      // A connects, which creates mirrored connection on B
      const connA = adapterA.connect(makeEndpoint());

      // Send from A to B
      adapterA.send(connA.connectionId, new Uint8Array([1, 2, 3]));
      expect(receiveB).toHaveBeenCalledTimes(1);

      // Get the remote connectionId from B's receive call
      const remoteConnId = receiveB.mock.calls[0][0];

      // Send from B to A using the mirrored connection
      adapterB.send(remoteConnId, new Uint8Array([4, 5, 6]));
      expect(receiveA).toHaveBeenCalledTimes(1);
      expect(receiveA.mock.calls[0][1]).toEqual(new Uint8Array([4, 5, 6]));
    });

    it('sends a copy of data, not a reference', () => {
      const receiveHandler = vi.fn();
      adapterB.onReceive(receiveHandler);

      const conn = adapterA.connect(makeEndpoint());
      const data = new Uint8Array([10, 20, 30]);
      adapterA.send(conn.connectionId, data);

      // Mutate original data
      data[0] = 99;
      // Received data should be unchanged
      expect(receiveHandler.mock.calls[0][1][0]).toBe(10);
    });

    it('disconnects mirrored connection when local connection disconnects', () => {
      const stateHandler = vi.fn();
      adapterB.onConnectionStateChange(stateHandler);

      const conn = adapterA.connect(makeEndpoint());
      // stateHandler called once for 'connected'
      expect(stateHandler).toHaveBeenCalledTimes(1);

      adapterA.disconnect(conn.connectionId);
      // stateHandler called again for 'disconnected'
      expect(stateHandler).toHaveBeenCalledTimes(2);
      expect(stateHandler).toHaveBeenLastCalledWith(expect.any(String), 'disconnected');
    });

    it('does not deliver data after disconnect', () => {
      const receiveHandler = vi.fn();
      adapterB.onReceive(receiveHandler);

      const conn = adapterA.connect(makeEndpoint());
      adapterA.disconnect(conn.connectionId);

      expect(() => adapterA.send(conn.connectionId, new Uint8Array([1]))).toThrow('Connection is not active');
      expect(receiveHandler).not.toHaveBeenCalled();
    });
  });
});

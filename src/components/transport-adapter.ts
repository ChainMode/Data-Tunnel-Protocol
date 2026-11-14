// DTP Transport Adapter Implementation
// Provides an in-memory transport adapter for testing and development.
// Implements the Transport_Adapter interface with connection state management
// and bidirectional communication via adapter pairing.

import { v4 as uuidv4 } from 'uuid';
import type {
  Transport_Adapter,
  TransportEndpoint,
  Connection,
  ConnectionID,
  ConnectionState,
} from '../types/components.js';

/**
 * In-memory transport adapter that simulates connections using internal buffers.
 * Two adapters can be paired together for bidirectional communication.
 */
export class InMemoryTransportAdapter implements Transport_Adapter {
  /** Active connections keyed by ConnectionID */
  private readonly connections = new Map<ConnectionID, Connection>();

  /** Registered receive handlers */
  private readonly receiveHandlers: Array<(connectionId: ConnectionID, data: Uint8Array) => void> = [];

  /** Registered connection state change handlers */
  private readonly stateChangeHandlers: Array<(connectionId: ConnectionID, state: ConnectionState) => void> = [];

  /** Paired remote adapter (for bidirectional communication) */
  private pairedAdapter: InMemoryTransportAdapter | null = null;

  /** Mapping from local connectionId to remote connectionId in the paired adapter */
  private readonly remoteConnectionMap = new Map<ConnectionID, ConnectionID>();

  connect(endpoint: TransportEndpoint): Connection {
    const connectionId = uuidv4();
    const connection: Connection = {
      connectionId,
      state: 'connected',
    };
    this.connections.set(connectionId, connection);
    this.fireStateChange(connectionId, 'connected');

    // If paired, create a mirrored connection on the remote adapter
    if (this.pairedAdapter) {
      const remoteId = uuidv4();
      const remoteConnection: Connection = {
        connectionId: remoteId,
        state: 'connected',
      };
      this.pairedAdapter.connections.set(remoteId, remoteConnection);
      this.pairedAdapter.fireStateChange(remoteId, 'connected');

      // Map local → remote and remote → local
      this.remoteConnectionMap.set(connectionId, remoteId);
      this.pairedAdapter.remoteConnectionMap.set(remoteId, connectionId);
    }

    return connection;
  }

  disconnect(connectionId: ConnectionID): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    connection.state = 'disconnected';
    this.fireStateChange(connectionId, 'disconnected');

    // Also disconnect the mirrored connection on the paired adapter
    if (this.pairedAdapter) {
      const remoteId = this.remoteConnectionMap.get(connectionId);
      if (remoteId) {
        const remoteConn = this.pairedAdapter.connections.get(remoteId);
        if (remoteConn && remoteConn.state !== 'disconnected') {
          remoteConn.state = 'disconnected';
          this.pairedAdapter.fireStateChange(remoteId, 'disconnected');
        }
        this.pairedAdapter.remoteConnectionMap.delete(remoteId);
        this.remoteConnectionMap.delete(connectionId);
      }
    }
  }

  send(connectionId: ConnectionID, data: Uint8Array): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    if (connection.state !== 'connected') {
      throw new Error(`Connection is not active: ${connectionId} (state: ${connection.state})`);
    }

    // Deliver data to the paired adapter's receive handlers
    if (this.pairedAdapter) {
      const remoteId = this.remoteConnectionMap.get(connectionId);
      if (remoteId) {
        const copy = new Uint8Array(data);
        for (const handler of this.pairedAdapter.receiveHandlers) {
          handler(remoteId, copy);
        }
      }
    }
  }

  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void {
    this.receiveHandlers.push(handler);
  }

  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void {
    this.stateChangeHandlers.push(handler);
  }

  // ─── Helper methods ───

  /** Get a connection by ID (useful for testing) */
  getConnection(connectionId: ConnectionID): Connection | undefined {
    return this.connections.get(connectionId);
  }

  /** Fire connection state change event to all registered handlers */
  private fireStateChange(connectionId: ConnectionID, state: ConnectionState): void {
    for (const handler of this.stateChangeHandlers) {
      handler(connectionId, state);
    }
  }

  /**
   * Pair two adapters together for bidirectional communication.
   * After pairing, data sent on one adapter is delivered to the other's receive handlers.
   */
  static pair(adapter1: InMemoryTransportAdapter, adapter2: InMemoryTransportAdapter): void {
    adapter1.pairedAdapter = adapter2;
    adapter2.pairedAdapter = adapter1;
  }
}

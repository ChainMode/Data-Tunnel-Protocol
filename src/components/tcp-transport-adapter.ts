// Real TCP Loopback/Network Transport Adapter for DTP
// Uses Node.js `node:net` with 4-byte big-endian length-prefixed framing to preserve
// LogicalFrame boundaries across TCP stream chunking and packet coalescing.

import { createServer, createConnection } from 'node:net';
import type { Server, Socket, AddressInfo } from 'node:net';
import { v4 as uuidv4 } from 'uuid';
import type {
  Transport_Adapter,
  TransportEndpoint,
  Connection,
  ConnectionID,
  ConnectionState,
} from '../types/components.js';

export class TcpTransportAdapter implements Transport_Adapter {
  private server: Server | null = null;
  private readonly connections = new Map<ConnectionID, Connection>();
  private readonly sockets = new Map<ConnectionID, Socket>();
  private readonly recvBuffers = new Map<ConnectionID, Buffer>();
  private readonly receiveHandlers: Array<(connectionId: ConnectionID, data: Uint8Array) => void> = [];
  private readonly stateChangeHandlers: Array<(connectionId: ConnectionID, state: ConnectionState) => void> = [];

  /**
   * Bind a TCP server (defaults to 127.0.0.1 ephemeral port 0).
   */
  listen(port: number = 0, host: string = '127.0.0.1'): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        reject(new Error('TcpTransportAdapter server is already listening'));
        return;
      }

      const srv = createServer((socket) => {
        const connectionId = uuidv4();
        const conn: Connection = { connectionId, state: 'connected' };
        this.connections.set(connectionId, conn);
        this.attachSocket(connectionId, socket, true);
      });

      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.removeListener('error', reject);
        this.server = srv;
        const addr = srv.address() as AddressInfo;
        resolve({ host: addr.address, port: addr.port });
      });
    });
  }

  /**
   * Synchronous Transport_Adapter.connect contract.
   * Underlying socket buffers writes until TCP handshake completes.
   */
  connect(endpoint: TransportEndpoint): Connection {
    if (!endpoint.port) {
      throw new Error('TcpTransportAdapter requires endpoint.port');
    }

    const connectionId = uuidv4();
    const conn: Connection = { connectionId, state: 'connected' };
    this.connections.set(connectionId, conn);

    const socket = createConnection({
      host: endpoint.address,
      port: endpoint.port,
    });
    this.attachSocket(connectionId, socket, false);
    this.fireStateChange(connectionId, 'connected');

    return conn;
  }

  /**
   * Async connect helper that awaits TCP 'connect' event before resolving.
   */
  connectAsync(endpoint: TransportEndpoint): Promise<Connection> {
    if (!endpoint.port) {
      return Promise.reject(new Error('TcpTransportAdapter requires endpoint.port'));
    }
    const port = endpoint.port;

    return new Promise((resolve, reject) => {
      const connectionId = uuidv4();
      const conn: Connection = { connectionId, state: 'connected' };
      this.connections.set(connectionId, conn);

      const socket = createConnection({
        host: endpoint.address,
        port,
      });

      const onInitialError = (err: Error) => {
        conn.state = 'error';
        this.fireStateChange(connectionId, 'error');
        reject(err);
      };

      socket.once('error', onInitialError);
      socket.once('connect', () => {
        socket.removeListener('error', onInitialError);
        this.attachSocket(connectionId, socket, false);
        this.fireStateChange(connectionId, 'connected');
        resolve(conn);
      });
    });
  }

  disconnect(connectionId: ConnectionID): void {
    const conn = this.connections.get(connectionId);
    if (!conn || conn.state === 'disconnected') {
      return;
    }

    conn.state = 'disconnected';
    const socket = this.sockets.get(connectionId);
    if (socket) {
      socket.destroy();
      this.sockets.delete(connectionId);
    }
    this.recvBuffers.delete(connectionId);
    this.fireStateChange(connectionId, 'disconnected');
  }

  send(connectionId: ConnectionID, data: Uint8Array): void {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    if (conn.state !== 'connected') {
      throw new Error(`Connection is not active: ${connectionId} (state: ${conn.state})`);
    }
    const socket = this.sockets.get(connectionId);
    if (!socket || socket.destroyed) {
      throw new Error(`Socket is closed for connection: ${connectionId}`);
    }

    // 4-byte big-endian length prefix + frame payload
    const frameBuf = Buffer.allocUnsafe(4 + data.length);
    frameBuf.writeUInt32BE(data.length, 0);
    frameBuf.set(data, 4);
    socket.write(frameBuf);
  }

  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void {
    this.receiveHandlers.push(handler);
  }

  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void {
    this.stateChangeHandlers.push(handler);
  }

  getConnection(connectionId: ConnectionID): Connection | undefined {
    return this.connections.get(connectionId);
  }

  /** Gracefully destroy all sockets and close listening server */
  async close(): Promise<void> {
    for (const [cid, sock] of this.sockets.entries()) {
      sock.destroy();
      const conn = this.connections.get(cid);
      if (conn) conn.state = 'disconnected';
    }
    this.sockets.clear();
    this.recvBuffers.clear();

    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
      });
    }
  }

  private attachSocket(connectionId: ConnectionID, socket: Socket, fireInitialConnected: boolean): void {
    socket.setNoDelay(true);
    this.sockets.set(connectionId, socket);
    this.recvBuffers.set(connectionId, Buffer.alloc(0));

    if (fireInitialConnected) {
      this.fireStateChange(connectionId, 'connected');
    }

    socket.on('data', (chunk: Buffer) => {
      const prev = this.recvBuffers.get(connectionId) ?? Buffer.alloc(0);
      let acc = prev.length === 0 ? chunk : Buffer.concat([prev, chunk]);

      while (acc.length >= 4) {
        const packetLen = acc.readUInt32BE(0);
        if (acc.length < 4 + packetLen) {
          break;
        }
        const packetBytes = new Uint8Array(acc.subarray(4, 4 + packetLen));
        acc = acc.subarray(4 + packetLen);
        for (const handler of this.receiveHandlers) {
          handler(connectionId, packetBytes);
        }
      }

      this.recvBuffers.set(connectionId, Buffer.from(acc));
    });

    socket.on('error', () => {
      const conn = this.connections.get(connectionId);
      if (conn && conn.state !== 'disconnected') {
        conn.state = 'error';
        this.fireStateChange(connectionId, 'error');
      }
    });

    socket.on('close', () => {
      const conn = this.connections.get(connectionId);
      this.sockets.delete(connectionId);
      this.recvBuffers.delete(connectionId);
      if (conn && conn.state !== 'disconnected') {
        conn.state = 'disconnected';
        this.fireStateChange(connectionId, 'disconnected');
      }
    });
  }

  private fireStateChange(connectionId: ConnectionID, state: ConnectionState): void {
    for (const handler of this.stateChangeHandlers) {
      handler(connectionId, state);
    }
  }
}

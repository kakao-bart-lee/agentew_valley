/**
 * @agent-observatory/collector-cli
 *
 * Programmatic API for embedding the remote collector transport.
 */

export { WebSocketTransport } from './transport.js';
export type { TransportOptions } from './transport.js';
export { persistEvent, readPersistedEvents } from './persistence.js';

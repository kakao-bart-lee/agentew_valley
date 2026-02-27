import { io } from 'socket.io-client';
import { AgentLiveState, UAEPEvent } from './types/agent';
import { MetricsSnapshot } from './types/metrics';

// Since we are just a frontend build, we will expose a mock global function or just mock the socket
// This is a minimal socket.io-mock or interceptor if we don't have a real server.
// For now, we'll just run Vite and tell the user they need the backend to see real data.
console.log("Mock data generator can be added here");

/**
 * Test-only provider. It is never registered by the production factory; the API
 * wires it in only when NODE_ENV=test via an explicit injection point.
 */
export { MockProvider, type MockScript, type MockTurn } from './mock.js';
export { sseResponse, jsonResponse, errorResponse, fetchSequence } from './fetch-stubs.js';

import { createHash } from 'crypto';
import { parentPort } from 'node:worker_threads';

const port = parentPort;
if (!port) throw new Error('Media hash worker must run in a worker thread');

port.on('message', ({ buffer, byteOffset, byteLength, id }) => {
  try {
    const hash = createHash('sha256').update(new Uint8Array(buffer, byteOffset, byteLength)).digest('hex');
    port.postMessage({ id, hash });
  } catch (error) {
    port.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

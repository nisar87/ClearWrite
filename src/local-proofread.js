import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

let worker;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./local-proofread-worker.js', import.meta.url));
  worker.unref();
  worker.on('message', (message) => {
    if (message.type === 'ready') return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  worker.on('error', (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
    worker = undefined;
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('The on-device proofreader stopped unexpectedly.'));
      }
      pending.clear();
    }
    worker = undefined;
  });
  return worker;
}

export function proofreadLocally(text) {
  if (typeof text !== 'string') return Promise.reject(new Error('Text must be plain text.'));
  if (text.length > 6000) return Promise.reject(new Error('Text is too long for the on-device check.'));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The on-device proofreader took too long.'));
    }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    try { getWorker().postMessage({ id, text }); }
    catch (error) {
      pending.delete(id);
      clearTimeout(timeout);
      reject(error);
    }
  });
}

export function stopLocalProofreader() {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error('The on-device proofreader is shutting down.'));
  }
  pending.clear();
  void worker?.terminate();
  worker = undefined;
}

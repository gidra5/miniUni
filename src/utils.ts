import { SystemError } from './error.js';

export const identity = <T>(x: T): T => x;

export const inspect = <T>(x: T): T => (console.dir(x, { depth: null }), x);

export function assert(
  condition: any,
  msg?: string | SystemError
): asserts condition {
  if (condition) return;
  if (!msg) throw new Error('Assertion failed');
  if (msg instanceof SystemError) throw msg;
  throw new Error(`Assertion failed: ${msg}`);
}

export function unreachable(msg?: string | SystemError): never {
  if (!msg) throw new Error('Unreachable');
  if (msg instanceof SystemError) throw msg;
  throw new Error(msg);
}

export const clamp = (x: number, min: number, max: number) =>
  Math.min(Math.max(x, min), max);

export const isEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !isEqual(value, b.get(key))) return false;
    }
    return true;
  }

  if (Object.keys(a).length !== Object.keys(b).length) return false;
  for (const key in a) {
    if (!(key in b)) return false;
    if (!isEqual(a[key], b[key])) return false;
  }

  return true;
};

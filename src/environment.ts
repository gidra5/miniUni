import { assert, inspect } from './utils';
import {
  createRecord,
  EvalRecord,
  EvalValue,
  isRecord,
  recordOmit,
} from './values';

export type Environment = {
  parent: Environment | null;
  entries: Map<EvalValue, EvalValue>;
};

const envParent = Symbol();
export interface Handlers {
  get(key: EvalValue): EvalValue;
  set(key: EvalValue, value: EvalValue): boolean;
  add(key: EvalValue, value: EvalValue): void;
  resolve(): EvalRecord;
  own(key: EvalValue): boolean;
  keys(): EvalValue[];

  [envParent]: Handlers | null;
}

export const newHandlers = (
  entries: Record<PropertyKey, EvalValue> | EvalRecord = new Map(),
  parent: Handlers | null = null
): Handlers => {
  entries = isRecord(entries) ? entries : createRecord(entries);
  return {
    get(key) {
      if (entries.has(key)) return entries.get(key)!;
      if (parent) return parent.get(key);
      return null;
    },
    set(key, value) {
      if (entries.has(key)) {
        if (value === null) entries.delete(key);
        else entries.set(key, value);
        return true;
      }
      if (parent) return parent.set(key, value);
      else return false;
    },
    add(key, value) {
      entries.set(key, value);
    },
    resolve() {
      if (!parent) return entries;
      return new Map([...parent.resolve(), ...entries]);
    },
    own(key) {
      return entries.has(key);
    },
    keys() {
      return [...this.resolve().keys()];
    },

    [envParent]: parent,
  };
};

export const handlersHas = (env: Handlers, key: EvalValue): boolean => {
  if (env.own(key)) return true;
  if (env[envParent]) return handlersHas(env[envParent], key);
  return false;
};

export const maskHandlers = (env: Handlers, keys: EvalValue[]): Handlers => {
  const resolveKey = (key: EvalValue, _env = env) => {
    if (_env.own(key)) return _env;
    if (_env[envParent]) return resolveKey(key, _env[envParent]);
    return null;
  };
  return {
    get(key) {
      const _env = resolveKey(key);
      if (!_env) return null;
      if (keys.includes(key)) {
        if (!_env[envParent]) return null;
        return _env[envParent].get(key);
      }
      return _env.get(key);
    },
    set(key, value) {
      const _env = resolveKey(key);
      if (!_env) return false;
      if (keys.includes(key)) {
        if (!_env[envParent]) return false;
        return _env[envParent].set(key, value);
      }
      return _env.set(key, value);
    },
    add(key, value) {
      env.add(key, value);
    },
    resolve() {
      const keys = this.keys();
      const entries: [EvalValue, EvalValue][] = keys.map((k) => [
        k,
        this.get(k),
      ]);
      return new Map(entries);
    },
    own(key) {
      if (keys.includes(key)) return false;
      return env.own(key);
    },
    keys() {
      return env.keys().filter((k) => !!resolveKey(k));
    },

    [envParent]: env,
  };
};

export const withoutHandlers = (env: Handlers, keys: EvalValue[]): Handlers => {
  return {
    get(key) {
      if (keys.includes(key)) return null;
      return env.get(key);
    },
    set(key, value) {
      if (keys.includes(key)) return false;
      return env.set(key, value);
    },
    add(key, value) {
      env.add(key, value);
    },
    resolve() {
      return recordOmit(env.resolve(), keys);
    },
    own(key) {
      if (keys.includes(key)) return false;
      return env.own(key);
    },
    keys() {
      return env.keys().filter((k) => !keys.includes(k));
    },

    [envParent]: env,
  };
};

export const newEnvironment = (
  entries: Record<PropertyKey, EvalValue> | EvalRecord = new Map(),
  parent: Environment | null = null
): Environment => ({
  parent,
  entries: isRecord(entries) ? entries : createRecord(entries),
});

export const environmentGet = (env: Environment, key: EvalValue): EvalValue => {
  if (env.entries.has(key)) return env.entries.get(key)!;
  if (env.parent) return environmentGet(env.parent, key);
  return null;
};

export const environmentSet = (
  env: Environment,
  key: EvalValue,
  value: EvalValue
): boolean => {
  if (env.entries.has(key)) {
    if (value === null) env.entries.delete(key);
    else env.entries.set(key, value);
    return true;
  }
  if (env.parent) return environmentSet(env.parent, key, value);
  else return false;
};

export const environmentHas = (env: Environment, key: EvalValue): boolean => {
  if (env.entries.has(key)) return true;
  if (env.parent) return environmentHas(env.parent, key);
  return false;
};

export const environmentAdd = (
  env: Environment,
  key: EvalValue,
  value: EvalValue = null
) => {
  assert(!env.entries.has(key), 'expected key not to be in environment');
  env.entries.set(key, value);
};

export const environmentKeys = (env: Environment): EvalValue[] => {
  const keys: EvalValue[] = [...env.entries.keys()];
  if (env.parent) keys.push(...environmentKeys(env.parent));
  return [...new Set(keys)];
};

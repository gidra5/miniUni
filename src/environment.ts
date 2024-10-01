import { assert, inspect } from './utils.js';
import {
  createRecord,
  EvalRecord,
  EvalValue,
  isRecord,
  recordOmit,
} from './values.js';

export type EnvironmentOptions = {
  parent?: Environment | null;
  readonly?: Record<PropertyKey, EvalValue> | EvalRecord;
  mutable?: Record<PropertyKey, EvalValue> | EvalRecord;
  handlers?: Record<PropertyKey, EvalValue> | EvalRecord;
};

export class Environment {
  parent: Environment | null;
  readonly: Map<EvalValue, EvalValue>;
  mutable: Map<EvalValue, EvalValue>;
  handlers: Handlers;

  constructor({
    parent = null,
    readonly = new Map(),
    mutable = new Map(),
    handlers = new Map(),
  }: EnvironmentOptions = {}) {
    this.parent = parent;
    this.readonly = isRecord(readonly) ? readonly : createRecord(readonly);
    this.mutable = isRecord(mutable) ? mutable : createRecord(mutable);
    this.handlers = newHandlers(handlers, parent?.handlers);
  }

  get(key: EvalValue): EvalValue {
    if (this.readonly.has(key)) return this.readonly.get(key)!;
    if (this.mutable.has(key)) return this.mutable.get(key)!;
    if (this.parent) return this.parent.get(key);
    return null;
  }

  set(key: EvalValue, value: EvalValue): boolean {
    if (this.mutable.has(key)) {
      if (value === null) this.mutable.delete(key);
      else this.mutable.set(key, value);
      return true;
    }
    if (this.readonly.has(key)) return false;
    else if (!this.parent) return false;
    else return this.parent.set(key, value);
  }

  has(key: EvalValue): boolean {
    if (this.mutable.has(key)) return true;
    if (this.readonly.has(key)) return true;
    if (!this.parent) return false;
    return this.parent.has(key);
  }

  hasReadonly(key: EvalValue): boolean {
    if (this.readonly.has(key)) return true;
    if (this.mutable.has(key)) return false;
    if (!this.parent) return false;
    return this.parent.hasReadonly(key);
  }

  add(key: EvalValue, value: EvalValue = null): void {
    assert(!this.mutable.has(key), 'expected key not to be in environment');
    assert(!this.readonly.has(key), 'expected key not to be in environment');
    this.mutable.set(key, value);
  }

  addReadonly(key: EvalValue, value: EvalValue = null): void {
    assert(!this.readonly.has(key), 'expected key not to be in environment');
    assert(!this.mutable.has(key), 'expected key not to be in environment');
    this.readonly.set(key, value);
  }

  keys(): EvalValue[] {
    const keys: EvalValue[] = [...this.readonly.keys(), ...this.mutable.keys()];
    if (this.parent) keys.push(...this.parent.keys());
    return [...new Set(keys)];
  }

  maskHandlers(keys: EvalValue[]): Environment {
    const env = this.handlers;
    const resolveKey = (key: EvalValue, _env = env) => {
      if (_env.own(key)) return _env;
      if (_env[envParent]) return resolveKey(key, _env[envParent]);
      return null;
    };
    const handlers = {
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

    const _env = new Environment({
      parent: this,
    });
    _env.handlers = handlers;
    return _env;
  }

  withoutHandlers(keys: EvalValue[]): Environment {
    const env = this.handlers;
    const handlers: Handlers = {
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
    const _env = new Environment({
      parent: this,
    });
    _env.handlers = handlers;
    return _env;
  }
}

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

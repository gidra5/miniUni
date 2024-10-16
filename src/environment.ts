import { assert } from './utils.js';
import { atom, EvalValue } from './values.js';

export type SymbolMap = Map<symbol, EvalValue>;
type SymbolMapOptions = Record<PropertyKey, EvalValue> | SymbolMap;
export type EnvironmentOptions = {
  parent?: Environment | null;
  readonly?: SymbolMapOptions;
  mutable?: SymbolMapOptions;
};

export const createSymbolMap = (values: SymbolMapOptions) => {
  if (values instanceof Map) return values;

  const keys = [
    ...Object.getOwnPropertyNames(values),
    ...Object.getOwnPropertySymbols(values),
  ];
  const entries: [symbol, EvalValue][] = keys.map((k) => [
    typeof k === 'string' ? atom(k) : k,
    values[k],
  ]);
  return new Map(entries);
};

export class Environment {
  parent: Environment | null;
  readonly: SymbolMap;
  mutable: SymbolMap;

  constructor({
    parent = null,
    readonly = new Map(),
    mutable = new Map(),
  }: EnvironmentOptions = {}) {
    this.parent = parent;
    this.readonly = createSymbolMap(readonly);
    this.mutable = createSymbolMap(mutable);
  }

  get(key: symbol): EvalValue {
    if (this.readonly.has(key)) return this.readonly.get(key)!;
    if (this.mutable.has(key)) return this.mutable.get(key)!;
    if (this.parent) return this.parent.get(key);
    return null;
  }

  set(key: symbol, value: EvalValue): boolean {
    if (this.mutable.has(key)) {
      if (value === null) this.mutable.delete(key);
      else this.mutable.set(key, value);
      return true;
    }
    if (this.readonly.has(key)) return false;
    else if (!this.parent) return false;
    else return this.parent.set(key, value);
  }

  has(key: symbol): boolean {
    if (this.mutable.has(key)) return true;
    if (this.readonly.has(key)) return true;
    if (!this.parent) return false;
    return this.parent.has(key);
  }

  hasReadonly(key: symbol): boolean {
    if (this.readonly.has(key)) return true;
    if (this.mutable.has(key)) return false;
    if (!this.parent) return false;
    return this.parent.hasReadonly(key);
  }

  add(key: symbol, value: EvalValue = null): void {
    assert(!this.mutable.has(key), 'expected key not to be in environment');
    assert(!this.readonly.has(key), 'expected key not to be in environment');
    this.mutable.set(key, value);
  }

  addReadonly(key: symbol, value: EvalValue = null): void {
    assert(!this.readonly.has(key), 'expected key not to be in environment');
    assert(!this.mutable.has(key), 'expected key not to be in environment');
    this.readonly.set(key, value);
  }

  keys(): symbol[] {
    const keys: symbol[] = [...this.readonly.keys(), ...this.mutable.keys()];
    if (this.parent) keys.push(...this.parent.keys());
    return [...new Set(keys)];
  }

  shallowCopy(): Environment {
    const copy = new Environment({ parent: this.parent });
    copy.readonly = new Map(this.readonly);
    copy.mutable = new Map(this.mutable);
    return copy;
  }

  shallowReplace(withEnv: Environment): Environment {
    const copy = new Environment({ parent: this.parent });
    copy.readonly = new Map(withEnv.readonly);
    copy.mutable = new Map(withEnv.mutable);
    return copy;
  }

  copyUpTo(env: Environment): Environment {
    if (this === env) return this;
    assert(this.parent);
    const parentCopy = this.parent.copyUpTo(env);
    const copy = new Environment({ parent: parentCopy });
    copy.readonly = new Map(this.readonly);
    copy.mutable = new Map(this.mutable);
    return copy;
  }

  replace(withEnv: Environment, upToEnv: Environment): Environment {
    if (this === upToEnv) return this;
    assert(this.parent);
    assert(withEnv.parent);
    this.readonly = new Map(withEnv.readonly);
    this.mutable = new Map(withEnv.mutable);
    this.parent.replace(withEnv.parent, upToEnv);
    return this;
  }
}

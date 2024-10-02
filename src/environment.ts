import { assert, inspect } from './utils.js';
import { createRecord, EvalRecord, EvalValue, isRecord } from './values.js';

export type EnvironmentOptions = {
  parent?: Environment | null;
  readonly?: Record<PropertyKey, EvalValue> | EvalRecord;
  mutable?: Record<PropertyKey, EvalValue> | EvalRecord;
};

export class Environment {
  parent: Environment | null;
  readonly: Map<EvalValue, EvalValue>;
  mutable: Map<EvalValue, EvalValue>;

  constructor({
    parent = null,
    readonly = new Map(),
    mutable = new Map(),
  }: EnvironmentOptions = {}) {
    this.parent = parent;
    this.readonly = isRecord(readonly) ? readonly : createRecord(readonly);
    this.mutable = isRecord(mutable) ? mutable : createRecord(mutable);
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

  shallowCopy(): Environment {
    const copy = new Environment({ parent: this.parent });
    copy.readonly = new Map(this.readonly);
    copy.mutable = new Map(this.mutable);
    return copy;
  }

  copy(): Environment {
    const parent = this.parent ? this.parent.copy() : null;
    const copy = new Environment({ parent });
    copy.readonly = new Map(this.readonly);
    copy.mutable = new Map(this.mutable);
    return copy;
  }
}

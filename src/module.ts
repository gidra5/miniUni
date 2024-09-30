import { createRecord, EvalRecord, EvalValue, recordGet } from './values.js';

export type Module =
  | { module: EvalRecord; default?: EvalValue }
  | { script: EvalValue }
  | { buffer: Buffer };

export const ModuleDefault = Symbol('module default');

export const module = (
  module: EvalRecord | Record<string, EvalValue>
): Module => {
  module = module instanceof Map ? module : createRecord(module);
  return { module, default: recordGet(module, ModuleDefault) };
};
export const script = (value: EvalValue): Module => ({ script: value });
export const buffer = (value: Buffer): Module => ({ buffer: value });

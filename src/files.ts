import { FileMap } from 'codespan-napi';
import { receive } from './evaluate.js';
import { SystemError } from './error.js';
import { assert } from './utils.js';
import { EvalValue, fn } from './values.js';

export const fileMap = new FileMap();

export const addFile = (fileName: string, source: string) => {
  fileMap.addFile(fileName, source);
  return fileMap.getFileId(fileName);
};

export const Prelude = Symbol('Prelude');

export const modules = {
  [Prelude]: {
    channel: fn(1, () => {
      const channel = Symbol();
      return { channel };
    }),
    length: fn(1, (list) => {
      assert(Array.isArray(list), SystemError.invalidLengthTarget());
      return list.length;
    }),
    number: fn(1, (n) => {
      return Number(n);
    }),
    print: fn(1, (value) => {
      console.log(value);
      return value;
    }),
    return: fn(1, (value) => {
      throw { return: value };
    }),
  },
  'std/math': {
    floor: fn(1, (n) => {
      assert(typeof n === 'number', SystemError.invalidFloorTarget());
      return Math.floor(n);
    }),
  },
  'std/string': {
    split: fn(2, (string, separator) => {
      assert(typeof string === 'string', SystemError.invalidSplitTarget());
      assert(
        typeof separator === 'string',
        SystemError.invalidSplitSeparator()
      );
      return string.split(separator);
    }),
    replace: fn(3, (pattern, replacement, string) => {
      assert(typeof pattern === 'string', SystemError.invalidReplacePattern());
      assert(
        typeof replacement === 'string',
        SystemError.invalidReplaceReplacement()
      );
      assert(typeof string === 'string', SystemError.invalidReplaceTarget());
      return string.replace(new RegExp(pattern, 'g'), replacement);
    }),
    match: fn(2, (pattern, string) => {
      // assert(typeof pattern === 'string', SystemError.invalidMatchPattern());
      // assert(typeof string === 'string', SystemError.invalidMatchTarget());
      return new RegExp(pattern).test(string);
    }),
    char_at: fn(2, (string, index) => {
      // assert(typeof index === 'number', SystemError.invalidCharAtIndex());
      // assert(typeof string === 'string', SystemError.invalidCharAtTarget());
      return string.charAt(index);
    }),
    slice: fn(1, (args) => {
      assert(Array.isArray(args), 'expected tuple');
      const [item, start, end] = args;
      assert(
        typeof item === 'string' || Array.isArray(item),
        'expected string or array'
      );
      // assert(typeof string === 'string', SystemError.invalidSliceTarget());
      // assert(typeof start === 'number', SystemError.invalidSliceStart());
      return item.slice(start, end);
    }),
  },
  'std/concurrency': {
    all: fn(1, async (list) => {
      assert(Array.isArray(list), 'invalid all target');
      const x = list.map(receive);
      const y = await Promise.all(x);

      return y;
    }),
  },
};

export const getModule = (name: string | symbol) => {
  if (name in modules) return modules[name];
  throw SystemError.moduleNotFound(name);
};

export const addModule = (
  name: string | symbol,
  module: Record<string, EvalValue>
) => {
  modules[name] = module;
};

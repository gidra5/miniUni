import { SystemError } from '../error.js';
import { fn, fnPromise, recordGet } from '../values.js';
import { assert } from '../utils.js';
import { module } from '../module.js';
import { environmentGet } from '../environment.js';
import { prelude } from './prelude.js';

const stringModule = module({
  split: fn(2, ([position, context], target, separator) => {
    const fileId = context.fileId;
    const splitErrorFactory = SystemError.invalidArgumentType(
      'split',
      {
        args: [
          ['target', 'string'],
          ['separator', 'string'],
        ],
        returns: 'string[]',
      },
      position
    );

    assert(typeof target === 'string', splitErrorFactory(0).withFileId(fileId));
    assert(
      typeof separator === 'string',
      splitErrorFactory(1).withFileId(fileId)
    );
    return target.split(separator);
  }),
  replace: fn(3, ([position, context], pattern, replacement, target) => {
    const fileId = context.fileId;
    const replaceErrorFactory = SystemError.invalidArgumentType(
      'replace',
      {
        args: [
          ['pattern', 'regex'],
          ['replacement', 'string'],
          ['target', 'string'],
        ],
        returns: 'string',
      },
      position
    );
    assert(
      typeof pattern === 'string',
      replaceErrorFactory(0).withFileId(fileId)
    );
    assert(
      typeof replacement === 'string',
      replaceErrorFactory(1).withFileId(fileId)
    );
    assert(
      typeof target === 'string',
      replaceErrorFactory(2).withFileId(fileId)
    );
    return target.replace(new RegExp(pattern, 'g'), replacement);
  }),
  match: fn(2, ([position, context], pattern, target) => {
    const fileId = context.fileId;
    const matchErrorFactory = SystemError.invalidArgumentType(
      'match',
      {
        args: [
          ['pattern', 'regex'],
          ['target', 'string'],
        ],
        returns: 'string',
      },
      position
    );
    assert(
      typeof pattern === 'string',
      matchErrorFactory(0).withFileId(fileId)
    );
    assert(typeof target === 'string', matchErrorFactory(1).withFileId(fileId));
    return new RegExp(pattern).test(target);
  }),
  char_at: fn(2, ([position, context], target, index) => {
    const fileId = context.fileId;
    const charAtErrorFactory = SystemError.invalidArgumentType(
      'char_at',
      {
        args: [
          ['target', 'string'],
          ['index', 'integer'],
        ],
        returns: 'string',
      },
      position
    );
    assert(
      typeof target === 'string',
      charAtErrorFactory(0).withFileId(fileId)
    );
    assert(typeof index === 'number', charAtErrorFactory(1).withFileId(fileId));
    return target.charAt(index);
  }),
  slice: fn(2, ([position, context], item, args) => {
    const fileId = context.fileId;
    const sliceErrorFactory = SystemError.invalidArgumentType(
      'slice',
      {
        args: [
          ['item', 'string | list a'],
          ['start', 'number?'],
          ['end', 'number?'],
        ],
        returns: 'string | list a',
      },
      position
    );
    assert(
      Array.isArray(args),
      SystemError.evaluationError(
        'slice expects tuple of arguments as argument',
        [],
        position
      ).withFileId(fileId)
    );
    const [start, end] = args;

    assert(
      typeof item === 'string' || Array.isArray(item),
      sliceErrorFactory(0).withFileId(fileId)
    );
    if (start !== undefined) {
      assert(
        typeof start === 'number',
        sliceErrorFactory(1).withFileId(fileId)
      );
    }
    if (end !== undefined) {
      assert(typeof end === 'number', sliceErrorFactory(2).withFileId(fileId));
    }

    return item.slice(start, end);
  }),
});

export const stringMethods = (() => {
  const { module } = stringModule as Extract<
    typeof stringModule,
    { module: any }
  >;
  return {
    length: environmentGet(prelude, 'length'),
    split: recordGet(module, 'split'),
    char_at: recordGet(module, 'char_at'),
    slice: recordGet(module, 'slice'),
    replace: fn(3, async (callSite, target, pattern, replacement) => {
      const method = recordGet(module, 'replace');
      assert(typeof method === 'function', 'expected method');
      const x1 = await fnPromise(method)(callSite, pattern);
      assert(typeof x1 === 'function', 'expected method');
      const x2 = await fnPromise(x1)(callSite, replacement);
      assert(typeof x2 === 'function', 'expected method');
      return await fnPromise(x2)(callSite, target);
    }),
    match: fn(2, async (callSite, target, pattern) => {
      const method = recordGet(module, 'match');
      assert(typeof method === 'function', 'expected method');
      const x1 = await fnPromise(method)(callSite, pattern);
      assert(typeof x1 === 'function', 'expected method');
      return await fnPromise(x1)(callSite, target);
    }),
  };
})();

export default stringModule;

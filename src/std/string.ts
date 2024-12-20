import { SystemError } from '../error.js';
import { atom, createRecord, EvalFunction, EvalRecord, fn } from '../values.js';
import { assert, inspect } from '../utils.js';
import { module } from '../module.js';

const stringModule = module({});

export const stringPrototype: EvalRecord = createRecord({
  [atom('length')]: async (_, target) => {
    assert(typeof target === 'string');
    return target.length;
  },
  [atom('split')]: fn(2, ([position, _, context], target, separator) => {
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
  [atom('char_at')]: fn(2, ([position, _, context], target, index) => {
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
  [atom('slice')]: fn(2, ([position, _, context], item, args) => {
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
  [atom('replace')]: fn(
    3,
    async ([position, _, context], target, pattern, replacement) => {
      const fileId = context.fileId;
      const replaceErrorFactory = SystemError.invalidArgumentType(
        'replace',
        {
          args: [
            ['target', 'string'],
            ['pattern', 'regex'],
            ['replacement', 'string'],
          ],
          returns: 'string',
        },
        position
      );
      assert(
        typeof target === 'string',
        replaceErrorFactory(0).withFileId(fileId)
      );
      assert(
        typeof pattern === 'string',
        replaceErrorFactory(1).withFileId(fileId)
      );
      assert(
        typeof replacement === 'string',
        replaceErrorFactory(2).withFileId(fileId)
      );
      return target.replace(new RegExp(pattern, 'g'), replacement);
    }
  ),
  [atom('match')]: fn(2, async ([position, _, context], target, pattern) => {
    const fileId = context.fileId;
    const matchErrorFactory = SystemError.invalidArgumentType(
      'match',
      {
        args: [
          ['target', 'string'],
          ['pattern', 'regex'],
        ],
        returns: 'string',
      },
      position
    );
    assert(typeof target === 'string', matchErrorFactory(0).withFileId(fileId));
    assert(
      typeof pattern === 'string',
      matchErrorFactory(1).withFileId(fileId)
    );
    return new RegExp(pattern).test(target);
  }),
} satisfies Record<symbol, EvalFunction>);

export default stringModule;

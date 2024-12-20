import { SystemError } from '../error.js';
import { assert } from '../utils.js';
import { module } from '../module.js';
import { atom, createRecord, EvalFunction, EvalValue, fn } from '../values.js';

const listModule = module({});

export const listPrototype = createRecord({
  [atom('length')]: async (_, target) => {
    assert(Array.isArray(target));
    return target.length;
  },
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
  [atom('map')]: fn(2, async (cs, list, fn) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const mapErrorFactory = SystemError.invalidArgumentType(
      'map',
      {
        args: [
          ['list', 'list a'],
          ['fn', 'a -> b'],
        ],
        returns: 'list b',
      },
      pos
    );
    assert(Array.isArray(list), mapErrorFactory(0).withFileId(fileId));
    assert(typeof fn === 'function', mapErrorFactory(1).withFileId(fileId));
    const mapped: EvalValue[] = [];
    for (const item of list) {
      const x = await fn(cs, item);

      mapped.push(x);
    }
    return mapped;
  }),
  [atom('filter')]: fn(2, async (cs, list, fn) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const filterErrorFactory = SystemError.invalidArgumentType(
      'filter',
      {
        args: [
          ['list', 'list a'],
          ['fn', 'a -> boolean'],
        ],
        returns: 'list a',
      },
      pos
    );
    assert(Array.isArray(list), filterErrorFactory(0).withFileId(fileId));
    assert(typeof fn === 'function', filterErrorFactory(1).withFileId(fileId));
    const filtered: EvalValue[] = [];
    for (const item of list) {
      const x = await fn(cs, item);
      if (x) filtered.push(item);
    }
    return filtered;
  }),
  [atom('pick_random')]: fn(2, async (cs, list) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const filterErrorFactory = SystemError.invalidArgumentType(
      'filter',
      {
        args: [['list', 'list a']],
        returns: 'a',
      },
      pos
    );
    assert(Array.isArray(list), filterErrorFactory(0).withFileId(fileId));
    return list[Math.floor(Math.random() * list.length)];
  }),
  [atom('find')]: fn(2, async (cs, list, fn) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const filterErrorFactory = SystemError.invalidArgumentType(
      'filter',
      {
        args: [
          ['list', 'list a'],
          ['fn', 'a -> boolean'],
        ],
        returns: 'a',
      },
      pos
    );
    assert(Array.isArray(list), filterErrorFactory(0).withFileId(fileId));
    assert(typeof fn === 'function', filterErrorFactory(1).withFileId(fileId));
    for (const item of list) {
      const x = await fn(cs, item);
      if (x) return item;
    }
    return null;
  }),
  [atom('push')]: fn(2, async (cs, list, item) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const filterErrorFactory = SystemError.invalidArgumentType(
      'filter',
      {
        args: [
          ['list', 'list a'],
          ['item', 'a'],
        ],
        returns: 'list a',
      },
      pos
    );
    assert(Array.isArray(list), filterErrorFactory(0).withFileId(fileId));
    assert(
      typeof item !== 'undefined',
      filterErrorFactory(1).withFileId(fileId)
    );
    list.push(item);
    return list;
  }),
} satisfies Record<symbol, EvalFunction>);

export default listModule;

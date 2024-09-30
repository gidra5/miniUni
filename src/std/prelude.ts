import { newEnvironment, newHandlers } from '../environment.js';
import { SystemError } from '../error.js';
import { Context } from '../evaluate/index.js';
import { assert, inspect } from '../utils.js';
import {
  atom,
  cancelTask,
  closeChannel,
  createChannel,
  createEffect,
  createHandler,
  createRecord,
  createSet,
  fn,
  fnPromise,
  isChannel,
  isTask,
} from '../values.js';

export const ReturnHandler = Symbol('return_handler');
export const prelude: Context['env'] = newEnvironment({
  return_handler: ReturnHandler,
  handle: fn(2, (callSite, effect, value) => {
    return createEffect(effect, value);
  }),
  handler: async (_, handler) => {
    assert(typeof handler === 'function', 'expected function');
    return createHandler(handler);
  },
  cancel: async ([position, context], value) => {
    const fileId = context.fileId;
    const cancelErrorFactory = SystemError.invalidArgumentType(
      'cancel',
      { args: [['target', 'task _']], returns: 'void' },
      position
    );
    assert(isTask(value), cancelErrorFactory(0).withFileId(fileId));
    return cancelTask(value);
  },
  channel: fn(1, (_, name) => {
    if (typeof name === 'string') return createChannel(name);
    else return createChannel();
  }),
  close: fn(1, ([position, context], value) => {
    const fileId = context.fileId;
    const closeErrorFactory = SystemError.invalidArgumentType(
      'cancel',
      { args: [['target', 'channel _']], returns: 'void' },
      position
    );
    assert(value !== null, closeErrorFactory(0).withFileId(fileId));
    assert(isChannel(value), closeErrorFactory(0).withFileId(fileId));
    closeChannel(value);
    return null;
  }),
  symbol: fn(1, (_, name) => {
    if (typeof name === 'string') return Symbol(name);
    else return Symbol();
  }),
  length: fn(1, ([position, context], list) => {
    const fileId = context.fileId;
    const lengthErrorFactory = SystemError.invalidArgumentType(
      'length',
      { args: [['list', 'list _ | string']], returns: 'number' },
      position
    );
    assert(
      Array.isArray(list) || typeof list === 'string',
      lengthErrorFactory(0).withFileId(fileId)
    );
    return list.length;
  }),
  number: fn(1, (_, n) => {
    return Number(n);
  }),
  string: fn(1, (_, n) => {
    return String(n);
  }),
  print: fn(1, (_, value) => {
    inspect(value);
    return value;
  }),
  return: fn(1, (_, value) => {
    return createEffect(atom('return'), value);
  }),
  break: fn(1, (_, value) => {
    return createEffect(atom('break'), value);
  }),
  continue: fn(1, (_, value) => {
    return createEffect(atom('continue'), value);
  }),
  set: fn(1, (_, value) => {
    if (!Array.isArray(value)) value = [value];
    return createSet(value);
  }),
});

export const PreludeIO = Symbol('prelude io');
export const preludeHandlers: Context['handlers'] = newHandlers({
  [PreludeIO]: createRecord({
    open: fn(2, async (cs, _path, callback) => {
      assert(typeof _path === 'string');
      const file = createRecord({
        write: fn(1, () => null),
        close: async () => null,
      });

      assert(typeof callback === 'function');
      return await fnPromise(callback)(cs, file);
    }),
  }),
  [ReturnHandler]: async (_, value) => value,
});

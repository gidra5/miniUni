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
  fnCont,
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
  handler: fnCont(async (_, handler) => {
    assert(typeof handler === 'function', 'expected function');
    return createHandler(handler);
  }),
  cancel: fnCont(async ([position, context], value) => {
    const fileId = context.fileId;
    const cancelErrorFactory = SystemError.invalidArgumentType(
      'cancel',
      { args: [['target', 'task _']], returns: 'void' },
      position
    );
    assert(isTask(value), cancelErrorFactory(0).withFileId(fileId));
    return cancelTask(value);
  }),
  channel: fnCont((_, name) => {
    if (typeof name === 'string') return createChannel(name);
    else return createChannel();
  }),
  close: fnCont(([position, context], value) => {
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
  symbol: fnCont((_, name) => {
    if (typeof name === 'string') return Symbol(name);
    else return Symbol();
  }),
  length: fnCont(([position, context], list) => {
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
  number: fnCont((_, n) => {
    return Number(n);
  }),
  string: fnCont((_, n) => {
    return String(n);
  }),
  print: fnCont((_, value) => {
    inspect(value);
    return value;
  }),
  return: fnCont((_, value) => {
    return createEffect(atom('return'), value);
  }),
  break: fnCont((_, value) => {
    return createEffect(atom('break'), value);
  }),
  continue: fnCont((_, value) => {
    return createEffect(atom('continue'), value);
  }),
  set: fnCont((_, value) => {
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

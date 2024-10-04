import { Environment } from '../environment.js';
import { SystemError } from '../error.js';
import { Context } from '../evaluate/index.js';
import { showNode } from '../parser.js';
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
  createTask,
  fn,
  fnCont,
  fnPromise,
  isChannel,
  isTask,
} from '../values.js';
import { CreateTaskEffect } from './concurrency.js';

export const ReturnHandler = Symbol('return_handler');
export const PreludeIO = Symbol('prelude io');
export const prelude: Context['env'] = new Environment({
  readonly: {
    return_handler: ReturnHandler,
    handle: fn(2, (cs, effect, value) => {
      return createEffect(effect, value, cs[1].env);
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
    return: fnCont((cs, value) => {
      return createEffect(atom('return'), value, cs[1].env);
    }),
    break: fnCont((cs, value) => {
      return createEffect(atom('break'), value, cs[1].env);
    }),
    continue: fnCont((cs, value) => {
      return createEffect(atom('continue'), value, cs[1].env);
    }),
    set: fnCont((_, value) => {
      if (!Array.isArray(value)) value = [value];
      return createSet(value);
    }),
  },
});

export const preludeHandlers = createRecord({
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
  [CreateTaskEffect]: createHandler(
    fnCont(async (cs, args) => {
      assert(Array.isArray(args), 'expected array');
      const [callback, taskFn] = args;
      assert(typeof taskFn === 'function', 'expected function');
      const task = createTask(async () => await fnPromise(taskFn)(cs, null));
      assert(typeof callback === 'function', 'expected function');
      return await fnPromise(callback)(cs, task);
    })
  ),
});

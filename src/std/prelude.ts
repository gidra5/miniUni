import { Environment, Scope } from '../environment.js';
import { SystemError } from '../error.js';
import { EvalContext, handleEffects } from '../evaluate/index.js';
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
  isChannel,
  isTask,
  EvalFunction,
  createEvent,
  isEvent,
  onceEvent,
  emitEvent,
  subscribeEvent,
} from '../values.js';
import { CreateTaskEffect } from './concurrency.js';

export const ReturnHandler = Symbol('return_handler');
export const IOEffect = Symbol('prelude io');
export const ThrowEffect = Symbol('throw');
export const prelude: EvalContext['env'] = new Environment({
  readonly: {
    return_handler: ReturnHandler,
    handle: fn(2, (cs, effect, value) => {
      return createEffect(effect, value, cs[1].env);
    }),
    handler: async (_, handler) => {
      assert(typeof handler === 'function', 'expected function');
      return createHandler(handler);
    },
    cancel: async (cs, value) => {
      const [position, _, context] = cs;
      const fileId = context.fileId;
      const cancelErrorFactory = SystemError.invalidArgumentType(
        'cancel',
        { args: [['target', 'task _']], returns: 'void' },
        position
      );
      assert(isTask(value), cancelErrorFactory(0).withFileId(fileId));
      return cancelTask(cs, value);
    },
    channel: async (_, name) => {
      if (typeof name === 'string') return createChannel(name);
      else return createChannel();
    },
    event: async () => {
      return createEvent();
    },
    subscribe: fn(2, async (cs, event, fn) => {
      const [position, _, context] = cs;
      const fileId = context.fileId;
      const subscribeErrorFactory = SystemError.invalidArgumentType(
        'subscribe',
        {
          args: [
            ['event', 'event a'],
            ['listener', 'a -> void'],
          ],
          returns: '() -> void',
        },
        position
      );
      assert(isEvent(event), subscribeErrorFactory(0).withFileId(fileId));
      assert(
        typeof fn === 'function',
        subscribeErrorFactory(1).withFileId(fileId)
      );
      return subscribeEvent(event, fn);
    }),
    once: fn(2, async (cs, event, fn) => {
      const [position, _, context] = cs;
      const fileId = context.fileId;
      const onceErrorFactory = SystemError.invalidArgumentType(
        'once',
        {
          args: [
            ['event', 'event a'],
            ['listener', 'a -> void'],
          ],
          returns: '() -> void',
        },
        position
      );
      assert(isEvent(event), onceErrorFactory(0).withFileId(fileId));
      assert(typeof fn === 'function', onceErrorFactory(1).withFileId(fileId));
      return onceEvent(event, fn);
    }),
    emit: fn(2, async (cs, event, value) => {
      const [position, _, context] = cs;
      const fileId = context.fileId;
      const emitErrorFactory = SystemError.invalidArgumentType(
        'emit',
        {
          args: [
            ['event', 'event a'],
            ['value', 'a'],
          ],
          returns: 'void',
        },
        position
      );
      assert(isEvent(event), emitErrorFactory(0).withFileId(fileId));
      await emitEvent(cs, event, value);
      return null;
    }),
    close: async ([position, _, context], value) => {
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
    },
    symbol: async (_, name) => {
      if (typeof name === 'string') return Symbol(name);
      else return Symbol();
    },
    number: async (_, n) => {
      return Number(n);
    },
    string: async (_, n) => {
      return String(n);
    },
    print: async (_, value) => {
      inspect(value);
      return value;
    },
    return: async (cs, value) => {
      return createEffect(atom('return'), value, cs[1].env);
    },
    break: async (cs, value) => {
      return createEffect(atom('break'), value, cs[1].env);
    },
    continue: async (cs, value) => {
      return createEffect(atom('continue'), value, cs[1].env);
    },
    set: (async (_, value) => {
      if (!Array.isArray(value)) value = [value];
      return createSet(value);
    }) satisfies EvalFunction,
    throw: async (cs, value) => {
      return createEffect(ThrowEffect, value, cs[1].env);
    },
    try: async (cs, fn) => {
      const handlers = createRecord({
        [ThrowEffect]: createHandler(async (cs, value) => {
          assert(Array.isArray(value));
          const [_, thrown] = value;
          return [atom('error'), thrown];
        }),
        [ReturnHandler]: async (cs, value) => {
          if (value instanceof Error) return [atom('error'), value];
          return [atom('ok'), value];
        },
      });
      assert(typeof fn === 'function');
      const value = await fn(cs, null);
      return await handleEffects(handlers, value, cs[0], cs[1], cs[2]);
    },
  },
});
export const preludeScope = new Scope({
  mutable: prelude.mutable,
  readonly: prelude.readonly,
});

export const preludeHandlers = createRecord({
  [IOEffect]: createRecord({
    open: fn(2, async (cs, _path, callback) => {
      assert(typeof _path === 'string');
      const file = createRecord({
        write: fn(1, () => null),
        close: async () => null,
      });

      assert(typeof callback === 'function');
      return await callback(cs, file);
    }),
  }),
  [CreateTaskEffect]: createHandler(async (cs, args) => {
    assert(Array.isArray(args), 'expected array');
    const [callback, taskFn] = args;
    assert(typeof taskFn === 'function', 'expected function');
    const task = createTask(cs, async () => await taskFn(cs, null));
    assert(typeof callback === 'function', 'expected function');
    return await callback(cs, task);
  }),
});

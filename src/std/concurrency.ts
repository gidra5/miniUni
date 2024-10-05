import { SystemError } from '../error.js';
import {
  awaitTask,
  cancelTask,
  createHandler,
  createRecord,
  createTask,
  EvalTask,
  EvalValue,
  fn,
  isEventClosed,
  isTask,
} from '../values.js';
import { assert, inspect, memoize } from '../utils.js';
import { module } from '../module.js';
import { evaluateHandlers } from '../evaluate/index.js';
import { ThrowEffect } from './prelude.js';

export const CreateTaskEffect = Symbol('CreateTaskEffect');

export default module({
  all: async ([position, context], list) => {
    const fileId = context.fileId;
    const allErrorFactory = SystemError.invalidArgumentType(
      'all',
      {
        args: [['target', 'list (task a)']],
        returns: 'list a',
      },
      position
    );
    assert(Array.isArray(list), allErrorFactory(0).withFileId(fileId));
    const x = list.map(async (task) => {
      assert(isTask(task), allErrorFactory(0).withFileId(fileId));
      return await awaitTask(task);
    });
    return (await Promise.all(x)).filter((x) => x !== null);
  },
  some: fn(1, async ([position, context], list) => {
    const fileId = context.fileId;
    const someErrorFactory = SystemError.invalidArgumentType(
      'some',
      {
        args: [['target', 'list a']],
        returns: 'boolean',
      },
      position
    );
    assert(Array.isArray(list), someErrorFactory(0).withFileId(fileId));
    const x = list.map(async (task) => {
      assert(isTask(task), someErrorFactory(0).withFileId(fileId));
      return await awaitTask(task);
    });
    return await Promise.race(x);
  }),
  wait: fn(1, async ([position, context], time) => {
    const fileId = context.fileId;
    const waitErrorFactory = SystemError.invalidArgumentType(
      'wait',
      {
        args: [['time', 'number']],
        returns: 'void',
      },
      position
    );
    assert(typeof time === 'number', waitErrorFactory(0).withFileId(fileId));
    await new Promise((resolve) => setTimeout(resolve, time));
    return null;
  }),
  creating_task: CreateTaskEffect,
  cancel_on_error: async (cs, fn) => {
    const [position, context] = cs;
    const fileId = context.fileId;
    const cancelOnErrorErrorFactory = SystemError.invalidArgumentType(
      'cancel_on_error',
      {
        args: [['scope', '() -> a']],
        returns: 'a',
      },
      position
    );
    assert(
      typeof fn === 'function',
      cancelOnErrorErrorFactory(0).withFileId(fileId)
    );
    const childrenTasks: EvalTask[] = [];

    const handlers = createRecord({
      [CreateTaskEffect]: createHandler(async (cs, value) => {
        assert(Array.isArray(value), 'expected value to be an array');
        const [callback, taskFn] = value;
        assert(typeof taskFn === 'function', 'expected function');
        const _task = createTask(cs, async () => await taskFn(cs, null));
        childrenTasks.push(_task);

        assert(typeof callback === 'function', 'expected callback');
        const result = await callback(cs, _task);
        return result;
      }),
      [ThrowEffect]: createHandler(async (cs, value) => {
        assert(Array.isArray(value), 'expected value to be an array');
        const [_, thrown] = value;
        for (const childTask of childrenTasks) {
          if (isEventClosed(childTask[1])) continue;
          await cancelTask(cs, childTask);
        }
        return thrown;
      }),
    });
    const value = await fn(cs, null);

    return await evaluateHandlers(handlers, value, cs[0], context);
  },
  cancel_on_return: async (cs, fn) => {
    const [position, context] = cs;
    const fileId = context.fileId;
    const cancelOnReturnErrorFactory = SystemError.invalidArgumentType(
      'cancel_on_return',
      {
        args: [['scope', '() -> a']],
        returns: 'a',
      },
      position
    );
    assert(
      typeof fn === 'function',
      cancelOnReturnErrorFactory(0).withFileId(fileId)
    );
    const childrenTasks: EvalTask[] = [];

    const handlers = createRecord({
      [CreateTaskEffect]: createHandler(async (cs, value) => {
        assert(Array.isArray(value), 'expected value to be an array');
        const [callback, taskFn] = value;
        assert(typeof taskFn === 'function', 'expected function');
        const _task = createTask(cs, async () => await taskFn(cs, null));
        childrenTasks.push(_task);

        assert(typeof callback === 'function', 'expected callback');
        const result = await callback(cs, _task);
        for (const childTask of childrenTasks) {
          if (isEventClosed(childTask[1])) continue;
          await cancelTask(cs, childTask);
        }
        return result;
      }),
    });
    const value = await fn(cs, null);

    return await evaluateHandlers(handlers, value, cs[0], context);
  },
});

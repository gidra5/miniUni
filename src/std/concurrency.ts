import { SystemError } from '../error.js';
import {
  awaitTask,
  cancelTask,
  createHandler,
  createRecord,
  createTask,
  EvalTask,
  isEventClosed,
  isTask,
} from '../values.js';
import { assert, inspect, memoize } from '../utils.js';
import { module } from '../module.js';
import { compileScriptString, handleEffects } from '../evaluate/index.js';
import { prelude, ThrowEffect } from './prelude.js';
import { addFile } from '../files.js';
import { Environment } from '../environment.js';

export const CreateTaskEffect = Symbol('CreateTaskEffect');

const timeoutM = memoize(() => {
  const timeoutSourceFile = 'concurrency.timeout';
  const timeoutSource = `
    import "std/concurrency" as { some, wait }
    fn ms, f {
      fst := async { v := f(); (:ok, v) }
      snd := async { wait ms; (:error, :timeout) }
      some(fst, snd)
    }
  `;
  const fileId = addFile(timeoutSourceFile, timeoutSource);
  const compileContext = {
    file: timeoutSourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const timeout = compileScriptString(timeoutSource, compileContext)(context);
  return timeout;
});
const cellM = memoize(() => {
  const cellSourceFile = 'concurrency.cell';
  const cellSource = `
    fn value {
      cell := channel "cell"
      cell <- value
      (
        get: fn body {
          value := <- cell
          body value
          cell <- value
        },
        update: fn action {
          value := <- cell
          cell <- action value
        }
      )
    }
  `;
  const fileId = addFile(cellSourceFile, cellSource);
  const compileContext = {
    file: cellSourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const timeout = compileScriptString(cellSource, compileContext)(context);
  return timeout;
});

export default module({
  all: async ([position, _, context], list) => {
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
  some: async ([position, _, context], list) => {
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
  },
  wait: async ([position, _, context], time) => {
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
  },
  creating_task: CreateTaskEffect,
  cancel_on_error: async (cs, fn) => {
    const [position, _, context] = cs;
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

    return await handleEffects(handlers, value, cs[0], cs[1], cs[2]);
  },
  cancel_on_return: async (cs, fn) => {
    const [position, _, context] = cs;
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

    return await handleEffects(handlers, value, cs[0], cs[1], cs[2]);
  },
  timeout: async (cs, ms) => {
    assert(typeof ms === 'number', 'expected number');
    const _f = await timeoutM();
    assert(typeof _f === 'function');
    return _f(cs, ms);
  },
  cell: async (cs, v) => {
    const _f = await cellM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
});

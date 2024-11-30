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
      async cell <- value
      (
        get: fn {
          value := <- cell
          async cell <- value
          value
        },
        read: fn body {
          value := <- cell
          body value
          async cell <- value
        },
        update: fn action {
          value := <- cell
          async cell <- action value
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
const eventM = memoize(() => {
  const sourceFile = 'concurrency.event';
  const source = `
    fn name {
      events := channel name
      mut subscribed := ()

      async event::loop {
        value := {
          value, status := <-? events
          if status == :closed do event.break ()
          if status == :empty do <- events
          else value
        }
        for listener in subscribed do listener value
      }

      subscribe := fn listener {
        subscribed = (...subscribed, listener)

        fn { subscribed = subscribed.filter(sub -> sub != listener) }
      }

      (
        subscribe: subscribe,
        once: fn listener {
          unsub := subscribe fn value {
            listener value
            unsub()
          }
        },
        emit: fn value do async { events <- value },
        close: fn do close events,
        status: fn { _, status := <-? events; status },
      )
    }
  `;
  const fileId = addFile(sourceFile, source);
  const compileContext = {
    file: sourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const fn = compileScriptString(source, compileContext)(context);
  return fn;
});
const taskM = memoize(() => {
  const sourceFile = 'concurrency.task';
  const source = `
    event := fn name {
      events := channel name
      mut subscribed := ()

      async event::loop {
        value := {
          value, status := <-? events
          if status == :closed do event.break ()
          if status == :empty do <- events
          else value
        }
        for listener in subscribed do listener value
      }

      subscribe := fn listener {
        subscribed = (...subscribed, listener)

        fn { subscribed = subscribed.filter(sub -> sub != listener) }
      }

      (
        subscribe: subscribe,
        once: fn listener {
          unsub := subscribe fn value {
            listener value
            unsub()
          }
        },
        emit: fn value { events <- value },
        close: fn do close events
      )
    }

    fn f {
      cancelEvent := event "cancel"
      cancel := cancelEvent.emit
      cell := channel "cell"

      cancelEvent.once fn {
        close cell
        cancelEvent.close()
      }

      async {
        switch try { f() } {
          :ok, v -> cell <- v,
          :error, _ -> cancel()
        }
      }

      (
        status: fn {
          _, status := <-? cell
          status
        },
        await: fn {
          v, status := <-? cell
          if status == :closed do throw "task cancelled" 
          cell <- v
          v
        },
        cancel: cancel,
        onCancel: cancelEvent.subscribe
      )
    }
  `;
  const fileId = addFile(sourceFile, source);
  const compileContext = {
    file: sourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const fn = compileScriptString(source, compileContext)(context);
  return fn;
});
const signalM = memoize(() => {
  const sourceFile = 'concurrency.signal';
  const source = `
    fn name {
      events := channel name
      mut subscribed := ()

      async event::loop {
        value := {
          value, status := <-? events
          if status == :closed do event.break ()
          if status == :empty do <- events
          else value
        }
        for listener in subscribed do listener value
      }

      subscribe := fn listener {
        subscribed = (...subscribed, listener)

        fn { subscribed = subscribed.filter(sub -> sub != listener) }
      }

      (
        subscribe: subscribe,
        once: fn listener {
          unsub := subscribe fn value {
            listener value
            unsub()
          }
        },
        emit: fn value do async { events <- value },
        close: fn do close events,
        status: fn { _, status := <-? events; status },
      )
    }

    fn v {
      signal_cell := cell v
      signal_event := event "signal"

      (
        get: fn {
          handle (:signal_get) () signal_event.subscribe
          signal_cell.get
        },
        set: fn value {
          signal_cell.update fn do value
          signal_event.emit value
        },
      )
    }
  `;
  const fileId = addFile(sourceFile, source);
  const compileContext = {
    file: sourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const fn = compileScriptString(source, compileContext)(context);
  return fn;
});
const signalDerivedM = memoize(() => {
  const sourceFile = 'concurrency.signal.derived';
  const source = `
    fn f {
      handler := fn subscribe {
        subscribe ->
        handle signal_get: fn {} ->
        next := f()
        if s.get() != next do s.set next
      }
      
      s := signal handle signal_get: handler { f() }
    }
  `;
  const fileId = addFile(sourceFile, source);
  const compileContext = {
    file: sourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const fn = compileScriptString(source, compileContext)(context);
  return fn;
});
const coroutineM = memoize(() => {
  const sourceFile = 'concurrency.coroutine';
  const source = `
    fn f {
      coroutine_channel := channel "coroutine"
      next := fn value { 
        coroutine_channel <- value
        <- coroutine_channel
      }

      async handle coroutine_yield: next {
        f()
      }

      (
        next: next,
        close: fn do close stream
      )
    }
  `;
  const fileId = addFile(sourceFile, source);
  const compileContext = {
    file: sourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const fn = compileScriptString(source, compileContext)(context);
  return fn;
});
const genM = memoize(() => {
  const sourceFile = 'concurrency.gen';
  const source = `
    fn gen {
      coroutine := coroutine gen

      (
        next: fn do coroutine.next(),
        close: coroutine.close
      )
    }
  `;
  const fileId = addFile(sourceFile, source);
  const compileContext = {
    file: sourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const fn = compileScriptString(source, compileContext)(context);
  return fn;
});
const pipeM = memoize(() => {
  const sourceFile = 'concurrency.pipe';
  const source = `
    fn ch1, ch2 {
      async loop {
        ch2 <- (<- ch1)
      }
      ch1
    }
  `;
  const fileId = addFile(sourceFile, source);
  const compileContext = {
    file: sourceFile,
    fileId,
  };
  const context = {
    env: new Environment({ parent: prelude }),
  };
  const fn = compileScriptString(source, compileContext)(context);
  return fn;
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
  sync: async (cs, fn) => {
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
    });
    const value = await fn(cs, null);

    const handled = await handleEffects(handlers, value, cs[0], cs[1], cs[2]);

    await Promise.allSettled(childrenTasks.map((task) => awaitTask(task)));
    return handled;
  },
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
  event: async (cs, v) => {
    const _f = await eventM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
  task: async (cs, v) => {
    const _f = await taskM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
  signal: async (cs, v) => {
    const _f = await signalM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
  signal_derived: async (cs, v) => {
    const _f = await signalDerivedM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
  coroutine: async (cs, v) => {
    const _f = await coroutineM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
  gen: async (cs, v) => {
    const _f = await genM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
  pipe: async (cs, v) => {
    const _f = await pipeM();
    assert(typeof _f === 'function');
    return _f(cs, v);
  },
});

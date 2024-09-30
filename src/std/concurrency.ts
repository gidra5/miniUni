import { SystemError } from '../error.js';
import { awaitTask, fn, isTask } from '../values.js';
import { assert } from '../utils.js';
import { module } from '../module.js';

export default module({
  all: fn(1, async ([position, context], list) => {
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
  }),
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
});

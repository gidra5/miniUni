import { SystemError } from '../error.js';
import {
  createEffect,
  EvalValue,
  fileHandle,
  fn,
  fnCont,
  fnPromise,
  isRecord,
  recordGet,
} from '../values.js';
import { assert, inspect } from '../utils.js';
import { module } from '../module.js';
import { resolvePath } from '../files.js';
import { PreludeIO } from './prelude.js';

export default module({
  open: fn(2, async (cs, _path, callback) => {
    const [position, context] = cs;
    const fileId = context.fileId;
    const openErrorFactory = SystemError.invalidArgumentType(
      'all',
      {
        args: [
          ['filepath', 'string'],
          ['callback', 'fileHandle -> a'],
        ],
        returns: 'a',
      },
      position
    );
    assert(typeof _path === 'string', openErrorFactory(0).withFileId(fileId));
    assert(
      typeof callback === 'function',
      openErrorFactory(1).withFileId(fileId)
    );
    assert(
      _path.startsWith('.') || _path.startsWith('/'),
      'expected path to be absolute or relative'
    );
    const resolved = await resolvePath(_path, context.file);

    return createEffect(
      PreludeIO,
      null,
      fnCont(async (cs, ioHandler) => {
        assert(isRecord(ioHandler), 'expected io handler to be record');

        const file = await new Promise<EvalValue>(async (resolve) => {
          const open = recordGet(ioHandler, 'open');
          assert(typeof open === 'function', 'expected open to be a function');
          const curried = await fnPromise(open)(cs, resolved);

          assert(
            typeof curried === 'function',
            'expected open to take callback'
          );
          fnPromise(curried)(
            cs,
            fn(1, (_cs, file) => {
              resolve(file);
              return null;
            })
          );
        });
        assert(isRecord(file), 'expected file handle to be record');
        const close = recordGet(file, 'close');
        assert(typeof close === 'function', 'expected close to be a function');
        const result = await fnPromise(callback)(cs, fileHandle(file));
        await fnPromise(close)(cs, []);

        return result;
      })
    );
  }),
});

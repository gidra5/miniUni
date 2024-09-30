import { environmentGet } from '../environment.js';
import { SystemError } from '../error.js';
import { assert } from '../utils.js';
import { module } from '../module.js';
import { EvalValue, fn, fnPromise, recordGet } from '../values.js';
import { prelude } from './prelude.js';
import stringModule from './string.js';

const listModule = module({});

export const listMethods = (() => {
  const { module } = stringModule as Extract<
    typeof stringModule,
    { module: any }
  >;
  return {
    slice: recordGet(module, 'slice'),
    length: environmentGet(prelude, 'length'),
    map: fn(2, async (cs, list, fn) => {
      const [pos, context] = cs;
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
        const x = await fnPromise(fn)(cs, item);

        mapped.push(x);
      }
      return mapped;
    }),
    filter: fn(2, async (cs, list, fn) => {
      const [pos, context] = cs;
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
      assert(
        typeof fn === 'function',
        filterErrorFactory(1).withFileId(fileId)
      );
      const filtered: EvalValue[] = [];
      for (const item of list) {
        const x = await fnPromise(fn)(cs, item);
        if (x) filtered.push(item);
      }
      return filtered;
    }),
  };
})();

export default listModule;

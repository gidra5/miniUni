import { SystemError } from '../error.js';
import { fn } from '../values.js';
import { assert } from '../utils.js';
import { module } from '../module.js';

export default module({
  range: fn(2, ([position, context], start, end) => {
    const fileId = context.fileId;
    const rangeErrorFactory = SystemError.invalidArgumentType(
      'range',
      {
        args: [
          ['start', 'number'],
          ['end', 'number?'],
        ],
        returns: 'list number',
      },
      position
    );
    assert(typeof start === 'number', rangeErrorFactory(0).withFileId(fileId));
    assert(typeof end === 'number', rangeErrorFactory(1).withFileId(fileId));
    const list: number[] = [];
    for (let i = start; i < end; i++) {
      list.push(i);
    }
    return list;
  }),
});

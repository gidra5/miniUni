import { SystemError } from '../error.js';
import { fn } from '../values.js';
import { assert } from '../utils.js';
import { module } from '../module.js';

export default module({
  floor: fn(1, ([position, _, context], n) => {
    const fileId = context.fileId;
    const floorErrorFactory = SystemError.invalidArgumentType(
      'floor',
      { args: [['target', 'number']], returns: 'number' },
      position
    );
    assert(typeof n === 'number', floorErrorFactory(0).withFileId(fileId));
    return Math.floor(n);
  }),
  sqrt: fn(1, ([position, _, context], n) => {
    const fileId = context.fileId;
    const sqrtErrorFactory = SystemError.invalidArgumentType(
      'sqrt',
      { args: [['target', 'number']], returns: 'number' },
      position
    );
    assert(typeof n === 'number', sqrtErrorFactory(0).withFileId(fileId));
    return Math.sqrt(n);
  }),
});

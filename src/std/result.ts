import { SystemError } from '../error.js';
import { assert } from '../utils.js';
import { module } from '../module.js';
import { atom, createEffect, EvalFunction, EvalValue, fn } from '../values.js';
import { ThrowEffect } from './prelude.js';

const resultModule = module({});
export const isResult = (value: EvalValue): value is [symbol, EvalValue] =>
  Array.isArray(value) &&
  value.length === 2 &&
  (value[0] === atom('ok') || value[0] === atom('error'));

export const resultMethods: Record<symbol, EvalFunction> = {
  [atom('map_ok')]: fn(2, async (cs, result, fn) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const mapOkErrorFactory = SystemError.invalidArgumentType(
      'map_ok',
      {
        args: [
          ['result', 'result a b'],
          ['fn', 'a -> c'],
        ],
        returns: 'result c b',
      },
      pos
    );
    assert(isResult(result), mapOkErrorFactory(0).withFileId(fileId));
    assert(typeof fn === 'function', mapOkErrorFactory(1).withFileId(fileId));

    const [tag, value] = result;
    if (tag === atom('ok')) return [tag, await fn(cs, value)];
    else return result;
  }),
  [atom('map_err')]: fn(2, async (cs, result, fn) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const mapOkErrorFactory = SystemError.invalidArgumentType(
      'map_err',
      {
        args: [
          ['result', 'result a b'],
          ['fn', 'b -> c'],
        ],
        returns: 'result a c',
      },
      pos
    );
    assert(isResult(result), mapOkErrorFactory(0).withFileId(fileId));
    assert(typeof fn === 'function', mapOkErrorFactory(1).withFileId(fileId));

    const [tag, value] = result;
    if (tag === atom('error')) return [tag, await fn(cs, value)];
    else return result;
  }),
  [atom('or')]: fn(2, async (cs, result, defaultValue) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const mapOkErrorFactory = SystemError.invalidArgumentType(
      'or',
      {
        args: [
          ['result', 'result a _'],
          ['defaultValue', 'b'],
        ],
        returns: 'a | b',
      },
      pos
    );
    assert(isResult(result), mapOkErrorFactory(0).withFileId(fileId));

    const [tag, value] = result;
    if (tag === atom('error')) return defaultValue;
    else return value;
  }),
  [atom('unwrap')]: fn(1, async (cs, result) => {
    const [pos, _, context] = cs;
    const fileId = context.fileId;
    const mapOkErrorFactory = SystemError.invalidArgumentType(
      'or',
      {
        args: [
          ['result', 'result a _'],
          ['defaultValue', 'b'],
        ],
        returns: 'a | b',
      },
      pos
    );
    assert(isResult(result), mapOkErrorFactory(0).withFileId(fileId));

    const [tag, value] = result;
    if (tag === atom('error'))
      return createEffect(ThrowEffect, value, cs[1].env);
    else return value;
  }),
};

export default resultModule;

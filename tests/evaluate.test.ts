import { expect, it } from 'vitest';
import { describe } from 'node:test';
import {
  Context,
  evaluateScript,
  evaluateScriptString,
  newContext,
} from '../src/evaluate.ts';
import { assert } from '../src/utils.ts';
import { EvalValue, fn } from '../src/values.ts';
import { parseTokens } from '../src/tokens.ts';
import { parseScript } from '../src/parser.ts';

const evaluate = async (
  input: string,
  context: Context = newContext()
): Promise<EvalValue> => {
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);
  return await evaluateScript(ast, context);
};

describe('evaluate', () => {
  it('evaluate variable', async () => {
    const input = `
      // https://adventofcode.com/2023/day/1

      /* take first and last digit on line, concat into two-digit number
       * and sum all numbers in document
       */
      document := "
        1abc2
        pqr3stu8vwx
        a1b2c3d4e5f
        treb7uchet
      "
    `;
    const result = await evaluate(input);

    expect(result).toEqual(`
        1abc2
        pqr3stu8vwx
        a1b2c3d4e5f
        treb7uchet
      `);
  });

  it('evaluate split lines', async () => {
    const env: Context['env'] = {
      document: `
        1abc2
        pqr3stu8vwx
        a1b2c3d4e5f
        treb7uchet
      `,
      map: fn(2, (list, fn) => {
        assert(Array.isArray(list));
        assert(typeof fn === 'function');
        return Promise.all(list.map(fn));
      }),
      filter: fn(2, async (list, fn) => {
        assert(Array.isArray(list));
        assert(typeof fn === 'function');
        const result: EvalValue[] = [];
        for (const item of list) {
          const keep = await fn(item);
          if (keep) result.push(item);
        }
        return result;
      }),
    };
    const input = `
      import "std/string"
      
      lines := split document "\\n"
      lines = map lines (replace "\\\\s+" "")
      filter lines fn line -> line != ""
    `;
    const result = await evaluate(input, { env });

    expect(result).toEqual([
      '1abc2',
      'pqr3stu8vwx',
      'a1b2c3d4e5f',
      'treb7uchet',
    ]);
  });

  it('evaluate parse numbers', async () => {
    const env: Context['env'] = {
      lines: ['1abc2', 'pqr3stu8vwx', 'a1b2c3d4e5f', 'treb7uchet'],
      flat_map: fn(2, async (list, fn) => {
        assert(Array.isArray(list));
        assert(typeof fn === 'function');
        return (await Promise.all(list.map(fn))).flat();
      }),
    };
    const input = `
      import "std/string"

      numbers := flat_map lines fn line {
        digits := ()
      
        while line != "" {
          if match "\\\\d" (char_at line 0) {
            digit := number (char_at line 0)
            if !digits[0]: digits[0] = digit
            digits[1] = digit
          }
          line = slice(line, 1)
        }
      
        digits[0] * 10, digits[1]
      }
    `;
    const result = await evaluate(input, { env });

    expect(result).toEqual([10, 2, 30, 8, 10, 5, 70, 7]);
  });

  it('evaluate flat map list impl', async () => {
    const input = `
      flat_map := fn list, mapper {
        reduce list (fn acc, item -> (...acc, ...mapper item)) (fn first, second -> (...first, ...second)) ()
      }
    `;
    const result = await evaluate(input);

    expect(result).toMatchSnapshot();
  });

  it('evaluate parallel all', async () => {
    const input = `
      import "std/concurrency"
      
      all(1 | 2)
    `;
    const result = await evaluate(input);

    expect(result).toStrictEqual([1, 2]);
  });

  it('evaluate parallel all multiline', async () => {
    const input = `
      import "std/concurrency"
      
      all(
        | 1
        | 2
      )
    `;
    const result = await evaluate(input);

    expect(result).toStrictEqual([1, 2]);
  });

  it('evaluate reduce list', async () => {
    const input = `
      import "std/concurrency"
      import "std/math"
      import "std/string"

      reduce := fn list, reducer, merge, initial {
        len := length list
        if len == 0: return initial
      
        midpoint := floor(len / 2)
        item := list[midpoint]
        first, second := all(
          | (self (slice(list, 0, midpoint)) reducer merge initial)
          | (self (slice(list, midpoint + 1)) reducer merge initial)
        )

        merge (reducer first item) second
      }
      
      reduce (1, 2, 3, 4, 5) (fn acc, item -> acc + item) (fn first, second -> first + second) 0
    `;
    const result = await evaluate(input);

    expect(result).toBe(15);
  });

  it('evaluate filter list impl', async () => {
    const input = `
      predicate := true
      first := ()
      item := 1
      acc := ()
      if predicate: (...first, item) else acc
    `;
    const result = await evaluateScriptString(input);

    expect(result).toStrictEqual([1]);
  });
});

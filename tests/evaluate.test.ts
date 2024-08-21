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
import { addFile } from '../src/files.ts';

const evaluate = async (
  input: string,
  env?: Context['env']
): Promise<EvalValue> => {
  const name = 'test';
  const fileId = addFile(name, input);
  const context = newContext(fileId, name);
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);
  if (env) Object.assign(context.env, env);
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
      map: fn(2, (cs, list, fn) => {
        assert(Array.isArray(list));
        assert(typeof fn === 'function');
        return Promise.all(
          list.map(async (x) => {
            const result = await fn(x, cs);
            assert(result !== null);
            return result;
          })
        );
      }),
      filter: fn(2, async (cs, list, fn) => {
        assert(Array.isArray(list));
        assert(typeof fn === 'function');
        const result: EvalValue[] = [];
        for (const item of list) {
          const keep = await fn(item, cs);
          if (keep) result.push(item);
        }
        return result;
      }),
    };
    const input = `
      import "std/string" as { split, replace }
      lines := split document "\\n"
      lines = map lines (replace "\\\\s+" "")
      filter lines fn line -> line != ""
    `;
    const result = await evaluate(input, env);
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
      flat_map: fn(2, async (cs, list, fn) => {
        assert(Array.isArray(list));
        assert(typeof fn === 'function');
        const mapped = await Promise.all(
          list.map(async (x) => {
            const result = await fn(x, cs);
            assert(result !== null);
            return result;
          })
        );
        return mapped.flat();
      }),
    };
    const input = `
      import "std/string" as { char_at, match, slice }
      numbers := flat_map lines fn line {
        digits := ()
        while line != "" {
          if match "\\\\d" (char_at line 0) {
            digit := number (char_at line 0)
            if !digits[0]: digits[0] = digit
            digits[1] = digit
          }
          line = slice line (1,)
        }
        digits[0] * 10, digits[1]
      }
    `;
    const result = await evaluate(input, env);
    expect(result).toEqual([10, 2, 30, 8, 10, 5, 70, 7]);
  });

  it('evaluate drop last', async () => {
    const input = `
      list := 1, 2, 3
      ...list, _ = list
      list
    `;
    const result = await evaluate(input);
    expect(result).toEqual([1, 2]);
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
      import "std/concurrency" as { all }
      all(1 | 2)
    `;
    const result = await evaluate(input);
    expect(result).toStrictEqual([1, 2]);
  });

  it('evaluate parallel all multiline', async () => {
    const input = `
      import "std/concurrency" as { all }
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
      import "std/concurrency" as { all }
      import "std/math" as { floor }
      import "std/string" as { slice }
      reduce := fn list, reducer, merge, initial {
        len := length list
        if len == 0: return initial
        midpoint := floor(len / 2)
        item := list[midpoint]
        first, second := all(
          | (self (slice list (0, midpoint)) reducer merge initial)
          | (self (slice list (midpoint + 1,)) reducer merge initial)
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
    const result = await evaluate(input);
    expect(result).toStrictEqual([1]);
  });

  it('evaluate channels sync', async () => {
    const input = `
      lines := channel "lines"
      | {
        lines <- "1"
        close lines
      }
      while true {
        value, status := <-?lines
        if status == (:empty): continue()
        if status == (:closed): break()
        value
      }
    `;
    const result = await evaluate(input);
    expect(result).toStrictEqual([]);
    const input2 = `
      lines := channel "lines"
      async {
        lines <- "1"
        close lines
      }
      while true {
        value, status := <-?lines
        if status == (:empty): continue()
        if status == (:closed): break()
        value
      }
    `;
    const result2 = await evaluate(input2);
    expect(result2).toStrictEqual([]);
  });

  it('evaluate channels sync 2', async () => {
    const input = `
      lines := channel "lines"
      | {
        lines <- "1"
        lines <- "2"
        close lines
      }
      while true {
        value, status := <-?lines
        if status == (:empty): continue()
        if status == (:closed): break()
        value
      }
    `;
    const result = await evaluate(input);
    expect(result).toStrictEqual([]);
    const input2 = `
      lines := channel "lines"
      async {
        lines <- "1"
        lines <- "2"
        close lines
      }
      while true {
        value, status := <-?lines
        if status == (:empty): continue()
        if status == (:closed): break()
        value
      }
    `;
    const result2 = await evaluate(input2);
    expect(result2).toStrictEqual([]);
  });

  it('evaluate fn increment', async () => {
    const input = `
      line_handled_count := 0
      inc := fn -> line_handled_count++
      inc()
    `;
    const result = await evaluate(input);
    expect(result).toBe(0);
  });

  it('evaluate scope 1', async () => {
    const input = `
      x := 1
      { x := 2 }
      x
    `;
    const result = await evaluate(input);
    expect(result).toBe(1);
  });

  it('evaluate scope 2', async () => {
    const input = `
      x := 1
      loop { x := 2; break() }
      x
    `;
    const result = await evaluate(input);
    expect(result).toBe(1);
  });

  it('evaluate scope 3', async () => {
    const input = `
      import "std/concurrency" as { all }
      x := fn (a, b) -> a + b
      all(x(1, 2) | x(3, 4))
    `;
    const result = await evaluate(input);
    expect(result).toEqual([3, 7]);
  });

  it('evaluate scope 4', async () => {
    const input = `
      number := 1
      while true {
        number := 5
        break()
      }
      number
    `;
    const result = await evaluate(input);
    expect(result).toEqual(1);
  });

  it('evaluate scope 5', async () => {
    const input = `
      number := 1
      for x in 1, 2, 3 {
        number := 5
        break()
      }
      number
    `;
    const result = await evaluate(input);
    expect(result).toEqual(1);
  });

  it('evaluate scope 6', async () => {
    const input = `
      n := 1
      { n = 5 }
      n
    `;
    const result = await evaluate(input);
    expect(result).toEqual(5);
  });

  it('evaluate scope 7', async () => {
    const input = `
      n := 1
      { n += 5 }
      n
    `;
    const result = await evaluate(input);
    expect(result).toEqual(6);
  });
});

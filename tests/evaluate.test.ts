import { describe, expect, it } from 'vitest';
import { Context, evaluateScript, newContext } from '../src/evaluate.ts';
import { assert, inspect } from '../src/utils.ts';
import { atom, EvalValue, fn, isChannel, isSymbol } from '../src/values.ts';
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

describe('advent of code 2023 day 1 single', () => {
  it('variable', async () => {
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

  it('split lines', async () => {
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
        import "std/string" as { split, replace };
        lines := split document "\\n";
        lines = map lines (replace "\\\\s+" "");
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

  it('parse numbers', async () => {
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
              if !(0 in digits) do digits[0] = digit
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

  it('flat map list impl', async () => {
    const input = `
        flat_map := fn list, mapper {
          reduce list (fn acc, item -> (...acc, ...mapper item)) (fn first, second -> (...first, ...second)) ()
        }
      `;
    const result = await evaluate(input);
    expect(result).toMatchSnapshot();
  });

  it('reduce list', async () => {
    const input = `
        import "std/concurrency" as { all }
        import "std/math" as { floor }
        import "std/string" as { slice }
  
        reduce := fn list, reducer, merge, initial {
          len := length list
          if len == 0 do return initial

          midpoint := floor(len / 2)
          item := list[midpoint]
          first, second := all(
            | (self (slice list (0, midpoint)) reducer merge initial)
            | (self (slice list (midpoint + 1,)) reducer merge initial)
          )
  
          merge (reducer first item) second
        };
  
        reduce (1, 2, 3, 4, 5) (fn acc, item -> acc + item) (fn first, second -> first + second) 0
      `;
    const result = await evaluate(input);
    expect(result).toBe(15);
  });

  it('filter list impl', async () => {
    const input = `
        predicate := true
        first := ()
        item := 1
        acc := ()
        if predicate do (...first, item) else acc
      `;
    const result = await evaluate(input);
    expect(result).toStrictEqual([1]);
  });
});

describe('scope', () => {
  it('block shadowing', async () => {
    const input = `
        x := 1;
        { x := 2 };
        x
      `;
    const result = await evaluate(input);
    expect(result).toBe(1);
  });

  it('loop shadowing', async () => {
    const input = `
        x := 1;
        loop { x := 2; break() };
        x
      `;
    const result = await evaluate(input);
    expect(result).toBe(1);
  });

  it('fn concurrent', async () => {
    const input = `
        import "std/concurrency" as { all }
        x := fn (a, b) do a + b
        all(x(1, 2) | x(3, 4))
      `;
    const result = await evaluate(input);
    expect(result).toEqual([3, 7]);
  });

  it('while block shadowing', async () => {
    const input = `
        number := 1;
  
        while true {
          number := 5;
          break()
        };
  
        number
      `;
    const result = await evaluate(input);
    expect(result).toEqual(1);
  });

  it('for block shadowing', async () => {
    const input = `
        number := 1;
  
        for x in 1, 2, 3 {
          number := 5;
          break()
        };
  
        number
      `;
    const result = await evaluate(input);
    expect(result).toEqual(1);
  });

  it('block assign', async () => {
    const input = `
        n := 1;
        { n = 5 };
        n
      `;
    const result = await evaluate(input);
    expect(result).toEqual(5);
  });

  it('block increment', async () => {
    const input = `
        n := 1;
        { n += 5 };
        n
      `;
    const result = await evaluate(input);
    expect(result).toEqual(6);
  });

  it('effect handlers inject scoping', async () => {
    const input = `
      x := 1;
      inject a: 1, b: 2 {
        x := 2;
      };
      x
    `;
    const result = await evaluate(input);
    expect(result).toEqual(1);
  });
});

describe('comments', () => {
  it('comment', async () => {
    const input = `// comment\n123`;
    const result = await evaluate(input);
    expect(result).toBe(123);
  });

  it('comment block', async () => {
    const input = `/* comment block */123`;
    const result = await evaluate(input);
    expect(result).toBe(123);
  });
});

describe('expressions', () => {
  describe('values', async () => {
    it('integer', async () => {
      const input = `123`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('float', async () => {
      const input = `123.456`;
      const result = await evaluate(input);
      expect(result).toBe(123.456);
    });

    it('string', async () => {
      const input = `"string"`;
      const result = await evaluate(input);
      expect(result).toBe('string');
    });

    it('true', async () => {
      const input = `true`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('false', async () => {
      const input = `false`;
      const result = await evaluate(input);
      expect(result).toBe(false);
    });
  });

  describe('arithmetics', () => {
    it('order of application', async () => {
      const input = '1 + 2^-3 * 4 - 5 / 6 % 7';
      const result = await evaluate(input);
      expect(result).toBe(2 / 3);
    });

    it('post increment', async () => {
      const input = `
        x := 0
        x++, x        
      `;
      const result = await evaluate(input);
      expect(result).toEqual([0, 1]);
    });
  });

  describe('boolean expressions', () => {
    it('not on not boolean', async () => {
      const input = `!123`;
      expect(async () => await evaluate(input)).rejects.toThrow();
    });

    it('not on boolean', async () => {
      const input = `!true`;
      const result = await evaluate(input);
      expect(result).toBe(false);
    });

    it('and', async () => {
      const input = `true and false`;
      const result = await evaluate(input);
      expect(result).toBe(false);
    });

    it('and short-circuit', async () => {
      const input = `false and whatever`;
      const result = await evaluate(input);
      expect(result).toBe(false);
    });

    it('or', async () => {
      const input = `true or false`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('or short-circuit', async () => {
      const input = `true or whatever`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('in finds existing key', async () => {
      const input = `"key" in (key: 1, key2: 2)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('in not finds not existing key', async () => {
      const input = `"key3" in (key: 1, key2: 2)`;
      const result = await evaluate(input);
      expect(result).toBe(false);
    });

    it('in finds index holds value in tuple', async () => {
      const input = `1 in (1, 2)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('in finds index not holds value in tuple', async () => {
      const input = `5 in (1, 2)`;
      const result = await evaluate(input);
      expect(result).toBe(false);
    });

    it('eq', async () => {
      const input = `1 == 1`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('eq ref', async () => {
      const input = `x := 1, 2; y := x; x == y`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('eq ref 2', async () => {
      const input = `(1, 2) == (1, 2)`;
      const result = await evaluate(input);
      expect(result).toBe(false);
    });

    it('deep eq', async () => {
      const input = `(1, 2) === (1, 2)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('compare', async () => {
      const input = `123 < 456`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('and lhs creates scope', async () => {
      const input = `
        x := 2;
        true and (x := 1);
        x
      `;
      const result = await evaluate(input);
      expect(result).toBe(2);
    });

    it('or lhs creates scope', async () => {
      const input = `
        x := 2;
        false or (x := 1);
        x
      `;
      const result = await evaluate(input);
      expect(result).toBe(2);
    });
  });

  describe('function expressions', () => {
    it('fn increment', async () => {
      const input = `
        line_handled_count := 0
        inc := fn do line_handled_count++
        inc()
        line_handled_count
      `;
      const result = await evaluate(input);
      expect(result).toBe(1);
    });

    it('immediately invoked function expression (iife)', async () => {
      const input = `(fn x -> x) 1`;
      const result = await evaluate(input);
      expect(result).toBe(1);
    });

    it('return from function', async () => {
      const input = `(fn x -> { return (x + 1); x }) 1`;
      const result = await evaluate(input);
      expect(result).toBe(2);
    });

    it('function call multiple args', async () => {
      const input = `(fn x, y -> x + y) 1 2`;
      const result = await evaluate(input);
      expect(result).toBe(3);
    });
  });

  describe('pattern matching', () => {
    it('evaluate drop last', async () => {
      const input = `
          list := 1, 2, 3;
          ...list, _ = list;
          list
        `;
      const result = await evaluate(input);
      expect(result).toEqual([1, 2]);
    });

    it('switch', async () => {
      const input = `switch 1 { 1 -> 2, 3 -> 4 }`;
      const result = await evaluate(input);
      expect(result).toBe(2);
    });

    it('in function parameters', async () => {
      const input = `((x, y) -> x + y)(1, 2)`;
      const result = await evaluate(input);
      expect(result).toBe(3);
    });

    it("with 'is' operator", async () => {
      const input = `1 is x`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('with record pattern', async () => {
      expect(await evaluate(`(a: 1, b: 2) is { a, b }`)).toBe(true);
      expect(await evaluate(`(a: 1, b: 2) is { a, b, c }`)).toBe(false);
      expect(await evaluate(`(a: 1, b: 2) is { a }`)).toBe(true);
      expect(await evaluate(`1 is { a }`)).toBe(false);
    });

    it('with record pattern rename', async () => {
      expect(await evaluate(`(a: 1, b: 2) is { a: c, b }`)).toBe(true);
      expect(await evaluate(`(a: 1, b: 2) is { c: a, d: b }`)).toBe(false);
      expect(await evaluate(`(a: 1, b: 2) is { a: 1 }`)).toBe(true);
    });
    it('with record pattern nested', async () => {
      expect(await evaluate(`(a: (1, 2), b: 2) is { a: (c, d) }`)).toBe(true);
      expect(await evaluate(`(a: (1, 2), b: 2) is { a: { b } }`)).toBe(false);
    });
    it.todo('with record pattern key', async () => {
      expect(await evaluate(`3: 1, b: 2 is { [1 + 2]: c, b }`)).toBe(true);
      expect(await evaluate(`3: 1, b: 2 is { [1 + 1]: c, d }`)).toBe(false);
    });

    it('with constant value', async () => {
      expect(await evaluate(`1 is 1`)).toBe(true);
      expect(await evaluate(`1 is 2`)).toBe(false);
    });

    it('with placeholder', async () => {
      const input = `1 is _`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it.todo('with variable value', async () => {
      const input = `x is (^a, b)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('with rest value', async () => {
      const input = `(1, 2, 3) is (a, ...b)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it('with rest value first', async () => {
      const input = `(1, 2, 3) is (...b, a)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it.todo('with default value', async () => {
      const input = `x is ((b = 4), a)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it.todo('with rename', async () => {
      const input = `x is (a @ b, c)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it.todo('with name for match', async () => {
      const input = `x is ((a, b) @ c)`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });

    it.todo('binding visible in scope where it is true', async () => {
      const input = `x is (a, b) and a == b + 1`;
      const result = await evaluate(input);
      expect(result).toBe(true);
    });
  });

  describe('structured programming', () => {
    it.todo('label', async () => {
      const input = `label::{ label 1; 2 }`;
      const result = await evaluate(input);
      expect(result).toBe(1);
    });

    it.todo('loop if-then', async () => {
      const input = `y := (
        x := 25 
        res := () 
        block::{ 
          if x <= 0: (res = ...res, x; block.break)
          else {
            y := x
            x = x - 1
            if y == 19: (res = ...res, 69; block.continue)
            res = ...res, y
          }
        }
        res
      )`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('if-then', async () => {
      const input = `if true do 123`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('if-then-else', async () => {
      const input = `if true do 123 else 456`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('if-then-elseif-then-else', async () => {
      const input = `if true do 123 else if false do 789 else 456`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('block', async () => {
      const input = `{ 123 }`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('sequencing', async () => {
      const input = `123; 234; 345; 456`;
      const result = await evaluate(input);
      expect(result).toBe(456);
    });

    it('for loop', async () => {
      const input = `for x in (1, 2, 3) do x`;
      const result = await evaluate(input);
      expect(result).toEqual([1, 2, 3]);
    });

    it('for loop map', async () => {
      const input = `for x in (1, 2, 3) do x+1`;
      const result = await evaluate(input);
      expect(result).toEqual([2, 3, 4]);
    });

    it('for loop filter', async () => {
      const input = `for x in (1, 2, 3) do if x > 1 do x + 1`;
      const result = await evaluate(input);
      expect(result).toEqual([3, 4]);
    });

    it.todo('while loop', async () => {
      const input = `while true do 123`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('while loop break', async () => {
      const input = `while true do break _`;
      const result = await evaluate(input);
      expect(result).toBe(null);
    });

    it('while loop break value', async () => {
      const input = `while true do break 1`;
      const result = await evaluate(input);
      expect(result).toBe(1);
    });

    it.todo('while loop continue', async () => {
      const input = `while true do continue _`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('while loop continue value', async () => {
      const input = `while true do continue 1`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('return', async () => {
      const input = `(() -> { return 123; 456 })()`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('block variable declaration', async () => {
      const input = `{ x := 123 }`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('block mutable variable declaration', async () => {
      const input = `{ mut x := 123 }`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('block variable assignment', async () => {
      const input = `{ x = 123 }`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    describe('error handling', () => {
      it.todo('try throw', async () => {
        const input = `
          f := fn {
            throw 123
          };

          try f()
        `;
        const result = await evaluate(input);
        expect(result).toBe([atom('error'), 123]);
      });

      it.todo('try', async () => {
        const input = `
          f := fn {
            123
          };

          try f()
        `;
        const result = await evaluate(input);
        expect(result).toBe([atom('ok'), 123]);
      });

      it.todo('no try catch', async () => {
        const input = `
          f := fn {
            throw 123
          };

          f()
        `;
        const result = await evaluate(input);
        expect(result).toBe(null);
      });

      it.todo('rethrow explicit result', async () => {
        const input = `
          f := fn {
            :ok, 123
          };

          f()?
        `;
        const result = await evaluate(input);
        expect(result).toBe(null);
      });

      it.todo('try map err', async () => {
        const input = `
          f := fn {
            throw 123
          };

          try f().map_err(err -> "wha", err)?
        `;
        const result = await evaluate(input);
        expect(result).toBe(null);
      });
    });

    it.todo('resource handling', async () => {
      const input = `
          import "std/io" as { open };
          import "std/concurrency" as concurrency;

          {
            open "file.txt" fn file ->
            file.write("hello")
          }

          123
        `;
      const result = await evaluate(input);
      expect(result).toBe('hello');
    });
  });

  describe('concurrent programming', () => {
    it('evaluate parallel all', async () => {
      const input = `
          import "std/concurrency" as { all };
          all(1 | 2)
        `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([1, 2]);
    });

    it.todo('evaluate parallel some', async () => {
      const input = `
          import "std/concurrency" as { some };
          some(1 | 2)
        `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([1, 2]);
    });

    it('evaluate parallel all multiline', async () => {
      const input = `
          import "std/concurrency" as { all };
          all(
            | 1
            | 2
          )
        `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([1, 2]);
    });

    it('evaluate channels sync', async () => {
      const input = `
          lines := channel "lines"
    
          fork {
            lines <- "1"
            close lines
          }
    
          while true {
            value, status := <-? lines
            if status == :empty do continue()
            if status == :closed do break()
            value
          }
        `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([]);
    });

    it('evaluate channels sync 2', async () => {
      const input = `
          lines := channel "lines"
    
          fork {
            lines <- "1"
            lines <- "2"
            close lines
          };
    
          while true {
            value, status := <-?lines
            if status == :empty do continue()
            if status == :closed do break()
            value
          }
        `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([]);
    });

    it.todo('channel send', async () => {
      const input = `c <- 123`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('channel receive', async () => {
      const input = `<- c`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('parallel value', async () => {
      const input = `123 | 456`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('parallel with channels', async () => {
      const input = `c <- 123 | <- c`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('async', async () => {
      const input = `async f x`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('await async', async () => {
      const input = `await async f x`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('await', async () => {
      const input = `await x + 1`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('select', async () => {
      const input = `c1 + c2`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('wait', async () => {
      const input = `
        import "std/concurrency" as { wait };
        
        wait 500;
        123
      `;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it.todo('force sync', async () => {
      const input = `
        import "std/concurrency" as { creating_task };

        without creating_task {
          fork 123 // throws, since creating tasks is not allowed
        };
      `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([1, 2]);
    });

    describe('structured concurrency', () => {
      it.todo('cancelling', async () => {
        const input = `
          import "std/concurrency" as { wait };

          task := async {
            wait 1000;
            123
          };
          
          task.cancel();
          await task
        `;
        const result = await evaluate(input);
        expect(result).toStrictEqual([1, 2]);
      });

      it.todo('cancel propagation', async () => {
        const input = `
          import "std/concurrency" as { wait };

          task := async {
            wait 1000;
            123
          };
          
          task.cancel();
          await task
        `;
        const result = await evaluate(input);
        expect(result).toStrictEqual([1, 2]);
      });

      it.todo('cancel_on_error policy', async () => {
        const input = `
          import "std/concurrency" as { cancel_on_error_policy };
          
          handle := fn {
            cancel_on_error_policy fn {
              user := async find_user();
              order := async order();

              await user, await order
            }
          }
        `;
        const result = await evaluate(input);
        expect(result).toStrictEqual([1, 2]);
      });

      it.todo('cancel_on_return policy', async () => {
        const input = `
          import "std/concurrency" as { cancel_on_return_policy };
          
          race := fn list {
            cancel_on_return_policy fn {
              list.reduce fn task, acc -> async task() + acc
            }
          }
        `;
        const result = await evaluate(input);
        expect(result).toStrictEqual([1, 2]);
      });
    });
  });

  describe('effect handlers', () => {
    it('all in one', async () => {
      const input = `
        inject a: 1, b: 2 {
          { a, b } := injected;
          inject a: a+1, b: b+2 {
            mask "a" {
              without "b" {
                { a } := injected;
                a + 1
              }
            }
          }  
        }
      `;
      const result = await evaluate(input);
      expect(result).toEqual(2);
    });

    it('inject', async () => {
      const input = `
        inject a: 1, b: 2 {
          injected
        }
      `;
      const result = await evaluate(input);
      expect(result).toEqual({ record: { a: 1, b: 2 } });
    });

    it('inject twice', async () => {
      const input = `
        inject a: 1, b: 2 {
          { a, b } := injected;
          
          inject a: a+1, b: b+2 {
            injected
          }  
        }
      `;
      const result = await evaluate(input);
      expect(result).toEqual({ record: { a: 2, b: 4 } });
    });

    it('mask', async () => {
      const input = `
        inject a: 1, b: 2 {
          { a, b } := injected;
          
          inject a: a+1, b: b+2 {
            mask "a" {
              injected
            }
          }  
        }
      `;
      const result = await evaluate(input);
      expect(result).toEqual({ record: { a: 1, b: 4 } });
    });

    it('without', async () => {
      const input = `
        inject a: 1, b: 2 {
          { a, b } := injected;
          
          inject a: a+1, b: b+2 {
            without "a" {
              injected
            }
          }  
        }
      `;
      const result = await evaluate(input);
      expect(result).toEqual({ record: { b: 4 } });
    });

    it('parallel', async () => {
      const input = `
        f := fn {
          { a, b } := injected;
          a + b
        }
        
        inject a: 1, b: 2 ->
        x1 := f()
        x2 := fork { inject a: 3       do f() }
        x3 := fork { inject a: 5, b: 4 do f() }
        x1, await x2, await x3
      `;
      const result = await evaluate(input);
      expect(result).toEqual([3, 5, 9]);
    });

    it.todo('pythagorean triple example', async () => {
      const input = `
        choose_int := fn m, n {
          { decide, fail } := injected;

          if m > n: fail();
          if decide(): m else self m+1, n
        };

        pythagorean_triple := fn m, n {
          { fail } := injected;

          a := chooseInt(m, n);
          b := chooseInt(a + 1, n + 1);
          c := sqrt (a^2 + b^2);
          if floor c != c: fail()

          (a, b, c)
        };
        
        false_branch_first :=
          decide: fn x, continuation {
            fail_handler := fail: fn -> continuation false
            inject fail_handler { continuation true }
          };
        true_branch_first :=
          decide: fn x, continuation {
            fail_handler := fail: fn -> continuation true
            inject fail_handler { continuation false }
          };

        inject false_branch_first { pythagorean_triple 4 15 },
        inject true_branch_first { pythagorean_triple 4 15 }
      `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([1, 2]);
    });

    it.todo('logger example', async () => {
      const input = `
        import "std/effects" as { return_handler };
        logger :=
          log: fn msg, continuation {
            result, logs := continuation()
            result, (msg, ...logs)
          },
          [return_handler]: fn x, continuation -> x, ()

        inject logger {
          { log } := injected;
          log 123;
          log 456;
          123
        }
      `;
      const result = await evaluate(input);
      expect(result).toStrictEqual([123, [123, 456]]);
    });
  });

  describe('data structures', () => {
    it('unit', async () => {
      const input = `()`;
      const result = await evaluate(input);
      expect(result).toStrictEqual([]);
    });

    it('symbol', async () => {
      const input = `symbol "name"`;
      const result = await evaluate(input);
      expect(isSymbol(result)).toBe(true);
    });

    it('channel', async () => {
      const input = `channel "name"`;
      const result = await evaluate(input);
      expect(isChannel(result)).toBe(true);
    });

    it('atom (global symbol)', async () => {
      const input = `:atom`;
      const result = await evaluate(input);
      expect(isSymbol(result)).toBe(true);
    });

    it('tuple', async () => {
      const input = `1, 2`;
      const result = await evaluate(input);
      expect(result).toStrictEqual([1, 2]);
    });

    it('record', async () => {
      const input = `a: 1, b: 2`;
      const result = await evaluate(input);
      expect(result).toStrictEqual({ record: { a: 1, b: 2 } });
    });

    it.todo('set', async () => {
      const input = `set (1, 2, 2)`;
      const result = await evaluate(input);
      expect(result).toBe(123);
    });

    it('dictionary', async () => {
      const input = `[1]: 2, [3]: 4`;
      const result = await evaluate(input);
      expect(result).toStrictEqual({ record: { 1: 2, 3: 4 } });
    });

    it('map without braces', async () => {
      const input = `1+2: 3, 4+5: 6`;
      const result = await evaluate(input);
      expect(result).toStrictEqual({ record: { [3]: 3, [9]: 6 } });
    });

    it('field access static', async () => {
      const input = `record := a: 1, b: 2; record.a`;
      const result = await evaluate(input);
      expect(result).toBe(1);
    });

    it('field access dynamic', async () => {
      const input = `map := "some string": 1, b: 2; map["some string"]`;
      const result = await evaluate(input);
      expect(result).toBe(1);
    });
  });
});

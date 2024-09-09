import { expect } from 'vitest';
import { it, fc } from '@fast-check/vitest';
import { parseTokens } from '../src/tokens.ts';
import { parseModule, parseScript } from '../src/parser.ts';

// const anyStringArb = fc.string({ size: 'large', unit: 'binary' });
const anyStringArb = fc.fullUnicodeString({ size: 'large' });
// const anyStringArb = fc.string();

it.prop([anyStringArb])('module never throws', (src) => {
  const tokens = parseTokens(src);
  try {
    parseModule(tokens);
  } catch (e) {
    const msg = e instanceof Error ? e.stack : e;
    expect.unreachable(msg);
  }
});

it.prop([anyStringArb])('script never throws', (src) => {
  const tokens = parseTokens(src);
  try {
    parseScript(tokens);
  } catch (e) {
    const msg = e instanceof Error ? e.stack : e;
    expect.unreachable(msg);
  }
});

it('ast variable', () => {
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
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast split lines', () => {
  const input = `
      lines := {
        lines := split document "\\n";
        lines = map lines (replace "\\w+" "");
        lines = filter lines fn line -> line != "";
      }
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast unit', () => {
  const input = `()`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast parse numbers', () => {
  const input = `
      numbers := flat_map lines fn line {
        digits := ();

        while line != "" {
          if match "\d" (char_at line 0) {
            digit := number(char_at line 0);
            if !digits[0]: digits[0] = digit;
            digits[1] = digit;
          };
          (_, ...line) = line;
        };

        digits[0], digits[1] * 10
      }
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast fn multiple args', () => {
  const input = `
      fn acc, item -> ()
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast flat map list reducer', () => {
  const input = `
      fn acc, item -> (...acc, ...mapper item)
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast flat map list impl', () => {
  const input = `
      flat_map := fn list, mapper {
        reduce list (fn acc, item -> (...acc, ...mapper item)) (fn first, second -> (...first, ...second)) ()
      }
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast args list', () => {
  const input = `
      list, reducer, merge, initial
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast reduce list', () => {
  const input = `
      reduce := fn list, reducer, merge, initial {
        len := length list;
        if len == 0: return initial;
      
        midpoint := floor(len / 2);
        item := list[midpoint];
        first, second := all(
          | (reduce slice(list, 0, midpoint) reducer merge initial)
          | (reduce slice(list, midpoint + 1) reducer merge initial)
        );
      
        merge (reducer first item) second
      }
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast period operator', () => {
  const input = `math.floor`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast methods', () => {
  const input = `math.floor(1).multiply(2)`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast prefix parallel', () => {
  const input = `
      | { };
      numbers := channel()
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast receive', () => {
  const input = `
      status := <-?numbers
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast index', () => {
  const input = `x[0]`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast fn increment', () => {
  const input = `fn -> line_handled_count++`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast parallel multiline parens', async () => {
  const input = `(
      | 1
      | 2
    )`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast chaining multiline', async () => {
  const input = `a
      .b`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast parens multiline', async () => {
  const input = `(
      1 +
      2
      + 3
    )`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast no parens multiline', async () => {
  const input = `
      1 +
      2
      + 3
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast prefix multiline', async () => {
  const input = `!
      a`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast infix-prefix multiline', async () => {
  const input = `b :=
      !
      a`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast infix-infix multiline', async () => {
  const input = `b +
      c +
      d`;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast effect handlers', async () => {
  const input = `
    inject a: 1, b: 2 {
      use { a, b }
      inject a: a+1, b: b+2 {
        mask (:a,) {
          without (:b,) {
            use { a }
            a + 1
          }
        }
      }  
    }
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});

it('ast switch', async () => {
  const input = `
    switch a {
      1 -> 2,
      2 -> 3,
      _ -> 4,
    }
    `;
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(ast).toMatchSnapshot();
});
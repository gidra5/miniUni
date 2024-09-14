import { describe, expect } from 'vitest';
import { it, fc } from '@fast-check/vitest';
import { parseTokens } from '../src/tokens.ts';
import { parseModule, parseScript } from '../src/parser.ts';

// const anyStringArb = fc.string({ size: 'large', unit: 'binary' });
const anyStringArb = fc.fullUnicodeString({ size: 'large' });
// const anyStringArb = fc.string();

it.prop([anyStringArb])('module parsing never throws', (src) => {
  const tokens = parseTokens(src);
  try {
    parseModule(tokens);
  } catch (e) {
    const msg = e instanceof Error ? e.stack : e;
    expect.unreachable(msg);
  }
});

it.prop([anyStringArb])('script parsing never throws', (src) => {
  const tokens = parseTokens(src);
  try {
    parseScript(tokens);
  } catch (e) {
    const msg = e instanceof Error ? e.stack : e;
    expect.unreachable(msg);
  }
});

describe('advent of code 1 single file', () => {
  it('variable', () => {
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

  it('split lines', () => {
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

  it('parse numbers', () => {
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

  it('fn multiple args', () => {
    const input = `
        fn acc, item -> ()
      `;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('flat map list reducer', () => {
    const input = `
        fn acc, item -> (...acc, ...mapper item)
      `;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('flat map list impl', () => {
    const input = `
        flat_map := fn list, mapper {
          reduce list (fn acc, item -> (...acc, ...mapper item)) (fn first, second -> (...first, ...second)) ()
        }
      `;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('reduce list', () => {
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
});

/* one test per example of a language construct  */

describe('comments', () => {
  it('comment', () => {
    const src = `// comment\n123`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('comment block', () => {
    const src = `/* comment block */123`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });
});

describe('expressions', () => {
  describe('values', () => {
    it('integer', () => {
      const src = `123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('float', () => {
      const src = `123.456`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('string', () => {
      const src = `"string"`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('arithmetics', () => {
    it('order of application', () => {
      const src = '1 + 2^3 * 4';
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('-(a+b)', () => {
      const src = '-(a+b)';
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('complex', () => {
      const src =
        '(2^2-5+7)-(-i)+ (j)/0 - 1*(1*f)+(27-x )/q + send(-(2+7)/A,j, i, 127.0 ) + 1/1';
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('boolean expressions', () => {
    it('not', () => {
      const src = `!123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('"and", "or" and "not" associativity', () => {
      const src = `a and b and c or d or !e and f and g or not h or i`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('function expressions', () => {
    it('function block body', () => {
      const src = `fn x, y { x + y }`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('function multiple params', () => {
      const src = `fn x, y -> x + y`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('fn no parameters', () => {
      const input = `fn -> 123`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('fn no parameters block', () => {
      const input = `fn { 123 }`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('arrow function', () => {
      const src = `x -> x`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('fn increment', () => {
      const input = `fn -> line_handled_count++`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    describe('application', () => {
      it('function call', () => {
        const src = `f x`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it('function call multiple args', () => {
        const src = `f x y`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('send((1+2), 3)', () => {
        const src = `send((1+2), 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('send(2, 3)', () => {
        const src = `send(2, 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('(send)(2, 3)', () => {
        const src = `(send)(2, 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('(send 1)(2, 3)', () => {
        const src = `(send 1)(2, 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('(send 1 2)(2, 3)', () => {
        const src = `(send 1 2)(2, 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('send 1 + 2', () => {
        const src = `send 1 + 2`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('a + send (2, 3)', () => {
        const src = `a + send (2, 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('send a (2, 3)', () => {
        const src = `send a (2, 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('send 1 (2, 3)', () => {
        const src = `send 1 (2, 3)`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });

      it.todo('a + send 1 + 2', () => {
        const src = `a + send 1 + 2`;
        const tokens = parseTokens(src);
        const ast = parseScript(tokens);

        expect(ast).toMatchSnapshot();
      });
    });
  });

  describe('pattern matching', () => {
    it('switch', async () => {
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

    it('in function parameters', () => {
      const src = `(x, y) -> x + y`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('declare record pattern', async () => {
      const input = `{ a, b } := handlers`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo("with 'is' operator", () => {
      const src = `x is (a, b)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('with placeholder', () => {
      const src = `x is (_, b)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('with variable value', () => {
      const src = `x is (^a, b)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('with rest value', () => {
      const src = `x is (a, ...b)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('with rest value first', () => {
      const src = `x is (...b, a)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('with default value', () => {
      const src = `x is ((b = 4), a)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('with rename', () => {
      const src = `x is (a @ b, c)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('with name for match', () => {
      const src = `x is ((a, b) @ c)`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('binding visible in scope where it is true', () => {
      const src = `x is (a, b) and a == b + 1`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('structured programming', () => {
    it.todo('if-then 2', () => {
      const src = `y := (x := 25; loop if x < 0: break x else { y := x; x = x - 1; if y == 19: continue 69; y })`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('if-then', () => {
      const src = `if true: 123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('if-then-else', () => {
      const src = `if true: 123 else 456`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('if-then-elseif-then-else', () => {
      const src = `if true: 123 else if false: 789 else 456`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('block', () => {
      const src = `{ 123 }`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('for loop', () => {
      const src = `for x in (1, 2, 3): x`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('while loop', () => {
      const src = `while true: 123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('loop', () => {
      const src = `loop 123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('loop scope', async () => {
      const input = `loop { x }`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('labeled expression', () => {
      const src = `label::123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('concurrent programming', () => {
    it('channel send', () => {
      const src = `c <- 123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('channel receive', () => {
      const src = `<- c`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('channel try send', () => {
      const src = `c ?<- 123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('channel try receive', () => {
      const src = `<-? c`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('try receive with assignment', () => {
      const input = `status := <-?numbers`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('parallel value', () => {
      const src = `123 | 456`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('prefix parallel with code after', () => {
      const input = `
          | { };
          numbers := channel()
        `;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('parallel with channels', () => {
      const src = `c <- 123 | <- c`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('async', () => {
      const src = `async f x`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('await async', () => {
      const src = `await async f x`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('await', () => {
      const src = `await x + 1`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('data structures', () => {
    it('unit', () => {
      const input = `()`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('tuple', () => {
      const input = `list, reducer, merge, initial`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('record single', async () => {
      const input = `a: 1`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('record', async () => {
      const input = `a: 1, b: 2`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('tuple with single item (atom)', async () => {
      const input = `(:a,)`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('(-(2+7)/A,j, i, 127.0 )', () => {
      const src = `(-(2+7)/A,j, i, 127.0 )`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('atom (global symbol)', () => {
      const src = `:atom`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it.todo('map', () => {
      const src = `[1]: 2, [3]: 4`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('map without braces', () => {
      const src = `1+2: 3, 4+5: 6`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('period operator', () => {
      const input = `math.floor`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('index', () => {
      const input = `x[0]`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('methods', () => {
      const input = `math.floor(1).multiply(2)`;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('field assignment', () => {
      const src = `x.y = 123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('field assignment dynamic', () => {
      const src = `x[y] = 123`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('effect handlers', () => {
    it('inject', async () => {
      const input = `
        inject a: 1, b: 2 {
          1
        }
      `;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('mask', async () => {
      const input = `
        mask "a", "b" {
          1
        }
      `;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('without', async () => {
      const input = `
        without "a", "b" {
          1
        }
      `;
      const tokens = parseTokens(input);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('complex', async () => {
      const input = `
        inject a: 1, b: 2 {
          { a, b } := handlers;
          inject a: a+1, b: b+2 {
            mask "a" {
              without "b" {
                { a } := handlers;
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
  });
});

describe('programs', () => {
  it('import', () => {
    const src = `import "a" as b`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  describe('script', () => {
    it('dynamic import', () => {
      const src = `b := import "a"`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('dynamic async import', () => {
      const src = `b := async import "a"`;
      const tokens = parseTokens(src);
      const ast = parseScript(tokens);

      expect(ast).toMatchSnapshot();
    });
  });

  describe('module', () => {
    it('export declaration', () => {
      const src = `export x := 123`;
      const tokens = parseTokens(src);
      const ast = parseModule(tokens);

      expect(ast).toMatchSnapshot();
    });

    it('export default', () => {
      const src = `export fn args -> 1`;
      const tokens = parseTokens(src);
      const ast = parseModule(tokens);

      expect(ast).toMatchSnapshot();
    });
  });
});

describe('newline handling', () => {
  it.todo('for loop newline', () => {
    const src = `for x in [1, 2, 3]\n x`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('parallel parens', async () => {
    const input = `(
        | 1
        | 2
      )`;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('chaining', async () => {
    const input = `a
        .b`;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('parens', async () => {
    const input = `(
        1 +
        2
        + 3
      )`;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('no parens', async () => {
    const input = `
        1 +
        2
        + 3
      `;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('prefix', async () => {
    const input = `!
        a`;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('infix-prefix', async () => {
    const input = `b :=
        !
        a`;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('infix-infix', async () => {
    const input = `b +
        c +
        d`;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it.todo('if else separate lines', async () => {
    const input = 'if a\n 1\n else\n 2';
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it.todo('if-then newline', () => {
    const src = `if true\n 123`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it.todo('if-then newline-else', () => {
    const src = `if true\n 123 else 456`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it.todo('if-then newline-else newline', () => {
    const src = `if true\n 123 else\n 456`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it.todo('block newline in the middle', () => {
    const src = `{ a := 1\n b := 2 }`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it.todo('block newline at the end', () => {
    const src = `{ a := 1\n b := 2\n }`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it.todo('block newline at the beginning', () => {
    const src = `{\n a := 1\n b := 2 }`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('block semicolon newline', () => {
    const src = `{ a := 1;\n b := 2 }`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });

  it('block semicolon newline at the end', () => {
    const src = `{ a := 1;\n b := 2;\n }`;
    const tokens = parseTokens(src);
    const ast = parseScript(tokens);

    expect(ast).toMatchSnapshot();
  });
});

import { beforeEach, describe, expect } from 'vitest';
import { it, fc } from '@fast-check/vitest';
import { identifier, parseTokens, TokenPos } from '../src/tokens.ts';
import { tokenArbitrary, tokenListArbitrary } from '../src/testing.ts';
import { parseModule, parseScript } from '../src/parser.ts';
import { Injectable, register } from '../src/injector.ts';
import { FileMap } from 'codespan-napi';
import { NodeType, Tree } from '../src/ast.ts';
import { inspect } from '../src/utils.ts';

const zeroPos = { start: 0, end: 0 };

beforeEach(() => {
  register(Injectable.FileMap, new FileMap());
  register(Injectable.ASTNodeNextId, 0);
  register(Injectable.ASTNodePrecedenceMap, new Map());
  register(Injectable.ASTNodePositionMap, new Map());
});

const testCase = (input: string) => {
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  expect(clearIds(ast)).toMatchSnapshot();

  function clearIds(ast: Tree) {
    if (ast.children.length > 0) {
      ast.children.forEach(clearIds);
    }
    delete (ast as any).id;
    return ast;
  }
};

it.prop([fc.array(tokenArbitrary)])('module parsing never throws', (tokens) => {
  try {
    parseModule(tokens.map((t) => ({ ...t, ...zeroPos })));
  } catch (e) {
    const msg = e instanceof Error ? e.stack : e;
    expect.unreachable(msg);
  }
});

it.prop([fc.array(tokenArbitrary)])('script parsing never throws', (tokens) => {
  try {
    parseScript(tokens.map((t) => ({ ...t, ...zeroPos })));
  } catch (e) {
    const msg = e instanceof Error ? e.stack : e;
    expect.unreachable(msg);
  }
});

it.prop([
  tokenListArbitrary.filter(
    (tokens) => !tokens.some((t) => t.src !== '{' && t.src !== '}')
  ),
])('block parsing always bound by braces', (_tokens) => {
  const tokens = [
    identifier('{', zeroPos),
    ..._tokens.map((t) => ({ ...t, ...zeroPos })),
    identifier('}', zeroPos),
  ];
  let ast = parseScript(tokens);
  expect(ast.children[0]).toMatchObject({ type: NodeType.BLOCK });
});

it.prop([
  tokenListArbitrary.filter(
    (tokens) => !tokens.some((t) => t.src !== '(' && t.src !== ')')
  ),
])('parsing always bound by parens', (_tokens) => {
  const tokens = [
    identifier('(', zeroPos),
    ..._tokens.map((t) => ({ ...t, ...zeroPos })),
    identifier(')', zeroPos),
  ];
  let ast = parseScript(tokens);
  expect(ast.children[0]).toMatchObject({ type: NodeType.PARENS });
});

it.prop(
  [
    tokenListArbitrary.filter(
      (tokens) => !tokens.some((t) => t.src !== '[' && t.src !== ']')
    ),
  ],
  { seed: -2024914109, path: '0', endOnFailure: true }
)('square brackets parsing always bound by square brackets', (_tokens) => {
  const tokens = [
    identifier('[', zeroPos),
    ..._tokens.map((t) => ({ ...t, ...zeroPos })),
    identifier(']', zeroPos),
  ] as TokenPos[];
  let ast = parseScript(tokens);
  expect(ast.children[0]).toMatchObject({ type: NodeType.SQUARE_BRACKETS });
});

describe('advent of code 1 single file', () => {
  it('variable', () =>
    testCase(`
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
    `));

  it('split lines', () =>
    testCase(`
        lines := {
          lines := split document "\\n";
          lines = map lines (replace "\\w+" "");
          lines = filter lines fn line do line != "";
        }
      `));

  it('parse numbers', () =>
    testCase(`
        numbers := flat_map lines fn line {
          digits := ();
  
          while line != "" {
            if match "\d" (char_at line 0) {
              digit := number(char_at line 0);
              if !digits[0] do digits[0] = digit;
              digits[1] = digit;
            };
            (_, ...line) = line;
          };
  
          digits[0], digits[1] * 10
        }
      `));

  it('fn multiple args', () =>
    testCase(`
        fn acc, item -> ()
      `));

  it('flat map list reducer', () =>
    testCase(`
        fn acc, item -> (...acc, ...mapper item)
      `));

  it('flat map list impl', () =>
    testCase(`
        flat_map := fn list, mapper {
          reduce list (fn acc, item -> (...acc, ...mapper item)) (fn first, second -> (...first, ...second)) ()
        }
      `));

  it('reduce list', () =>
    testCase(`
        reduce := fn list, reducer, merge, initial {
          len := length list;
          if len == 0 do return initial;
        
          midpoint := floor(len / 2);
          item := list[midpoint];
          first, second := all(
            | (reduce slice(list, 0, midpoint) reducer merge initial)
            | (reduce slice(list, midpoint + 1) reducer merge initial)
          );
        
          merge (reducer first item) second
        }
      `));
});

/* one test per example of a language construct  */

describe('comments', () => {
  it('comment', () => testCase(`// comment\n123`));

  it('comment block', () => testCase(`/* comment block */123`));
});

describe('expressions', () => {
  describe('values', () => {
    it('integer', () => testCase(`123`));
    it('float', () => testCase(`123.456`));
    it('string', () => testCase(`"string"`));
  });

  describe('arithmetics', () => {
    it('order of application', () => testCase(`1 + 2^-3 * 4 - 5 / 6 % 7`));
    it('-(a+b)', () => testCase(`-(a+b)`));

    it('complex', () =>
      testCase(
        `(2^2-5+7)-(-i)+ (j)/0 - 1*(1*f)+(27-x )/q + send(-(2+7)/A,j, i, 127.0 ) + 1/1`
      ));
  });

  describe('boolean expressions', () => {
    it('not', () => testCase(`!123`));
    it('"and", "or" and "not" associativity', () =>
      testCase(`a and b and c or d or !e and f and g or not h or i`));
    it('in operator', () => testCase(`:key in x and y`));
  });

  describe('function expressions', () => {
    it('function block body', () => testCase(`fn x, y { x + y }`));
    it('function multiple params', () => testCase(`fn x, y -> x + y`));
    it('fn no parameters', () => testCase(`fn -> 123`));
    it('fn no parameters block', () => testCase(`fn { 123 }`));
    it('arrow function', () => testCase(`x -> x`));
    it('fn increment', () => testCase(`fn -> line_handled_count++`));

    describe('application', () => {
      it('function call', () => testCase(`f x`));
      it('function call multiple args', () => testCase(`f x y`));
      it('function call param with field', () => testCase(`f x.y`));
      it('send((1+2), 3)', () => testCase(`send((1+2), 3)`));
      it('send(2, 3)', () => testCase(`send(2, 3)`));
      it('(send)(2, 3)', () => testCase(`(send)(2, 3)`));
      it('(send 1)(2, 3)', () => testCase(`(send 1)(2, 3)`));
      it('(send 1 2)(2, 3)', () => testCase(`(send 1 2)(2, 3)`));
      it('send 1 + 2', () => testCase(`send 1 + 2`));
      it('a + send (2, 3)', () => testCase(`a + send (2, 3)`));
      it('send a (2, 3)', () => testCase(`send a (2, 3)`));
      it('send 1 (2, 3)', () => testCase(`send 1 (2, 3)`));
      it('a + send 1 + 2', () => testCase(`a + send 1 + 2`));
      it('methods chaining', () => testCase(`math.floor(1).multiply(2)`));
    });
  });

  describe('pattern matching', () => {
    it('switch', () =>
      testCase(`
        switch a {
          1 -> 2,
          2 -> 3,
          _ -> 4,
        }
      `));

    it('in function parameters', () => testCase(`(x, y) -> x + y`));
    it('declare record pattern', () => testCase(`{ a, b } := handlers`));
    it("with 'is' operator", () => testCase(`x is (a, b)`));
    it('with placeholder', () => testCase(`x is (_, b)`));
    it.todo('with pin', () => testCase(`x is (^a, b)`));
    it.todo('with pin expression', () => testCase(`x is (^(a + b), b)`));
    it('with constant value', () => testCase(`x is (1, b)`));
    it('with rest value', () => testCase(`x is (a, ...b)`));
    it('with rest value first', () => testCase(`x is (...b, a)`));
    it('with record pattern', () => testCase(`x is { a, b }`));
    it('with record pattern rename', () => testCase(`x is { a: c, b }`));
    it('with record pattern key', () => testCase(`x is { [a + b]: c, b }`));
    it('with record pattern nested', () => testCase(`x is { a: (c, d), b }`));
    it.todo('with default value', () => testCase(`x is ((b = 4), a)`));
    it('with rename', () => testCase(`x is (a @ b, c)`));
    it('with name for match', () => testCase(`x is ((a, b) @ c)`));

    it('binding visible in scope where it is true', () =>
      testCase(`x is (a, b) and a == b + 1`));
  });

  describe('structured programming', () => {
    it('complex 1', () =>
      testCase(`
        y := {
          x := 25;
          loop if x < 0 do break x else {
            y := x;
            x = x - 1;
            if y == 19 do continue 69;
            y
          }
        }
      `));

    it('if-then', () => testCase(`if true do 123`));
    it('if-then-else', () => testCase(`if true do 123 else 456`));
    it('if-then-elseif-then-else', () =>
      testCase(`if true do 123 else if false do 789 else 456`));
    it('sequence', () => testCase(`123; 234; 345; 456`));
    it('block sequence', () => testCase(`{ 123; 234; 345; 456 }`));
    it('parens sequence', () => testCase(`(123; 234; 345; 456)`));
    it('block', () => testCase(`{ 123 }`));
    it('for loop', () => testCase(`for x in (1, 2, 3) do x`));
    it('while loop', () => testCase(`while true do 123`));
    it('loop', () => testCase(`loop 123`));
    it('loop scope', () => testCase(`loop { x }`));
    it('labeled expression', () => testCase(`label::123`));

    describe('statement forms', () => {
      it('immediate form', () => testCase(`if true do 123; 456`));
      it('block form', () => testCase(`if true { 123 }`));
      it('rest form', () => testCase(`if true -> 123; 456`));
    });
  });

  describe('concurrent programming', () => {
    it('channel send', () => testCase(`c <- 123`));
    it('channel receive', () => testCase(`<- c`));
    it('channel try send', () => testCase(`c ?<- 123`));
    it('channel try receive', () => testCase(`<-? c`));
    it('try receive with assignment', () => testCase(`status := <-?numbers`));
    it('parallel value', () => testCase(`123 | 456`));
    it('prefix parallel with code after', () =>
      testCase(`| { };\nnumbers := channel()`));
    it('parallel with channels', () => testCase(`c <- 123 | <- c`));
    it('fork', () => testCase(`fork f x; y`));
    it('async', () => testCase(`async f x`));
    it('async index', () => testCase(`async f.a`));
    it('await async', () => testCase(`await async f x`));
    it('await', () => testCase(`await x + 1`));
  });

  describe('data structures', () => {
    it('unit', () => testCase(`()`));
    it('tuple', () => testCase(`list, reducer, merge, initial`));
    it('record single', () => testCase(`a: 1`));
    it('record', () => testCase(`a: 1, b: 2`));
    it('tuple with single item (atom)', () => testCase(`(:a,)`));
    it('(-(2+7)/A,j, i, 127.0 )', () => testCase(`(-(2+7)/A,j, i, 127.0 )`));
    it('atom (global symbol)', () => testCase(`:atom`));
    it('dictionary', () => testCase(`[1]: 2, [3]: 4`));
    it('map without braces', () => testCase(`1+2: 3, 4+5: 6`));
    it('period operator', () => testCase(`math.floor`));
    it('index', () => testCase(`x[0]`));
    it('field assignment', () => testCase(`x.y = 123`));
    it('field assignment dynamic', () => testCase(`x[y] = 123`));
  });

  describe('effect handlers', () => {
    it('inject', () => testCase(`inject a: 1, b: 2 { 1 }`));
    it('mask', () => testCase(`mask "a", "b" { 1 }`));
    it('without', () => testCase(`without "a", "b" { 1 }`));
    it('complex', () =>
      testCase(`
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
      `));
  });
});

describe('programs', () => {
  it('import', () => testCase(`import "a" as b`));

  describe('script', () => {
    it('dynamic import', () => testCase(`b := import "a"`));
    it('dynamic  import', () => testCase(`b :=  import "a"`));
  });

  describe('module', () => {
    it('export declaration', () => testCase(`export x := 123`));
    it('export default', () => testCase(`export fn args -> 1`));
  });
});

describe('newline handling', () => {
  it('for loop newline', () => testCase(`for x in 1, 2, 3 do\n x`));
  it('parallel parens', () => testCase(`(\n| 1\n| 2\n)`));
  it('chaining', () => testCase(`a\n.b`));
  it('parens', () => testCase(`(\n1 +\n2\n+ 3\n)`));
  it('no parens', () => testCase(`1 +\n2\n+ 3`));
  it('prefix', () => testCase(`!\na`));
  it('infix-prefix', () => testCase(`b :=\n !\na`));
  it('infix-infix', () => testCase(`b +\nc +\nd`));
  it.todo('if else separate lines', () => testCase(`if a do\n 1\n else\n 2`));
  it.todo('if-then newline', () => testCase(`if true do\n 123`));
  it.todo('if-then newline-else', () => testCase(`if true do\n 123 else 456`));
  it.todo('if-then newline-else newline', () =>
    testCase(`if true do\n 123 else\n 456`)
  );
  it.todo('block newline in the middle', () => testCase(`{ a := 1\n b := 2 }`));
  it.todo('block newline at the end', () => testCase(`{ a := 1\n b := 2\n }`));
  it.todo('block newline at the beginning', () =>
    testCase(`{\n a := 1\n b := 2 }`)
  );
  it('block semicolon newline', () => testCase(`{ a := 1;\n b := 2 }`));
  it('block semicolon newline at the end', () =>
    testCase(`{ a := 1;\n b := 2;\n }`));
});

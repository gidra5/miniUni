import { parseToken, parseTokens, type Token } from '../src/tokens.js';
import { describe, expect } from 'vitest';
import { it, fc, test } from '@fast-check/vitest';
import { array, integer } from 'fast-check';

// Test case: Parsing a string token
test.prop([fc.string().filter((s) => !s.includes('\\') && !s.includes('"'))])(
  'parseToken - string token',
  (value) => {
    const src = `"${value}"`;
    const startIndex = 0;
    const expectedToken = { type: 'string', src, value };
    const expectedIndex = value.length + 2;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  }
);

test.prop([fc.string({ maxLength: 1, minLength: 1 })])(
  'parseToken - string token escape',
  (value) => {
    const src = `"\\${value}"`;
    const startIndex = 0;
    const expectedToken = { type: 'string', src, value };
    const expectedIndex = 4;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  }
);

// Test case: Parsing a number token
describe('parseToken - number token', () => {
  it.prop([fc.stringMatching(/^\d+\.\d+$/)])('float literals', (src) => {
    const startIndex = 0;
    const expectedToken = { type: 'number', src, value: Number(src) };
    const expectedIndex = src.length;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });

  it.prop([fc.stringMatching(/^\d+$/)])('int literals', (src) => {
    const startIndex = 0;
    const expectedToken = { type: 'number', src, value: Number(src) };
    const expectedIndex = src.length;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });

  it.prop([fc.stringMatching(/^\d+\.$/)])('trailing dot literals', (src) => {
    const startIndex = 0;
    const expectedToken = { type: 'number', src, value: Number(src + '0') };
    const expectedIndex = src.length;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });

  it.prop([fc.stringMatching(/^\.\d+$/)])('prefix dot literals', (src) => {
    const startIndex = 0;
    const expectedToken = { type: 'number', src, value: Number('0' + src) };
    const expectedIndex = src.length;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });

  it.prop([fc.stringMatching(/^\d[\d_]*\d$/)])(
    'int literals with spacers',
    (src) => {
      const startIndex = 0;
      const expectedToken = {
        type: 'number',
        src,
        value: Number(src.replace(/_/g, '')),
      };
      const expectedIndex = src.length;

      const [index, { start, end, ...token }] = parseToken(src, startIndex);

      expect(index).toBe(expectedIndex);
      expect(token).toEqual(expectedToken);
    }
  );

  it.prop([fc.stringMatching(/^\.\d[\d_]*\d$/)])(
    'float literals with spacers',
    (src) => {
      const startIndex = 0;
      const expectedToken = {
        type: 'number',
        src,
        value: Number(src.replace(/_/g, '')),
      };
      const expectedIndex = src.length;

      const [index, { start, end, ...token }] = parseToken(src, startIndex);

      expect(index).toBe(expectedIndex);
      expect(token).toEqual(expectedToken);
    }
  );

  it.prop([fc.stringMatching(/^0x[\da-fA-F][\da-fA-F_]*[\da-fA-F]$/)])(
    'hex literals with spacers',
    (src) => {
      const startIndex = 0;
      const expectedToken = {
        type: 'number',
        src,
        value: Number(src.replace(/_/g, '')),
      };
      const expectedIndex = src.length;

      const [index, { start, end, ...token }] = parseToken(src, startIndex);

      expect(index).toBe(expectedIndex);
      expect(token).toEqual(expectedToken);
    }
  );

  it.prop([fc.stringMatching(/^0o[0-7][0-7_]*[0-7]$/)])(
    'octal literals with spacers',
    (src) => {
      const startIndex = 0;
      const expectedToken = {
        type: 'number',
        src,
        value: Number(src.replace(/_/g, '')),
      };
      const expectedIndex = src.length;

      const [index, { start, end, ...token }] = parseToken(src, startIndex);

      expect(index).toBe(expectedIndex);
      expect(token).toEqual(expectedToken);
    }
  );

  it.prop([fc.stringMatching(/^0b[01][01_]*[01]$/)])(
    'binary literals with spacers',
    (src) => {
      const startIndex = 0;
      const expectedToken = {
        type: 'number',
        src,
        value: Number(src.replace(/_/g, '')),
      };
      const expectedIndex = src.length;

      const [index, { start, end, ...token }] = parseToken(src, startIndex);

      expect(index).toBe(expectedIndex);
      expect(token).toEqual(expectedToken);
    }
  );
});

// Test case: Parsing an identifier token
describe('parseToken - identifier token', () => {
  it.prop([fc.stringMatching(/^[a-zA-Z]\w*$/)])('regular idents', (src) => {
    const startIndex = 0;
    const expectedToken = { type: 'identifier', src };
    const expectedIndex = src.length;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });
  it.prop([fc.stringMatching(/^_+$/)])('placeholders', (src) => {
    const startIndex = 0;
    const expectedToken = { type: 'placeholder', src };
    const expectedIndex = src.length;

    const [index, { start, end, ...token }] = parseToken(src, startIndex);

    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });
});

describe('parseTokens - comments', () => {
  it.prop([fc.stringMatching(/[^\n]*/)])('single line comments', (comment) => {
    const src = `//${comment}\n`;
    const input = `${src}12412434`;
    const startIndex = 0;
    const expectedToken = { type: 'newline', src };
    const expectedIndex = src.length;

    const [index, { start, end, ...token }] = parseToken(input, startIndex);

    expect(start).toBe(0);
    expect(end).toBe(expectedIndex);
    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });
  it.prop([fc.string().map((s) => s.replace('*/', ''))])(
    'multi line comments',
    (comment) => {
      const src = `/*${comment}*/`;
      const input = `${src}_`;
      const startIndex = 0;
      const expectedToken = { type: 'placeholder', src: '_' };
      const expectedStart = src.length;
      const expectedIndex = src.length + 1;

      const [index, { start, end, ...token }] = parseToken(input, startIndex);

      expect(start).toBe(expectedStart);
      expect(end).toBe(expectedIndex);
      expect(index).toBe(expectedIndex);
      expect(token).toEqual(expectedToken);
    }
  );
  it.prop([
    fc.string().map((s) => s.replace('*/', '')),
    array(integer({ min: 0, max: 2 })),
  ])('multiple comments', (comment, parts) => {
    const src = [...parts, 0]
      .map((kind) => {
        if (kind === 0) return '\n';
        if (kind === 1) return `//${comment}\n`;
        return `/*${comment}*/`;
      })
      .join('');
    const input = `${src}_`;
    const startIndex = 0;

    let expectedIndex: number;
    let expectedStart: number;
    let expectedToken: Token;
    if (src.includes('\n')) {
      expectedToken = { type: 'newline', src };
      expectedStart = 0;
      expectedIndex = src.length;
    } else {
      expectedToken = { type: 'placeholder', src: '_' };
      expectedStart = src.length;
      expectedIndex = src.length + 1;
    }

    const [index, { start, end, ...token }] = parseToken(input, startIndex);

    expect(start).toBe(expectedStart);
    expect(end).toBe(expectedIndex);
    expect(index).toBe(expectedIndex);
    expect(token).toEqual(expectedToken);
  });
});

// Test case: Parsing tokens from a source string
test('parseTokens', () => {
  const src = '42 "Hello" variable ((expr))';

  const tokens = parseTokens(src);

  expect(tokens).toMatchSnapshot();
});

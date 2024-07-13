import { parseToken, parseTokens } from '../src/tokens.js';
import { describe, expect } from 'vitest';
import { it, fc, test } from '@fast-check/vitest';

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

// Test case: Parsing tokens from a source string
test('parseTokens', () => {
  const src = '42 "Hello" variable ((expr))';

  const tokens = parseTokens(src);

  expect(tokens).toMatchSnapshot();
});

import { parseToken, Token } from './tokens.js';
import fc from 'fast-check';

const fcConst = <const T>(value: T): fc.Arbitrary<T> => fc.constant(value);

export const tokenArbitrary: fc.Arbitrary<Token> = fc.oneof(
  fc.record({
    type: fcConst('placeholder'),
    src: fc.stringMatching(/^_+$/, { size: 'small' }),
  }),
  fc.record({
    type: fcConst('newline'),
    src: fc.stringMatching(/\s*\n\s*/, { size: 'small' }),
  }),
  fc
    .string({ minLength: 1, size: 'small' })
    .map((s) => parseToken(s)[1])
    .filter((t) => t.type === 'error'),
  fc
    .string({ minLength: 1, size: 'small' })
    .map((s) => parseToken(s)[1])
    .filter((t) => t.type === 'identifier'),
  fc
    .string({ minLength: 1, size: 'small' })
    .map((s) => parseToken(s)[1])
    .filter((t) => t.type === 'number'),
  fc
    .string({ minLength: 1, size: 'small' })
    .map((s) => parseToken(s)[1])
    .filter((t) => t.type === 'string')
);

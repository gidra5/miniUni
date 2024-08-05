import { SystemError } from './error.js';
import {
  position as _position,
  indexPosition,
  type Position,
} from './position.js';

export const symbols = [
  '::',
  '<-',
  '?<-',
  '<-?',
  '->',
  '--',
  '++',
  '+=',
  '//',
  '/*',
  '*/',
  '!=',
  '==',
  '>=',
  '<=',
  ':=',
  '===',
  '!==',
  '...',
];

// Sort symbols by length in descending order
symbols.sort((a, b) => b.length - a.length);

export type Token =
  | { type: 'error'; src: string; cause: SystemError }
  | { type: 'placeholder'; src: string }
  | { type: 'identifier' | 'newline'; src: string }
  | { type: 'number'; src: string; value: number }
  | { type: 'string'; src: string; value: string };
export type TokenPos = Token & Position;

export const identifier = (src: string, pos: Position): TokenPos => ({
  type: 'identifier',
  src,
  ...pos,
});
export const newline = (src: string, pos: Position): TokenPos => ({
  type: 'newline',
  src,
  ...pos,
});
export const number = (
  src: string,
  pos: Position,
  value: number
): TokenPos => ({ type: 'number', src, value, ...pos });
export const string = (
  src: string,
  pos: Position,
  value: string
): TokenPos => ({ type: 'string', src, value, ...pos });
export const error = (
  cause: SystemError,
  pos: Position,
  src = ''
): TokenPos => ({ type: 'error', cause, src, ...pos });
export const placeholder = (src: string, pos: Position): TokenPos => ({
  type: 'placeholder',
  src,
  ...pos,
});

export const parseBlockComment = (src: string, i: number): number => {
  let index = i;
  while (src.charAt(index) && !src.startsWith('*/', index)) {
    index++;
  }
  return index + 2;
};

export const parseToken = (
  src: string,
  i = 0
): [index: number, result: TokenPos] => {
  let index = i;

  if (!src.charAt(index)) {
    return [index, error(SystemError.endOfSource(), indexPosition(index))];
  }
  const tokenSrc = (start: number) => src.substring(start, index);
  const position = (start: number) => _position(start, index);

  let isNewline = false;
  while (true) {
    if (src.startsWith('/*', index)) {
      index += 2;
      index = parseBlockComment(src, index);
      continue;
    }

    if (/\s/.test(src.charAt(index))) {
      if (src.charAt(index) === '\n') isNewline = true;
      index++;
      continue;
    }

    if (src.startsWith('//', index)) {
      index += 2;
      while (src.charAt(index) && src.charAt(index) !== '\n') {
        index++;
      }
      index++;
      isNewline = true;
      continue;
    }

    break;
  }

  if (isNewline) {
    return [index, newline(tokenSrc(i), position(i))];
  }

  if (src.charAt(index) === '"') {
    const start = index;
    index++;

    let value = '';
    while (src.charAt(index) !== '"') {
      if (!src.charAt(index)) {
        const pos = position(start);
        const token = error(
          SystemError.unterminatedString(pos),
          pos,
          tokenSrc(start)
        );
        return [index, token];
      }

      // escape characters
      if (src.charAt(index) === '\\') {
        index++;

        if (!src.charAt(index)) continue;

        if (src.charAt(index) === 'n') value += '\n';
        else if (src.charAt(index) === 't') value += '\t';
        else if (src.charAt(index) === 'r') value += '\r';
        else if (src.charAt(index) === '0') value += '\0';
        else value += src.charAt(index);

        index++;
        continue;
      }

      value += src.charAt(index);
      index++;
    }
    index++;

    return [index, string(tokenSrc(start), position(start), value)];
  }

  if (src.startsWith('0x', index)) {
    const start = index;
    index += 2;

    if (!/[0-9a-fA-F]/.test(src.charAt(index))) {
      while (/[0-9a-fA-F_]/.test(src.charAt(index))) index++;

      const pos = position(start);
      const token = error(
        SystemError.invalidHexLiteral(pos),
        pos,
        tokenSrc(start)
      );
      return [index, token];
    }

    let value = '0x';
    while (/[0-9a-fA-F_]/.test(src.charAt(index))) {
      if (src.charAt(index) !== '_') value += src.charAt(index);
      index++;
    }

    const token = number(tokenSrc(start), position(start), Number(value));
    return [index, token];
  }

  if (src.startsWith('0o', index)) {
    const start = index;
    index += 2;

    if (!/[0-7]/.test(src.charAt(index))) {
      while (/[0-7_]/.test(src.charAt(index))) index++;

      const pos = position(start);
      const token = error(
        SystemError.invalidOctalLiteral(pos),
        pos,
        tokenSrc(start)
      );
      return [index, token];
    }

    let value = '0o';
    while (/[0-7_]/.test(src.charAt(index))) {
      if (src.charAt(index) !== '_') value += src.charAt(index);
      index++;
    }

    const token = number(tokenSrc(start), position(start), Number(value));
    return [index, token];
  }

  if (src.startsWith('0b', index)) {
    const start = index;
    index += 2;

    if (!/[0-1]/.test(src.charAt(index))) {
      while (/[0-1_]/.test(src.charAt(index))) index++;

      const pos = position(start);
      const token = error(
        SystemError.invalidBinaryLiteral(pos),
        pos,
        tokenSrc(start)
      );
      return [index, token];
    }

    let value = '0b';
    while (/[0-1_]/.test(src.charAt(index))) {
      if (src.charAt(index) !== '_') value += src.charAt(index);
      index++;
    }

    const token = number(tokenSrc(start), position(start), Number(value));
    return [index, token];
  }

  if (/\d/.test(src.charAt(index))) {
    const start = index;

    let value = '';
    while (/[_\d]/.test(src.charAt(index))) {
      while (src.charAt(index) === '_') {
        index++;
      }
      value += src.charAt(index);
      index++;
    }
    if (src.charAt(index) === '.') value += src.charAt(index++);
    if (/\d/.test(src.charAt(index))) {
      value += src.charAt(index);
      index++;
      while (/[_\d]/.test(src.charAt(index))) {
        while (src.charAt(index) === '_') {
          index++;
        }
        value += src.charAt(index);
        index++;
      }
    }

    const token = number(tokenSrc(start), position(start), Number(value));
    return [index, token];
  }

  if (/[a-zA-Z_]/.test(src.charAt(index))) {
    const start = index;
    while (/\w/.test(src.charAt(index))) index++;

    const ident = tokenSrc(start);
    if (/^[_]+$/.test(ident))
      return [index, placeholder(ident, position(start))];
    return [index, identifier(ident, position(start))];
  }

  if (src.charAt(index) === '.' && /\d/.test(src.charAt(index + 1))) {
    const start = index;
    index++;
    let value = '0.';
    while (/[_\d]/.test(src.charAt(index))) {
      while (src.charAt(index) === '_') {
        index++;
      }
      value += src.charAt(index);
      index++;
    }

    const token = number(tokenSrc(start), position(start), Number(value));
    return [index, token];
  }

  const start = index;
  const ident =
    symbols.filter((symbol) => src.startsWith(symbol, start))[0] ||
    src.charAt(index);
  index += ident.length;

  return [index, identifier(ident, position(start))];
};

export const parseTokens = (src: string, i = 0): TokenPos[] => {
  let index = i;
  const tokens: TokenPos[] = [];

  while (src.charAt(index)) {
    const [nextIndex, token] = parseToken(src, index);

    index = nextIndex;
    tokens.push(token);
  }

  return tokens;
};

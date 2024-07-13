import { parseTokens } from './tokens';

export const evaluateString = async (input: string, context: unknown = {}) => {
  const tokens = parseTokens(input);
  throw new Error('Not implemented');
};

import { Position } from './position.js';
import { assert } from './utils.js';

export type EvalFunction = (
  arg: EvalValue,
  callSite: [Position, number]
) => Promise<EvalValue>;
export type EvalValue =
  | number
  | string
  | boolean
  | null
  | EvalValue[]
  | EvalFunction
  | { symbol: symbol }
  | { record: Record<string, EvalValue> }
  | { channel: symbol };
type Channel = {
  closed?: boolean;
  queue: (EvalValue | Error)[];
  onReceive: Array<{
    resolve: (v: EvalValue) => void;
    reject: (e: unknown) => void;
  }>;
};

export const fn = (
  n: number,
  f: (
    callSite: [Position, number],
    ...args: EvalValue[]
  ) => EvalValue | Promise<EvalValue>
): EvalFunction => {
  return async (arg, callSite) => {
    if (n === 1) return await f(callSite, arg);
    return fn(n - 1, async (callSite, ...args) => f(callSite, arg, ...args));
  };
};

const atoms = new Map<string, symbol>();

export const symbol = (): { symbol: symbol } => ({ symbol: Symbol() });
export const atom = (name: string): { symbol: symbol } => {
  if (!atoms.has(name)) atoms.set(name, Symbol(name));
  return { symbol: atoms.get(name)! };
};

export function isChannel(
  channelValue: EvalValue
): channelValue is { channel: symbol } {
  return (
    !!channelValue &&
    typeof channelValue === 'object' &&
    'channel' in channelValue
  );
}

export function isRecord(
  recordValue: EvalValue
): recordValue is { record: Record<string, EvalValue> } {
  return (
    !!recordValue && typeof recordValue === 'object' && 'record' in recordValue
  );
}

export function isSymbol(
  symbolValue: EvalValue
): symbolValue is { symbol: symbol } {
  return (
    !!symbolValue && typeof symbolValue === 'object' && 'symbol' in symbolValue
  );
}

const channels: Record<symbol, Channel> = {};

export const createChannel = (name?: string) => {
  const channel = Symbol(name);
  channels[channel] = {
    closed: false,
    queue: [],
    onReceive: [],
  };
  return { channel };
};

export const closeChannel = (c: symbol) => {
  const channel = channels[c];
  assert(channel, 'channel already closed');
  if (channel.queue.length === 0 && channel.onReceive.length === 0) {
    delete channels[c];
  } else {
    channel.closed = true;
  }
};

export const getChannel = (c: symbol) => {
  assert(c in channels, 'channel closed');
  const channel = channels[c];
  return channel;
};

export const send = (_channel: symbol, value: EvalValue | Error) => {
  const channel = getChannel(_channel);
  const promise = channel.onReceive.shift();
  if (promise) {
    const { resolve, reject } = promise;
    if (value instanceof Error) reject(value);
    else resolve(value);
  } else channel.queue.push(value);
};

export const receive = (_channel: symbol) => {
  const channel = getChannel(_channel);

  if (channel.queue.length > 0) {
    const next = channel.queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }

  return new Promise<EvalValue>((resolve, reject) => {
    channel.onReceive.push({ resolve, reject });
  });
};

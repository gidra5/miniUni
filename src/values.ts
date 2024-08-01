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

export const createChannel = () => {
  const channel = Symbol();
  channels[channel] = {
    queue: [],
    onReceive: [],
  };
  return { channel };
};

export const getChannel = (c: EvalValue) => {
  assert(isChannel(c), 'not a channel');
  assert(c.channel in channels, 'channel closed');
  const channel = channels[c.channel];
  return channel;
};

export const send = (_channel: EvalValue, value: EvalValue | Error) => {
  const channel = getChannel(_channel);
  const promise = channel.onReceive.shift();
  if (promise) {
    const { resolve, reject } = promise;
    if (value instanceof Error) reject(value);
    else resolve(value);

    channel.onReceive = channel.onReceive.filter(
      (_promise) => _promise !== promise
    );
  } else channel.queue.push(value);
};

export const receive = (_channel: EvalValue) => {
  const channel = getChannel(_channel);

  if (channel.queue.length > 0) {
    const next = channel.queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }

  return new Promise<EvalValue>((resolve, reject) => {
    const promise = {
      resolve: (v: EvalValue) => {
        resolve(v);
        channel.onReceive = channel.onReceive.filter(
          (_promise) => _promise !== promise
        );
      },

      reject: (e: unknown) => {
        reject(e);
        channel.onReceive = channel.onReceive.filter(
          (_promise) => _promise !== promise
        );
      },
    };

    channel.onReceive.push(promise);
  });
};

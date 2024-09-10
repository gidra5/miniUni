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

type ChannelReceiver = {
  resolve: (v: EvalValue | null) => void;
  reject: (e: unknown) => void;
};
type Channel = {
  closed?: boolean;
  queue: (EvalValue | Error)[];
  onReceive: Array<ChannelReceiver>;
};
export enum ChannelStatus {
  Empty = 'empty',
  Pending = 'pending',
  Queued = 'queued',
  Closed = 'closed',
}

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

const channelStatus = (c: symbol): ChannelStatus => {
  const channel = channels[c];
  if (!channel) {
    return ChannelStatus.Closed;
  }

  while (channel.onReceive.length > 0 && channel.queue.length > 0) {
    const receiver = channel.onReceive.shift()!;
    const value = channel.queue.shift()!;
    if (value instanceof Error) {
      receiver.reject(value);
    } else {
      receiver.resolve(value);
    }
  }

  if (channel.queue.length > 0) {
    return ChannelStatus.Pending;
  }

  if (channel.onReceive.length > 0) {
    return ChannelStatus.Queued;
  }

  if (channel.closed) {
    delete channels[c];
    return ChannelStatus.Closed;
  }

  return ChannelStatus.Empty;
};

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
  if (!channel || channel.closed) throw 'channel closed';
  if (channel.queue.length === 0 && channel.onReceive.length === 0) {
    delete channels[c];
  } else {
    channel.closed = true;
  }
};

export const getChannel = (c: symbol) => {
  return channels[c];
};

export const send = (c: symbol, value: EvalValue | Error): ChannelStatus => {
  const status = channelStatus(c);

  if (status === ChannelStatus.Queued) {
    const receiver = channels[c].onReceive.shift()!;
    if (value instanceof Error) receiver.reject(value);
    else receiver.resolve(value);
  }

  if (status !== ChannelStatus.Closed) {
    channels[c].queue.push(value);
  } else {
    throw 'channel closed';
  }

  return status;
};

export const receive = async (c: symbol): Promise<EvalValue> => {
  const [value, status] = tryReceive(c);
  if (status === ChannelStatus.Pending) {
    if (value instanceof Error) throw value;
    return value;
  }
  if (status === ChannelStatus.Closed) throw 'channel closed';

  return new Promise((resolve, reject) => {
    channels[c].onReceive.push({ resolve, reject });
  });
};

export const tryReceive = (c: symbol): [EvalValue | Error, ChannelStatus] => {
  const status = channelStatus(c);

  if (status === ChannelStatus.Pending) {
    const value = channels[c].queue.shift()!;
    return [value, status];
  }

  return [null, status];
};

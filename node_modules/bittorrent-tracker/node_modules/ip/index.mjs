import ip from './lib/ip.js';

export default ip;

export const {
  toBuffer,
  toString,
  isV4Format,
  isV6Format,
  isValid,
  fromPrefixLen,
  mask,
  cidr,
  subnet,
  cidrSubnet,
  not,
  or,
  isEqual,
  isPrivate,
  isPublic,
  isLoopback,
  loopback,
  address,
  toLong,
  fromLong,
  normalizeToLong,
} = ip;

/// <reference types="node" />

import { Buffer } from 'buffer';

export interface SubnetInfo {
  networkAddress: string;
  firstAddress: string;
  lastAddress: string;
  broadcastAddress: string;
  subnetMask: string;
  subnetMaskLength: number;
  numHosts: number;
  length: number;
  contains(other: string): boolean;
}

export type IpFamily = 'ipv4' | 'ipv6' | 'IPv4' | 'IPv6' | 4 | 6;

export function toBuffer(addr: string, buff?: Buffer, offset?: number): Buffer;
export function toString(buff: Buffer, offset?: number, length?: number): string;
export function isV4Format(addr: string): boolean;
export function isV6Format(addr: string): boolean;
export function isValid(addr: string): boolean;
export function fromPrefixLen(prefixlen: number, family?: IpFamily): string;
export function mask(addr: string, mask: string): string;
export function cidr(cidrString: string): string;
export function subnet(addr: string, mask: string): SubnetInfo;
export function cidrSubnet(cidrString: string): SubnetInfo;
export function not(addr: string): string;
export function or(a: string, b: string): string;
export function isEqual(a: string, b: string): boolean;
export function isPrivate(addr: string): boolean;
export function isPublic(addr: string): boolean;
export function isLoopback(addr: string): boolean;
export function loopback(family?: IpFamily): string;
export function address(name?: 'public' | 'private' | string, family?: IpFamily): string | undefined;
export function toLong(addr: string): number;
export function fromLong(ipl: number): string;
export function normalizeToLong(addr: string): number;

declare const ip: {
  toBuffer: typeof toBuffer;
  toString: typeof toString;
  isV4Format: typeof isV4Format;
  isV6Format: typeof isV6Format;
  isValid: typeof isValid;
  fromPrefixLen: typeof fromPrefixLen;
  mask: typeof mask;
  cidr: typeof cidr;
  subnet: typeof subnet;
  cidrSubnet: typeof cidrSubnet;
  not: typeof not;
  or: typeof or;
  isEqual: typeof isEqual;
  isPrivate: typeof isPrivate;
  isPublic: typeof isPublic;
  isLoopback: typeof isLoopback;
  loopback: typeof loopback;
  address: typeof address;
  toLong: typeof toLong;
  fromLong: typeof fromLong;
  normalizeToLong: typeof normalizeToLong;
};

export default ip;

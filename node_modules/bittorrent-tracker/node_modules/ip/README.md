# @bybrave/ip2

[![CI](https://github.com/bybraveHQ/ip2/actions/workflows/ci.yml/badge.svg)](https://github.com/bybraveHQ/ip2/actions)
[![npm](https://img.shields.io/npm/v/%40bybrave%2Fip2)](https://www.npmjs.com/package/@bybrave/ip2)

Maintained fork of [`ip`](https://github.com/indutny/node-ip) — IP address utilities for Node.js — with the **unpatched SSRF advisory fixed**.

The original package has ~38M downloads/month, no release since February 2024, and a HIGH-severity advisory ([CVE-2024-29415](https://nvd.nist.gov/vuln/detail/CVE-2024-29415) / [GHSA-2p57-rm9w-gvfp](https://github.com/advisories/GHSA-2p57-rm9w-gvfp)) that affects **every published version** and makes `npm audit` fail on every install. This fork fixes the root cause instead of patching regexes.

```bash
npm install @bybrave/ip2
```

```js
// CommonJS — drop-in
const ip = require('@bybrave/ip2');

// ESM — named imports
import { isPrivate, isPublic, cidrSubnet } from '@bybrave/ip2';

// TypeScript types built in
```

## The vulnerability, and how it is fixed

The original `isPrivate()` / `isPublic()` / `isLoopback()` ran regexes over the **raw input string**. Any spelling of an address the regexes didn't anticipate — octal or hex octets, abbreviated IPv4, uncompressed IPv6 — was silently classified as *public*:

```js
// original ip@2.0.1 — all of these are loopback/private, all reported PUBLIC:
ip.isPublic('127.1')            // true 💥
ip.isPublic('012.1.2.3')        // true 💥  (octal 10.1.2.3)
ip.isPublic('01200034567')      // true 💥  (integer 10.0.14.119)
ip.isPublic('000:0:0000::01')   // true 💥  (that's ::1)
```

If those answers guard outgoing requests, that's an SSRF hole (CVE-2024-29415, incomplete fix of CVE-2023-42282).

**This fork:**

1. **Parses first, classifies second.** Every classification function parses the address into bytes with a strict parser (same grammar as `net.isIP`, plus IPv6 zone IDs). Classification runs on bytes, never on strings.
2. **Rejects ambiguous input.** Non-canonical spellings (`127.1`, `0x7f.1`, `0177.0.0.1`, `2130706433`) **throw** instead of being guessed at. Fail closed, not open. If you need to accept legacy notations, normalize explicitly first: `ip.fromLong(ip.normalizeToLong(addr))`.
3. **Covers the full IANA special-purpose registries** ([IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml), [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)), not four regexes. `isPrivate()` now means "not globally reachable" — the same convention as Python's `ipaddress`. That adds CGNAT (`100.64/10`), TEST-NETs, benchmarking, multicast, reserved, ULA, documentation ranges and more — see the table below.
4. **Classifies transition addresses by their embedded IPv4.** `::ffff:a.b.c.d` (v4-mapped), `64:ff9b::a.b.c.d` (NAT64) and `2002:xxxx:xxxx::` (6to4) are private/public according to the IPv4 address inside them.

```js
// @bybrave/ip2
ip.isPublic('127.1')             // throws Error: Invalid ip address: 127.1
ip.isPrivate('000:0:0000::01')   // true (parsed as ::1)
ip.isLoopback('::fFFf:127.0.0.1')// true
ip.isPublic('64:ff9b::8.8.8.8')  // true  (NAT64 of a public address)
ip.isPrivate('100.64.0.1')       // true  (CGNAT — original said public)
```

## All fixes over `ip@2.0.1`

| Fixed | Original issue |
|---|---|
| CVE-2024-29415 / GHSA-2p57-rm9w-gvfp — SSRF via non-canonical addresses | [#136](https://github.com/indutny/node-ip/issues/136), [#150](https://github.com/indutny/node-ip/issues/150), [#153](https://github.com/indutny/node-ip/issues/153), [#158](https://github.com/indutny/node-ip/issues/158) |
| `isPrivate()` misses CGNAT, TEST-NETs, benchmarking, multicast, reserved, documentation ranges | — |
| `cidrSubnet(...).contains()` returns `false` for IPv4-mapped IPv6 addresses | [#104](https://github.com/indutny/node-ip/issues/104) |
| `isV6Format()` returns `true` for IPv4 addresses | [#67](https://github.com/indutny/node-ip/issues/67) |
| `isV4Format()` accepts octets ≥ 256 | [#105](https://github.com/indutny/node-ip/issues/105) |
| `address('public')` returned *private* addresses and vice versa (filter was inverted) | — |
| `loopback('ipv6')` returned `fe80::1`, which is link-local, not loopback → now `::1` | — |
| `cidr()`/`cidrSubnet()` silently produced garbage for invalid prefix lengths (`/33`, `/x`) → now throw | — |
| `address(name)` crashed with `TypeError` for unknown interface names → now returns `undefined` | — |
| TypeScript types built in (no `@types/ip` needed), ESM named exports | — |

## Breaking changes (v3)

Version 3.0.0 because strictness is the fix — if you fed this library non-canonical strings, v2 was giving you wrong answers, not compatible ones:

- `isPrivate` / `isPublic` / `isLoopback` / `toBuffer` / `toLong` **throw** on malformed or non-canonical input (octal/hex octets, `127.1`, integer strings). Use `normalizeToLong()` first if you must accept legacy notations.
- `isLoopback('fe80::1')` is now `false` (link-local ≠ loopback; still `isPrivate`). `isLoopback('::')` is now `false` (unspecified ≠ loopback; still `isPrivate`).
- `loopback('ipv6')` returns `'::1'` instead of `'fe80::1'`.
- `isPrivate()` returns `true` for more ranges (CGNAT, TEST-NETs, multicast, …) — it now means "not globally reachable".
- `address('public')` actually returns public addresses now. If you relied on the inverted behaviour to get a LAN address, use `address('private')` — that's what it was giving you.
- Node.js ≥ 18.

## API

Everything the original exports, plus `isValid()`:

```js
ip.address('public', 'ipv6')          // address of a network interface
ip.isPrivate('10.0.0.1')              // true — not globally reachable
ip.isPublic('8.8.8.8')                // true
ip.isLoopback('127.8.8.8')            // true
ip.isValid('300.1.2.3')               // false (never throws)
ip.isV4Format('192.168.0.1')          // true
ip.isV6Format('2001:db8::1')          // true
ip.isEqual('::ffff:7f00:1', '127.0.0.1') // true

ip.toBuffer('127.0.0.1')              // Buffer([127, 0, 0, 1])
ip.toString(buf, offset, length)      // '127.0.0.1'
ip.toLong('127.0.0.1')                // 2130706433
ip.fromLong(2130706433)               // '127.0.0.1'
ip.normalizeToLong('127.1')           // 2130706433 (lenient, -1 on error)

ip.fromPrefixLen(24)                  // '255.255.255.0'
ip.mask('192.168.1.134', '255.255.255.0') // '192.168.1.0'
ip.cidr('192.168.1.134/26')           // '192.168.1.128'
ip.not('255.255.255.0')               // '0.0.0.255'
ip.or('0.0.0.255', '192.168.1.10')    // '192.168.1.255'

const s = ip.cidrSubnet('192.168.1.134/26')
s.networkAddress                      // '192.168.1.128'
s.firstAddress                        // '192.168.1.129'
s.lastAddress                         // '192.168.1.190'
s.broadcastAddress                    // '192.168.1.191'
s.subnetMaskLength                    // 26
s.numHosts                            // 62
s.contains('::ffff:192.168.1.180')    // true (v4-mapped handled)
```

## Ranges treated as private (not globally reachable)

**IPv4:** `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT), `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4` (incl. broadcast).

**IPv6:** `::/96` (unspecified, loopback, v4-compatible), `64:ff9b:1::/48`, `100::/64`, `2001::/23`, `2001:db8::/32`, `3fff::/20`, `5f00::/16`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`. Transition ranges `::ffff:0:0/96`, `64:ff9b::/96` and `2002::/16` follow their embedded IPv4 address.

## Support

If this package saves you time, you can support maintenance:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-buy%20me%20a%20coffee-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/bybrave)
[![Bitcoin](https://img.shields.io/badge/Bitcoin-BTC-F7931A?logo=bitcoin&logoColor=white)](#support)

Bitcoin (BTC): `bc1q37557q5jpeaxqydzwvf3jgj7zhnfpn2td3q40q`

## Credits & license

MIT. Based on [node-ip](https://github.com/indutny/node-ip) by Fedor Indutny.

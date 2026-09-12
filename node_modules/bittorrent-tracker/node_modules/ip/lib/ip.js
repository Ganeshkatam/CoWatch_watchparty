const ip = exports;
const { Buffer } = require('buffer');
const os = require('os');

// --- Strict parsing --------------------------------------------------------
//
// Classification (isPrivate/isPublic/isLoopback) used to run regexes over the
// raw input string, so any non-canonical spelling of an address (octal or hex
// octets, abbreviated IPv4 like `127.1`, long integers, uncompressed IPv6)
// slipped through as "public" — GHSA-2p57-rm9w-gvfp / CVE-2024-29415.
// Everything now goes through a strict parser to bytes; malformed or
// ambiguous input throws instead of being misclassified.

const V4_SEG = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])';
const v4Regex = new RegExp(`^${V4_SEG}(?:\\.${V4_SEG}){3}$`);

function parseV4(addr) {
  if (typeof addr !== 'string' || !v4Regex.test(addr)) {
    return null;
  }
  const bytes = Buffer.alloc(4);
  const octets = addr.split('.');
  for (let i = 0; i < 4; i++) {
    bytes[i] = parseInt(octets[i], 10);
  }
  return bytes;
}

const v6GroupRegex = /^[0-9a-f]{1,4}$/i;

function parseV6(addr) {
  if (typeof addr !== 'string') {
    return null;
  }

  let s = addr;
  let zone = null;
  const pct = s.indexOf('%');
  if (pct !== -1) {
    zone = s.slice(pct + 1);
    s = s.slice(0, pct);
    if (zone === '') {
      return null;
    }
  }

  const parts = s.split('::');
  if (parts.length > 2) {
    return null;
  }
  const hasGap = parts.length === 2;

  const head = parts[0] === '' ? [] : parts[0].split(':');
  const tail = hasGap && parts[1] !== '' ? parts[1].split(':') : [];

  // An embedded IPv4 address may only be the last group (last 32 bits)
  const groups = hasGap ? tail : head;
  let v4bytes = null;
  if (groups.length && groups[groups.length - 1].includes('.')) {
    v4bytes = parseV4(groups[groups.length - 1]);
    if (!v4bytes) {
      return null;
    }
    groups.pop();
  }

  const wordCount = head.length + tail.length + (v4bytes ? 2 : 0);
  if (hasGap ? wordCount > 7 : wordCount !== 8) {
    return null;
  }

  for (const g of head) {
    if (!v6GroupRegex.test(g)) return null;
  }
  for (const g of tail) {
    if (!v6GroupRegex.test(g)) return null;
  }

  const bytes = Buffer.alloc(16);
  let off = 0;
  for (const g of head) {
    const word = parseInt(g, 16);
    bytes[off++] = word >> 8;
    bytes[off++] = word & 0xff;
  }
  if (hasGap) {
    off = 16 - (tail.length * 2) - (v4bytes ? 4 : 0);
    for (const g of tail) {
      const word = parseInt(g, 16);
      bytes[off++] = word >> 8;
      bytes[off++] = word & 0xff;
    }
  }
  if (v4bytes) {
    v4bytes.copy(bytes, 12);
  }

  return { bytes, zone };
}

function parse(addr) {
  const v4 = parseV4(addr);
  if (v4) {
    return { family: 4, bytes: v4 };
  }
  const v6 = parseV6(addr);
  if (v6) {
    return { family: 6, bytes: v6.bytes, zone: v6.zone };
  }
  return null;
}

function invalid(addr) {
  return new Error(`Invalid ip address: ${addr}`);
}

function allZero(bytes, from, to) {
  for (let i = from; i <= to; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function isV4MappedBytes(bytes) {
  return allZero(bytes, 0, 9) && bytes[10] === 0xff && bytes[11] === 0xff;
}

function embeddedV4String(bytes, offset) {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

// --- Format checks ---------------------------------------------------------

ip.isV4Format = function (addr) {
  return parseV4(addr) !== null;
};

ip.isV6Format = function (addr) {
  return parseV6(addr) !== null;
};

ip.isValid = function (addr) {
  return parse(addr) !== null;
};

// --- Conversion ------------------------------------------------------------

ip.toBuffer = function (addr, buff, offset) {
  offset = ~~offset;

  const parsed = parse(addr);
  if (!parsed) {
    throw invalid(addr);
  }

  const result = buff || Buffer.alloc(offset + parsed.bytes.length);
  parsed.bytes.copy(result, offset);
  return result;
};

ip.toString = function (buff, offset, length) {
  offset = ~~offset;
  length = length || (buff.length - offset);

  let result = [];
  if (length === 4) {
    // IPv4
    for (let i = 0; i < length; i++) {
      result.push(buff[offset + i]);
    }
    result = result.join('.');
  } else if (length === 16) {
    // IPv6
    for (let i = 0; i < length; i += 2) {
      result.push(buff.readUInt16BE(offset + i).toString(16));
    }
    result = result.join(':');
    result = result.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3');
    result = result.replace(/:{3,4}/, '::');
  } else {
    throw new Error(`Invalid buffer length: ${length} (expected 4 or 16)`);
  }

  return result;
};

function _normalizeFamily(family) {
  if (family === 4) {
    return 'ipv4';
  }
  if (family === 6) {
    return 'ipv6';
  }
  return family ? family.toLowerCase() : 'ipv4';
}

ip.fromPrefixLen = function (prefixlen, family) {
  if (!Number.isInteger(prefixlen) || prefixlen < 0 || prefixlen > 128) {
    throw new Error(`invalid prefix length: ${prefixlen}`);
  }

  if (prefixlen > 32) {
    family = 'ipv6';
  } else {
    family = _normalizeFamily(family);
  }

  let len = 4;
  if (family === 'ipv6') {
    len = 16;
  }
  const buff = Buffer.alloc(len);

  for (let i = 0, n = buff.length; i < n; ++i) {
    let bits = 8;
    if (prefixlen < 8) {
      bits = prefixlen;
    }
    prefixlen -= bits;

    buff[i] = ~(0xff >> bits) & 0xff;
  }

  return ip.toString(buff);
};

ip.mask = function (addr, mask) {
  addr = ip.toBuffer(addr);
  mask = ip.toBuffer(mask);

  const result = Buffer.alloc(Math.max(addr.length, mask.length));

  // Same protocol - do bitwise and
  let i;
  if (addr.length === mask.length) {
    for (i = 0; i < addr.length; i++) {
      result[i] = addr[i] & mask[i];
    }
  } else if (mask.length === 4) {
    // IPv6 address and IPv4 mask
    // (Mask low bits)
    for (i = 0; i < mask.length; i++) {
      result[i] = addr[addr.length - 4 + i] & mask[i];
    }
  } else {
    // IPv6 mask and IPv4 addr
    for (i = 0; i < result.length - 6; i++) {
      result[i] = 0;
    }

    // ::ffff:ipv4
    result[10] = 0xff;
    result[11] = 0xff;
    for (i = 0; i < addr.length; i++) {
      result[i + 12] = addr[i] & mask[i + 12];
    }
    i += 12;
  }
  for (; i < result.length; i++) {
    result[i] = 0;
  }

  return ip.toString(result);
};

function splitCidr(cidrString) {
  const parts = cidrString.split('/');
  if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) {
    throw new Error(`invalid CIDR subnet: ${cidrString}`);
  }

  const addr = parts[0];
  const parsed = parse(addr);
  if (!parsed) {
    throw invalid(addr);
  }

  const prefixLen = parseInt(parts[1], 10);
  const max = parsed.family === 4 ? 32 : 128;
  if (prefixLen > max) {
    throw new Error(`invalid CIDR subnet: ${cidrString} (prefix length above /${max})`);
  }

  return {
    addr,
    mask: ip.fromPrefixLen(prefixLen, parsed.family === 6 ? 'ipv6' : 'ipv4'),
  };
}

ip.cidr = function (cidrString) {
  const { addr, mask } = splitCidr(cidrString);
  return ip.mask(addr, mask);
};

ip.subnet = function (addr, mask) {
  const parsed = parse(addr);
  if (!parsed) {
    throw invalid(addr);
  }

  // subnet math is IPv4-only; accept IPv4-mapped IPv6 as its embedded IPv4
  let v4addr = addr;
  if (parsed.family === 6) {
    if (!isV4MappedBytes(parsed.bytes)) {
      throw new Error(`subnet() supports IPv4 addresses only, got: ${addr}`);
    }
    v4addr = embeddedV4String(parsed.bytes, 12);
  }

  const networkAddress = ip.toLong(ip.mask(v4addr, mask));

  // Calculate the mask's length.
  const maskBuffer = ip.toBuffer(mask);
  let maskLength = 0;

  for (let i = 0; i < maskBuffer.length; i++) {
    if (maskBuffer[i] === 0xff) {
      maskLength += 8;
    } else {
      let octet = maskBuffer[i] & 0xff;
      while (octet) {
        octet = (octet << 1) & 0xff;
        maskLength++;
      }
    }
  }

  const numberOfAddresses = 2 ** (32 - maskLength);

  return {
    networkAddress: ip.fromLong(networkAddress),
    firstAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress)
      : ip.fromLong(networkAddress + 1),
    lastAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress + numberOfAddresses - 1)
      : ip.fromLong(networkAddress + numberOfAddresses - 2),
    broadcastAddress: ip.fromLong(networkAddress + numberOfAddresses - 1),
    subnetMask: mask,
    subnetMaskLength: maskLength,
    numHosts: numberOfAddresses <= 2
      ? numberOfAddresses : numberOfAddresses - 2,
    length: numberOfAddresses,
    contains(other) {
      const p = parse(other);
      if (!p) {
        return false;
      }
      let target = other;
      if (p.family === 6) {
        if (!isV4MappedBytes(p.bytes)) {
          return false;
        }
        target = embeddedV4String(p.bytes, 12);
      }
      return networkAddress === ip.toLong(ip.mask(target, mask));
    },
  };
};

ip.cidrSubnet = function (cidrString) {
  const { addr, mask } = splitCidr(cidrString);
  return ip.subnet(addr, mask);
};

ip.not = function (addr) {
  const buff = ip.toBuffer(addr);
  for (let i = 0; i < buff.length; i++) {
    buff[i] = 0xff ^ buff[i];
  }
  return ip.toString(buff);
};

ip.or = function (a, b) {
  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // same protocol
  if (a.length === b.length) {
    for (let i = 0; i < a.length; ++i) {
      a[i] |= b[i];
    }
    return ip.toString(a);

  // mixed protocols
  }
  let buff = a;
  let other = b;
  if (b.length > a.length) {
    buff = b;
    other = a;
  }

  const offset = buff.length - other.length;
  for (let i = offset; i < buff.length; ++i) {
    buff[i] |= other[i - offset];
  }

  return ip.toString(buff);
};

ip.isEqual = function (a, b) {
  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // Same protocol
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Swap
  if (b.length === 4) {
    const t = b;
    b = a;
    a = t;
  }

  // a - IPv4, b - IPv6
  for (let i = 0; i < 10; i++) {
    if (b[i] !== 0) return false;
  }

  const word = b.readUInt16BE(10);
  if (word !== 0 && word !== 0xffff) return false;

  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i + 12]) return false;
  }

  return true;
};

// --- Classification --------------------------------------------------------
//
// "Private" here means "not globally reachable" per the IANA special-purpose
// address registries (RFC 6890 and successors), the same convention as
// Python's ipaddress.is_global. Ranges whose reachability depends on an
// embedded IPv4 address (v4-mapped, NAT64, 6to4) are classified by that
// embedded address.

const V4_NONGLOBAL_RANGES = [
  [0x00000000, 0xff000000], // 0.0.0.0/8       "this network"
  [0x0a000000, 0xff000000], // 10.0.0.0/8      private
  [0x64400000, 0xffc00000], // 100.64.0.0/10   CGNAT
  [0x7f000000, 0xff000000], // 127.0.0.0/8     loopback
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16  link-local
  [0xac100000, 0xfff00000], // 172.16.0.0/12   private
  [0xc0000000, 0xffffff00], // 192.0.0.0/24    IETF protocol assignments
  [0xc0000200, 0xffffff00], // 192.0.2.0/24    TEST-NET-1
  [0xc0586300, 0xffffff00], // 192.88.99.0/24  6to4 relay anycast (deprecated)
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16  private
  [0xc6120000, 0xfffe0000], // 198.18.0.0/15   benchmarking
  [0xc6336400, 0xffffff00], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 0xffffff00], // 203.0.113.0/24  TEST-NET-3
  [0xe0000000, 0xf0000000], // 224.0.0.0/4     multicast
  [0xf0000000, 0xf0000000], // 240.0.0.0/4     reserved + broadcast
];

function v4IsNonGlobal(bytes, offset) {
  const long = bytes.readUInt32BE(offset || 0);
  return V4_NONGLOBAL_RANGES.some(
    ([base, mask]) => ((long & mask) >>> 0) === base,
  );
}

function v6IsNonGlobal(bytes) {
  const b0 = bytes[0];
  const b1 = bytes[1];

  // ff00::/8 multicast
  if (b0 === 0xff) return true;
  // fe80::/10 link-local, fec0::/10 site-local (deprecated)
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true;
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true;
  // fc00::/7 unique local
  if ((b0 & 0xfe) === 0xfc) return true;
  // ::ffff:0:0/96 IPv4-mapped — classify by the embedded IPv4 address
  if (isV4MappedBytes(bytes)) return v4IsNonGlobal(bytes, 12);
  // ::/96 — unspecified, loopback, IPv4-compatible (deprecated); never routed
  if (allZero(bytes, 0, 11)) return true;
  if (b0 === 0x00 && b1 === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    // 64:ff9b::/96 NAT64 — classify by the embedded IPv4 address
    if (allZero(bytes, 4, 11)) return v4IsNonGlobal(bytes, 12);
    // 64:ff9b:1::/48 local-use NAT64
    if (bytes[4] === 0x00 && bytes[5] === 0x01) return true;
  }
  // 100::/64 discard-only
  if (b0 === 0x01 && b1 === 0x00 && allZero(bytes, 2, 7)) return true;
  // 2001::/23 IETF protocol assignments (Teredo, ORCHID, benchmarking)
  if (b0 === 0x20 && b1 === 0x01 && (bytes[2] & 0xfe) === 0x00) return true;
  // 2001:db8::/32 documentation
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true;
  }
  // 2002::/16 6to4 — classify by the embedded IPv4 address
  if (b0 === 0x20 && b1 === 0x02) return v4IsNonGlobal(bytes, 2);
  // 3fff::/20 documentation (RFC 9637)
  if (b0 === 0x3f && b1 === 0xff && (bytes[2] & 0xf0) === 0x00) return true;
  // 5f00::/16 SRv6 SIDs (RFC 9602)
  if (b0 === 0x5f && b1 === 0x00) return true;

  return false;
}

ip.isPrivate = function (addr) {
  const parsed = parse(addr);
  if (!parsed) {
    throw invalid(addr);
  }
  return parsed.family === 4
    ? v4IsNonGlobal(parsed.bytes)
    : v6IsNonGlobal(parsed.bytes);
};

ip.isPublic = function (addr) {
  return !ip.isPrivate(addr);
};

ip.isLoopback = function (addr) {
  const parsed = parse(addr);
  if (!parsed) {
    throw invalid(addr);
  }

  if (parsed.family === 4) {
    return parsed.bytes[0] === 127;
  }
  if (isV4MappedBytes(parsed.bytes)) {
    return parsed.bytes[12] === 127;
  }
  return allZero(parsed.bytes, 0, 14) && parsed.bytes[15] === 1;
};

ip.loopback = function (family) {
  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  if (family !== 'ipv4' && family !== 'ipv6') {
    throw new Error('family must be ipv4 or ipv6');
  }

  return family === 'ipv4' ? '127.0.0.1' : '::1';
};

//
// ### function address (name, family)
// #### @name {string|'public'|'private'} **Optional** Name or security
//      of the network interface.
// #### @family {ipv4|ipv6} **Optional** IP family of the address (defaults
//      to ipv4).
//
// Returns the address for the network interface on the current system with
// the specified `name`:
//   * String: First `family` address of the interface.
//             If not found see `undefined`.
//   * 'public': the first public ip address of family.
//   * 'private': the first private ip address of family.
//   * undefined: First address with `ipv4` or loopback address `127.0.0.1`.
//
ip.address = function (name, family) {
  const interfaces = os.networkInterfaces();

  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  //
  // If a specific network interface has been named,
  // return the address.
  //
  if (name && name !== 'private' && name !== 'public') {
    const nic = interfaces[name];
    if (!nic) {
      return undefined;
    }
    const res = nic.filter((details) => {
      const itemFamily = _normalizeFamily(details.family);
      return itemFamily === family;
    });
    if (res.length === 0) {
      return undefined;
    }
    return res[0].address;
  }

  const all = Object.keys(interfaces).map((nic) => {
    //
    // Note: name will only be `public` or `private`
    // when this is called.
    //
    const addresses = interfaces[nic].filter((details) => {
      details.family = _normalizeFamily(details.family);
      if (details.family !== family || ip.isLoopback(details.address)) {
        return false;
      } if (!name) {
        return true;
      }

      return name === 'public' ? ip.isPublic(details.address)
        : ip.isPrivate(details.address);
    });

    return addresses.length ? addresses[0].address : undefined;
  }).filter(Boolean);

  return !all.length ? ip.loopback(family) : all[0];
};

ip.toLong = function (addr) {
  const bytes = parseV4(addr);
  if (!bytes) {
    throw invalid(addr);
  }
  return bytes.readUInt32BE(0);
};

ip.fromLong = function (ipl) {
  if (!Number.isInteger(ipl) || ipl < 0 || ipl > 0xffffffff) {
    throw new Error(`Invalid long value: ${ipl}`);
  }
  return (`${ipl >>> 24}.${
    ipl >> 16 & 255}.${
    ipl >> 8 & 255}.${
    ipl & 255}`);
};

// Lenient parser for legacy IPv4 notations (octal/hex octets, abbreviated and
// integer forms). Returns -1 on invalid input, never throws. This is the only
// entry point that accepts non-canonical spellings — classification functions
// intentionally reject them.
ip.normalizeToLong = function (addr) {
  if (typeof addr !== 'string') return -1;

  const parts = addr.split('.').map(part => {
    // Handle hexadecimal format
    if (part.startsWith('0x') || part.startsWith('0X')) {
      if (!/^0[xX][0-9a-fA-F]+$/.test(part)) return NaN;
      return parseInt(part, 16);
    }
    // Handle octal format (strictly digits 0-7 after a leading zero)
    else if (part.startsWith('0') && part !== '0' && /^[0-7]+$/.test(part)) {
      return parseInt(part, 8);
    }
    // Handle decimal format, reject invalid leading zeros
    else if (/^[1-9]\d*$/.test(part) || part === '0') {
      return parseInt(part, 10);
    }
    // Return NaN for invalid formats to indicate parsing failure
    else {
      return NaN;
    }
  });

  if (parts.some(isNaN)) return -1; // Indicate error with -1

  let val = 0;
  const n = parts.length;

  switch (n) {
  case 1:
    val = parts[0];
    break;
  case 2:
    if (parts[0] > 0xff || parts[1] > 0xffffff) return -1;
    val = (parts[0] << 24) | (parts[1] & 0xffffff);
    break;
  case 3:
    if (parts[0] > 0xff || parts[1] > 0xff || parts[2] > 0xffff) return -1;
    val = (parts[0] << 24) | (parts[1] << 16) | (parts[2] & 0xffff);
    break;
  case 4:
    if (parts.some(part => part > 0xff)) return -1;
    val = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
    break;
  default:
    return -1; // Error case
  }

  if (val > 0xffffffff) return -1;

  return val >>> 0;
};

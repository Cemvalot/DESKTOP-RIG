'use strict';

/**
 * Network binding + defense-in-depth IP/origin allowlist per
 * architecture-security.md §3.
 */

const os = require('os');

function ipToLong(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(address) {
  const n = ipToLong(address);
  if (n === null) return false;
  // 10.0.0.0/8
  if ((n & 0xff000000) >>> 0 === (10 << 24) >>> 0) return true;
  // 172.16.0.0/12
  if ((n & 0xfff00000) >>> 0 === (172 << 24 | 16 << 16) >>> 0) return true;
  // 192.168.0.0/16
  if ((n & 0xffff0000) >>> 0 === (192 << 24 | 168 << 16) >>> 0) return true;
  return false;
}

/**
 * Enumerate non-internal IPv4 interfaces in private ranges. Returns
 * [{ address, netmask, cidr, name }].
 */
function getLanInterfaces() {
  const ifaces = os.networkInterfaces();
  const results = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (!isPrivateIPv4(addr.address)) continue; // best-effort VPN/virtual-adapter exclusion backstop
      results.push({ name, address: addr.address, netmask: addr.netmask, cidr: addr.cidr });
    }
  }
  return results;
}

/** Compute [subnetLong, maskLong] for each bound interface, for the allowlist check. */
function computeAllowedSubnets(lanInterfaces) {
  return lanInterfaces.map(({ address, netmask }) => {
    const maskLong = ipToLong(netmask);
    const addrLong = ipToLong(address);
    return { network: (addrLong & maskLong) >>> 0, mask: maskLong };
  });
}

function isAddressAllowed(remoteAddress, allowedSubnets) {
  if (!remoteAddress) return false;
  // Normalize IPv4-mapped IPv6 (::ffff:192.168.1.5) and strip zone id.
  let addr = remoteAddress.replace(/^::ffff:/, '');
  // Loopback is always allowed: it's the same machine (used for local
  // admin/testing/curl verification), strictly more trusted than "same LAN
  // subnet" would be.
  if (addr === '127.0.0.1' || addr === '::1' || addr === 'localhost') return true;
  const n = ipToLong(addr);
  if (n === null) return false; // not IPv4 (e.g. real IPv6 LAN addr) — reject, matches spec's IPv4-focused model
  if (allowedSubnets.length === 0) {
    // Interface enumeration found nothing at startup (§3.1 fallback path):
    // we still bound to 0.0.0.0, so fall back to a broad "any RFC1918
    // private address" check as the app-layer backstop rather than
    // allowing everything.
    return isPrivateIPv4(addr);
  }
  return allowedSubnets.some(({ network, mask }) => (n & mask) >>> 0 === network);
}

/**
 * Express middleware: reject requests whose source IP isn't loopback or in
 * one of the server's bound private LAN subnets, and reject a present
 * Origin header that doesn't match the expected scheme+host+port.
 */
function buildNetworkGuardMiddleware({ allowedSubnets, expectedOrigins, logger }) {
  return (req, res, next) => {
    const remoteAddress = req.socket.remoteAddress;
    if (!isAddressAllowed(remoteAddress, allowedSubnets)) {
      logger?.warn('rejected request: source IP not in allowed LAN subnet', {
        source_ip: remoteAddress,
        path: req.path,
      });
      return res.status(403).json({ error: { code: 'FORBIDDEN_SOURCE', message: 'Source not on allowed LAN subnet.' } });
    }
    const origin = req.headers.origin;
    if (origin && expectedOrigins.length > 0 && !expectedOrigins.includes(origin)) {
      logger?.warn('rejected request: origin mismatch', { origin, path: req.path });
      return res.status(403).json({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed.' } });
    }
    next();
  };
}

module.exports = {
  isPrivateIPv4,
  getLanInterfaces,
  computeAllowedSubnets,
  isAddressAllowed,
  buildNetworkGuardMiddleware,
};

'use strict';

/**
 * Wake-on-LAN magic packet sender, per reconciliation.md §1.
 * Uses only Node's built-in `dgram` module — no extra dependency.
 */

const dgram = require('dgram');

function parseMac(mac) {
  const clean = mac.replace(/[:-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(clean)) return null;
  const bytes = [];
  for (let i = 0; i < 12; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes);
}

function buildMagicPacket(mac) {
  const macBytes = parseMac(mac);
  if (!macBytes) throw new Error(`Invalid MAC address: ${mac}`);
  const header = Buffer.alloc(6, 0xff);
  const body = Buffer.concat(Array(16).fill(macBytes));
  return Buffer.concat([header, body]);
}

/**
 * Send a magic packet. Resolves { sent: true, target } or rejects.
 */
function sendMagicPacket({ macAddress, broadcastAddress = '255.255.255.255', port = 9 }) {
  return new Promise((resolve, reject) => {
    let packet;
    try {
      packet = buildMagicPacket(macAddress);
    } catch (err) {
      reject(err);
      return;
    }
    const socket = dgram.createSocket('udp4');
    socket.on('error', (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, port, broadcastAddress, (err) => {
        socket.close();
        if (err) reject(err);
        else resolve({ sent: true, target: macAddress, broadcastAddress, port });
      });
    });
  });
}

module.exports = { sendMagicPacket, buildMagicPacket, parseMac };

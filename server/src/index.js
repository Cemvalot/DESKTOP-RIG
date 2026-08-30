'use strict';

/**
 * Launchpad PC control service entrypoint.
 * See server/README.md for setup/run instructions and architecture-security.md
 * for the full implementation contract this file wires together.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const pkg = require('../package.json');

const { loadAll } = require('./config');
const { Logger } = require('./logger');
const { TokenStore } = require('./state/tokenStore');
const { PairingStore } = require('./state/pairingStore');
const { ConfirmStore } = require('./state/confirmStore');
const { CommandHistory } = require('./state/commandHistory');
const { buildLimiters, rateLimitMiddleware } = require('./rateLimit');
const { getLanInterfaces, computeAllowedSubnets, isAddressAllowed, buildNetworkGuardMiddleware } = require('./network');
const { buildAuthMiddleware } = require('./auth');
const { Executor } = require('./commands/exec');
const { MediaController, LinuxMediaController } = require('./commands/media');
const { SystemStatsService } = require('./stats/systemStats');
const { WsHub } = require('./ws/server');
const { loadModules } = require('./modules');

const { buildHealthRouter } = require('./routes/health');
const { buildPairingRouter } = require('./routes/pairing');
const { buildAuthRouter } = require('./routes/auth');
const { buildStatusRouter } = require('./routes/status');
const { buildConfigRouter } = require('./routes/config');
const { buildCommandsRouter } = require('./routes/commands');
const { buildMediaRouter } = require('./routes/media');
const { buildWolRouter } = require('./routes/wol');

function main() {
  const config = loadAll();
  const logger = new Logger({
    logDir: config.logDir,
    maxSizeMb: config.service.logMaxSizeMb ?? 10,
    retentionDays: config.service.logRetentionDays ?? 14,
  });

  logger.info('launchpad-server starting', {
    version: pkg.version,
    platform: process.platform,
    mockExec: config.mockExec,
    logDir: config.logDir,
    stateDir: config.stateDir,
  });

  if (config.linkWarnings.length) {
    for (const w of config.linkWarnings) logger.warn('config warning: ' + w);
  }

  // --- Network binding (§3.1) ---
  const lanInterfaces = getLanInterfaces();
  const allowedSubnets = computeAllowedSubnets(lanInterfaces);
  // Always also bind loopback: architecture-security.md §2.5 expects a
  // local PC-tray admin surface to call GET /auth/tokens / POST /auth/revoke
  // against localhost, and it's what local curl/dev verification hits too.
  const bindAddresses = Array.from(
    new Set([...(lanInterfaces.length ? lanInterfaces.map((i) => i.address) : ['0.0.0.0']), '127.0.0.1'])
  );
  if (!lanInterfaces.length) {
    logger.warn('no private-range LAN interface found at startup — falling back to 0.0.0.0 with app-layer allowlist as the real gate (see network.js isAddressAllowed fallback)');
  } else {
    logger.info('bound LAN interfaces', { interfaces: lanInterfaces.map((i) => `${i.name}:${i.address}`) });
  }
  const primaryLanAddress = lanInterfaces[0]?.address || null;

  const port = config.service.port || 8787;
  const expectedOrigins = [
    `http://${primaryLanAddress}:${port}`,
    `https://${primaryLanAddress}:${port}`,
    // Loopback origins so local curl/browser dev testing against
    // 127.0.0.1 isn't rejected (see isAddressAllowed's loopback carve-out).
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ].filter(Boolean);

  // --- State ---
  const tokenStore = new TokenStore({ stateDir: config.stateDir, logger });
  const pairingStore = new PairingStore({ ttlSeconds: config.service.pairingCodeTtlSeconds ?? 300, logger });
  const confirmStore = new ConfirmStore({
    windowSeconds: config.service.dangerousConfirmWindowSeconds ?? 10,
    maxWindowSeconds: config.service.dangerousConfirmWindowMaxSeconds ?? 60,
  });
  const commandHistory = new CommandHistory(50);
  const limiters = buildLimiters(config.service.rateLimits || {});

  // --- Execution layer ---
  const executor = new Executor({ mockExec: config.mockExec, logger });
  const MediaControllerClass = process.platform === 'linux' ? LinuxMediaController : MediaController;
  const mediaController = new MediaControllerClass({ mockExec: config.mockExec, logger });
  const statsService = new SystemStatsService({
    mediaController,
    logger,
    slowRefreshMs: config.service.statsSlowRefreshMs ?? 2500,
  });

  // --- Optional modules (disabled by default, never invoked when off) ---
  const modules = loadModules({ config, logger });

  // --- WS hub (created before routes since /commands/execute needs it to
  // push command_result; http servers are attached to it further below,
  // once we know the final bind addresses). ---
  const wsHub = new WsHub({
    tokenStore,
    isAddressAllowed,
    allowedSubnets,
    limiters,
    logger,
    serverVersion: pkg.version,
  });
  mediaController.onNowPlayingChange((nowPlaying) => {
    wsHub.pushNowPlayingUpdate(nowPlaying);
  });

  // --- Express app ---
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  const networkGuard = buildNetworkGuardMiddleware({ allowedSubnets, expectedOrigins, logger });
  app.use(networkGuard);

  // Request logging (§6.2): one line per authenticated-or-not request.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.log({
        level: 'info',
        kind: 'request',
        source_ip: req.socket.remoteAddress,
        token_id: req.auth?.tokenId || null,
        method: req.method,
        path: req.originalUrl,
        status_code: res.statusCode,
        latency_ms: Date.now() - start,
      });
    });
    next();
  });

  // Serve the tablet frontend from the same origin as the API. This is the
  // primary deployment model (docs/reconciliation.md §4: "served as static
  // files directly by the Node server") — same-origin means the tablet's
  // liveProvider can use plain relative fetch()/WebSocket URLs with no CORS
  // configuration, and the owner only ever types one address into the
  // tablet's browser: http://<pc-ip>:8787/. Still gated by the LAN/origin
  // network guard above, so the app itself stays LAN-only, not just the API.
  const FRONTEND_DIR = path.resolve(__dirname, '..', '..', 'frontend');
  app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

  // Public routes (no bearer auth).
  app.use('/', buildHealthRouter({ config }));
  app.use(
    '/api/v1',
    buildPairingRouter({
      pairingStore,
      tokenStore,
      limiters,
      logger,
      pcLanAddress: primaryLanAddress,
      port,
      onClaimed: () => ensurePairingCode(),
    })
  );
  // Alias at root too, for a PC-side companion display that doesn't know the /api/v1 prefix.
  app.get('/pairing/current', (req, res) => {
    const info = pairingStore.currentInfo();
    if (!info) return res.status(404).json({ error: { code: 'NO_ACTIVE_CODE', message: 'No active pairing code.' } });
    res.status(200).json({ code: info.code, expires_at: info.expires_at, pairing_url: `http://${primaryLanAddress || '<pc-ip>'}:${port}/pair?code=${info.code}` });
  });

  // Authenticated routes. General rate limit (§6.1) applies to all of
  // them; /commands/execute and /commands/confirm additionally apply their
  // own stricter per-route limiters inside buildCommandsRouter.
  const authMiddleware = buildAuthMiddleware({ tokenStore, logger });
  app.use(
    '/api/v1',
    authMiddleware,
    rateLimitMiddleware(limiters.general, (req) => req.auth.tokenId, logger),
    buildAuthRouter({ tokenStore, logger }),
    buildStatusRouter({ statsService }),
    buildConfigRouter({ config }),
    buildMediaRouter({ mediaController, commandHistory, logger }),
    buildWolRouter({ config, logger }),
    buildCommandsRouter({ config, executor, mediaController, confirmStore, commandHistory, wsHub, limiters, logger })
  );

  // 404 fallback for unmatched routes.
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route.' } });
  });

  // Error handler (e.g. malformed JSON body from express.json()).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('unhandled request error', { error: err.message, path: req.path });
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request.' } });
  });

  // --- HTTP servers (one per bound LAN interface, per §3.1); wsHub already
  // built above, just attach its /ws upgrade handler to each server. ---
  const httpServers = bindAddresses.map((address) => {
    const server = http.createServer(app);
    wsHub.attach(server);
    server.listen(port, address, () => {
      logger.info(`listening on http://${address}:${port}`);
    });
    return server;
  });

  // --- Periodic pushes ---
  setInterval(async () => {
    try {
      const status = await statsService.getStatus();
      wsHub.pushStatusUpdate(status);
    } catch (err) {
      logger.error('status_update push failed', { error: err.message });
    }
  }, config.service.statusUpdateIntervalMs || 1000).unref();

  setInterval(() => {
    wsHub.pushConnectionStatus({
      online: true,
      adapter: lanInterfaces[0]?.name || null,
      ssid: null, // TODO(real-windows): populate via `netsh wlan show interfaces` parsing
    });
  }, 10_000).unref();

  // Keep a pairing code available for dev/testing convenience: regenerate
  // whenever the current one has expired/been used. In production this
  // would instead be operator-triggered from a "Pair a new device" UI
  // action; auto-regeneration here just keeps `npm start` usable out of the
  // box without a companion PC-tray app existing yet.
  function ensurePairingCode() {
    if (!pairingStore.currentInfo()) {
      const info = pairingStore.generate();
      const url = `http://${primaryLanAddress || '<pc-ip>'}:${port}/pair?code=${info.code}`;
      logger.info('pairing code generated', { code_ending_in: info.code.slice(-2), expires_at: info.expires_at });
      // eslint-disable-next-line no-console
      console.log('\n==============================================');
      console.log(`  Launchpad pairing code: ${info.code}`);
      console.log(`  Pairing URL:            ${url}`);
      console.log(`  Expires in ${info.ttl_seconds}s — GET /pairing/current for the live value.`);
      console.log('==============================================\n');
    }
  }
  ensurePairingCode();
  setInterval(ensurePairingCode, 30_000).unref();

  return { app, httpServers, wsHub, logger, config, tokenStore, pairingStore, confirmStore, commandHistory, executor, mediaController, statsService, limiters };
}

if (require.main === module) {
  main();
}

module.exports = { main };

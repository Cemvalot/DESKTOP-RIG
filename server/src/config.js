'use strict';

/**
 * Config loader.
 *
 * Loads the shared, lead-owned JSON config files from /config at the repo
 * root (server/ and config/ are siblings). Server code must never mutate
 * these files or restructure their schema — see docs/reconciliation.md §3
 * for directory ownership. This module only *reads* them and normalizes a
 * couple of platform-dependent paths (logDir/stateDir) for local dev.
 *
 * Override pattern (per architecture-security.md §7): if
 * config/<name>.local.json exists, it is deep-merged over config/<name>.json
 * so machine-specific real paths never need to be committed. *.local.json is
 * gitignored.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.resolve(__dirname, '..', '..', 'config');
const SERVER_DIR = path.resolve(__dirname, '..');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err.message}`);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    if (isPlainObject(base[key]) && isPlainObject(override[key])) {
      out[key] = deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

function loadConfigFile(name) {
  const basePath = path.join(CONFIG_DIR, `${name}.json`);
  const base = readJsonIfExists(basePath);
  if (base === null) {
    throw new Error(`Missing required config file: ${basePath}`);
  }
  const localPath = path.join(CONFIG_DIR, `${name}.local.json`);
  const local = readJsonIfExists(localPath);
  return local ? deepMerge(base, local) : base;
}

/**
 * Resolve a possibly-Windows-styled config path (e.g.
 * "%LOCALAPPDATA%\Launchpad\logs") to a real path usable on the current
 * platform.
 *
 * - On win32 with %LOCALAPPDATA% present: expand the env var, keep the path.
 * - On any other platform (our Linux dev box), or if the env var can't be
 *   resolved even on win32: fall back to a relative directory under
 *   server/ so dev/test never depends on a Windows-only path. This keeps
 *   the *value* in service.json authoritative for production Windows while
 *   staying dev-safe everywhere else, per reconciliation.md's mockExec/dev
 *   guidance.
 */
function resolveDataDir(configuredValue, fallbackRelativeDir) {
  if (typeof configuredValue === 'string' && configuredValue.includes('%LOCALAPPDATA%')) {
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      return configuredValue.replace('%LOCALAPPDATA%', process.env.LOCALAPPDATA);
    }
    // Not on Windows (or LOCALAPPDATA unset) — use local relative fallback.
    return path.join(SERVER_DIR, fallbackRelativeDir);
  }
  if (typeof configuredValue === 'string' && configuredValue.trim() !== '') {
    return path.isAbsolute(configuredValue)
      ? configuredValue
      : path.join(SERVER_DIR, configuredValue);
  }
  return path.join(SERVER_DIR, fallbackRelativeDir);
}

function loadAll() {
  const service = loadConfigFile('service');
  const apps = loadConfigFile('apps');
  const links = loadConfigFile('links');
  const maintenance = loadConfigFile('maintenance');
  const games = loadConfigFile('games');
  const profiles = loadConfigFile('profiles');
  const smarthome = loadConfigFile('smarthome');

  // Additive default: reconciliation.md §1 asks for a modules.<name>.enabled
  // section. The lead has been asked (see server README / final report) to
  // add this to config/service.json directly; we also default it here so
  // the server behaves correctly even before that lands, and never crashes
  // if the key is absent.
  const defaultModules = {
    homeassistant: { enabled: false },
    obs: { enabled: false },
    discord: { enabled: false },
    notifications: { enabled: false },
    clipboard: { enabled: false },
  };
  service.modules = deepMerge(defaultModules, service.modules || {});

  // Virtual keyboard / trackpad (docs/architecture-security.md §11) — real
  // on Linux via `ydotool`; degrades to a clean "ydotool not installed"
  // error if it's ever missing, never a crash.
  service.remoteDesktop = deepMerge({ moveSensitivity: 1.5 }, service.remoteDesktop || {});

  // This machine's local gesture automation. Audio is analyzed in memory
  // only; it is never recorded to disk or sent over the network.
  service.clapTrigger = deepMerge(
    { enabled: process.platform === 'linux', minGapMs: 180, maxGapMs: 850, cooldownMs: 5000 },
    service.clapTrigger || {}
  );

  // TLS (architecture-security.md §3.4): optional, self-signed. Browsers
  // treat a secure context as required for mic access (the tablet's voice
  // trigger uses SpeechRecognition), so any origin other than localhost
  // needs HTTPS for that to work over the LAN. Auto-enable when this
  // machine's git-ignored cert/key pair is present in server/certs/, so a
  // fresh checkout stays plain HTTP until certs are generated; explicit
  // `https`/`tlsKeyPath`/`tlsCertPath` in config/service.local.json still
  // win over this default.
  const defaultCertPath = path.join(SERVER_DIR, 'certs', 'launchpad-cert.pem');
  const defaultKeyPath = path.join(SERVER_DIR, 'certs', 'launchpad-key.pem');
  const hasDefaultCerts = fs.existsSync(defaultCertPath) && fs.existsSync(defaultKeyPath);
  if (service.tlsCertPath === undefined && hasDefaultCerts) service.tlsCertPath = defaultCertPath;
  if (service.tlsKeyPath === undefined && hasDefaultCerts) service.tlsKeyPath = defaultKeyPath;
  if (service.https === undefined) service.https = hasDefaultCerts;

  // mockExec: explicit flag, OR a platform with no real implementation at
  // all. Both win32 and linux now have real command implementations (see
  // commands/exec.js, commands/media.js), so mockExec is no longer forced
  // on for Linux — only for a genuinely unsupported OS (e.g. macOS), or
  // when the owner explicitly wants a side-effect-free test run via
  // config/service.local.json's `mockExec: true`.
  const REAL_EXEC_PLATFORMS = new Set(['win32', 'linux']);
  const mockExec = service.mockExec === true || !REAL_EXEC_PLATFORMS.has(process.platform);

  const logDir = resolveDataDir(service.logDir, 'logs');
  const stateDir = resolveDataDir(service.stateDir, 'state');

  // Validate link targets at load time (warn-only, never crash) per
  // architecture-security.md §4.3.
  const linkWarnings = [];
  for (const link of links.links || []) {
    if (link.type === 'url') {
      try {
        const u = new URL(link.target);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          linkWarnings.push(`link '${link.id}': target is not http/https: ${link.target}`);
        }
      } catch {
        linkWarnings.push(`link '${link.id}': target does not parse as a URL: ${link.target}`);
      }
    } else if (link.type === 'file' || link.type === 'folder') {
      // Only check existence when the target actually looks like a path
      // for the platform we're running on — a tracked config/links.json
      // entry written as a Windows example (C:\Users\...) is expected to
      // "not exist" on Linux and shouldn't warn; a real Linux path (via
      // config/links.local.json, see docs/adding-apps-and-commands.md)
      // should be checked here just like Windows paths already are.
      const looksLikeCurrentPlatformPath =
        process.platform === 'win32' ? /^[A-Za-z]:\\/.test(link.target) : link.target.startsWith('/') || link.target.startsWith('~');
      if (looksLikeCurrentPlatformPath && !fs.existsSync(link.target)) {
        linkWarnings.push(`link '${link.id}': target does not exist on disk: ${link.target}`);
      }
    }
  }

  return {
    service,
    apps,
    links,
    maintenance,
    games,
    profiles,
    smarthome,
    mockExec,
    logDir,
    stateDir,
    linkWarnings,
    configDir: CONFIG_DIR,
    serverDir: SERVER_DIR,
  };
}

module.exports = { loadAll, deepMerge, CONFIG_DIR, SERVER_DIR };

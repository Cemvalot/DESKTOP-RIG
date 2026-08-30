#!/usr/bin/env node
// Integration test script for the Launchpad server REST API.
// Run against a live `node src/index.js` instance (mockExec auto-enabled on Linux).
// Usage: node tests/api-test.js
//
// This is a throwaway/ad-hoc verification script (not a framework-based test
// suite) written by the integration/testing subagent — see docs/test-report.md
// for the full pass/fail table this script's output feeds into.

const BASE = process.env.LAUNCHPAD_BASE || 'http://127.0.0.1:8787';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function main() {
  // --- Pairing ---
  const pairingCurrent = await req('/pairing/current');
  record('GET /pairing/current returns code', pairingCurrent.status === 200 && !!pairingCurrent.body.code,
    JSON.stringify(pairingCurrent.body));

  const claim = await req('/api/v1/pairing/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairing_code: pairingCurrent.body.code, device_name: 'api-test-script' }),
  });
  record('POST /pairing/claim succeeds', claim.status === 200 && !!claim.body.token, JSON.stringify(claim.body));
  const TOKEN = claim.body.token;

  // Re-claiming same code should now fail (single-use)
  const reclaim = await req('/api/v1/pairing/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairing_code: pairingCurrent.body.code, device_name: 'api-test-script-2' }),
  });
  record('Pairing code is single-use (re-claim rejected)', reclaim.status === 401 || reclaim.status === 410,
    `status=${reclaim.status} body=${JSON.stringify(reclaim.body)}`);

  // --- Unauthorized access ---
  const noToken = await req('/api/v1/status');
  record('No token -> 401', noToken.status === 401, JSON.stringify(noToken.body));

  const garbageToken = await req('/api/v1/status', { headers: authHeaders('garbage-token-xyz') });
  record('Garbage token -> 401', garbageToken.status === 401, JSON.stringify(garbageToken.body));

  const execNoAuth = await req('/api/v1/commands/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'launch_app', app_id: 'browser' }),
  });
  record('POST /commands/execute no auth -> 401', execNoAuth.status === 401, JSON.stringify(execNoAuth.body));

  // Revoked token test: mint a throwaway token via a fresh pairing code isn't easy without server help,
  // so we self-revoke TOKEN at the very end after using it. See "revoked token" test near the bottom.

  // --- Config endpoints ---
  const apps = await req('/api/v1/config/apps', { headers: authHeaders(TOKEN) });
  record('GET /config/apps', apps.status === 200 && Array.isArray(apps.body.apps), JSON.stringify(apps.body).slice(0, 200));
  const links = await req('/api/v1/config/links', { headers: authHeaders(TOKEN) });
  record('GET /config/links', links.status === 200 && Array.isArray(links.body.links), JSON.stringify(links.body).slice(0, 200));
  const maint = await req('/api/v1/config/maintenance', { headers: authHeaders(TOKEN) });
  record('GET /config/maintenance', maint.status === 200 && Array.isArray(maint.body.commands), `count=${maint.body.commands?.length}`);
  const games = await req('/api/v1/config/games', { headers: authHeaders(TOKEN) });
  record('GET /config/games', games.status === 200, JSON.stringify(games.body).slice(0, 150));
  const smarthome = await req('/api/v1/config/smarthome', { headers: authHeaders(TOKEN) });
  record('GET /config/smarthome', smarthome.status === 200, JSON.stringify(smarthome.body).slice(0, 150));

  // --- status ---
  const status = await req('/api/v1/status', { headers: authHeaders(TOKEN) });
  record('GET /status', status.status === 200 && !!status.body.cpu, JSON.stringify(status.body).slice(0, 300));

  // --- launch_app x3 ---
  for (const appId of ['browser', 'steam', 'spotify']) {
    const r = await req('/api/v1/commands/execute', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ type: 'launch_app', app_id: appId }),
    });
    record(`launch_app ${appId}`, [200, 202].includes(r.status), `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // unknown app id -> 404
  const unknownApp = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'launch_app', app_id: 'totally-not-real' }),
  });
  record('launch_app unknown id -> 404', unknownApp.status === 404, JSON.stringify(unknownApp.body));

  // --- open_link: url/folder types (link.json has url + folder, no file entry) ---
  for (const linkId of ['github', 'downloads-folder', 'desktop-folder']) {
    const r = await req('/api/v1/commands/execute', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ type: 'open_link', link_id: linkId }),
    });
    record(`open_link ${linkId}`, [200, 202].includes(r.status), `status=${r.status} body=${JSON.stringify(r.body)}`);
  }
  const unknownLink = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'open_link', link_id: 'nope' }),
  });
  record('open_link unknown id -> 404', unknownLink.status === 404, JSON.stringify(unknownLink.body));

  // --- launch_game ---
  const launchGame = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'launch_game', steam_app_id: '570' }),
  });
  record('launch_game valid steam_app_id', [200, 202].includes(launchGame.status), `status=${launchGame.status} body=${JSON.stringify(launchGame.body)}`);

  const launchGameBad = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'launch_game', steam_app_id: 'rm -rf /' }),
  });
  record('launch_game rejects non-numeric steam_app_id', [400, 404].includes(launchGameBad.status), `status=${launchGameBad.status} body=${JSON.stringify(launchGameBad.body)}`);

  // --- media_control: play/pause/next/prev/stop ---
  for (const action of ['play', 'pause', 'next', 'previous', 'stop']) {
    const r = await req('/api/v1/media/control', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ action }),
    });
    record(`media_control ${action}`, [200, 202].includes(r.status), `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  // --- volume_set ---
  const vol1 = await req('/api/v1/media/volume', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ level: 42 }),
  });
  record('volume_set level=42', vol1.status === 200 && vol1.body.level === 42, JSON.stringify(vol1.body));

  const vol2 = await req('/api/v1/media/volume', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ mute: true }),
  });
  record('volume_set mute=true', vol2.status === 200 && vol2.body.muted === true, JSON.stringify(vol2.body));
  await req('/api/v1/media/volume', { method: 'POST', headers: authHeaders(TOKEN), body: JSON.stringify({ mute: false }) });

  // --- mic_mute ---
  const mic1 = await req('/api/v1/media/mic', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ mute: true }),
  });
  record('mic_mute true', mic1.status === 200 && mic1.body.muted === true, JSON.stringify(mic1.body));
  await req('/api/v1/media/mic', { method: 'POST', headers: authHeaders(TOKEN), body: JSON.stringify({ mute: false }) });

  // --- maintenance: all 11 entries ---
  const maintIds = maint.body.commands.map(c => c.id);
  for (const id of maintIds) {
    const r = await req('/api/v1/commands/execute', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ type: 'maintenance', task_id: id }),
    });
    if (r.status === 200 && r.body.status === 'confirmation_required') {
      // dangerous — confirm it
      const confirm = await req('/api/v1/commands/confirm', {
        method: 'POST', headers: authHeaders(TOKEN),
        body: JSON.stringify({ confirm_token: r.body.confirm_token }),
      });
      record(`maintenance ${id} (dangerous, confirmed)`, confirm.status === 200, `execute=${r.status} confirm=${confirm.status} ${JSON.stringify(confirm.body)}`);
    } else {
      record(`maintenance ${id}`, [200, 202].includes(r.status), `status=${r.status} body=${JSON.stringify(r.body)}`);
    }
  }

  const unknownMaint = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'maintenance', task_id: 'does-not-exist' }),
  });
  record('maintenance unknown id -> 404', unknownMaint.status === 404, JSON.stringify(unknownMaint.body));

  // --- power_action: all 4, each requires two-step confirm ---
  for (const action of ['lock', 'sleep', 'restart', 'shutdown']) {
    const exec = await req('/api/v1/commands/execute', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ type: 'power_action', action }),
    });
    const isConfirmReq = exec.status === 200 && exec.body.status === 'confirmation_required' && !!exec.body.confirm_token;
    record(`power_action ${action} requires confirmation`, isConfirmReq, JSON.stringify(exec.body));
    if (isConfirmReq) {
      const confirm = await req('/api/v1/commands/confirm', {
        method: 'POST', headers: authHeaders(TOKEN),
        body: JSON.stringify({ confirm_token: exec.body.confirm_token }),
      });
      record(`power_action ${action} confirm executes`, confirm.status === 200, JSON.stringify(confirm.body));

      // re-using the same confirm_token should now 409
      const reuse = await req('/api/v1/commands/confirm', {
        method: 'POST', headers: authHeaders(TOKEN),
        body: JSON.stringify({ confirm_token: exec.body.confirm_token }),
      });
      record(`power_action ${action} confirm_token single-use (409 on reuse)`, reuse.status === 409, `status=${reuse.status} body=${JSON.stringify(reuse.body)}`);
    }
  }

  // --- Cancel flow: request dangerous command, never confirm, just don't call confirm (client-side cancel = no-op) ---
  const cancelExec = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'power_action', action: 'shutdown' }),
  });
  record('power_action shutdown (for cancel test) returns confirmation_required', cancelExec.status === 200 && cancelExec.body.status === 'confirmation_required', JSON.stringify(cancelExec.body));
  // Deliberately do nothing further -> command must never execute. We can't directly observe
  // "it didn't shut down" other than absence of side effects / log entries; documented in report.

  // --- Expiry flow: request dangerous command, wait past dangerousConfirmWindowSeconds, then confirm -> 410 ---
  const expireExec = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'power_action', action: 'restart' }),
  });
  if (expireExec.status === 200 && expireExec.body.confirm_token) {
    const waitMs = (expireExec.body.expires_in_seconds || 10) * 1000 + 1500;
    console.log(`  waiting ${waitMs}ms for confirm token to expire...`);
    await new Promise(r => setTimeout(r, waitMs));
    const expiredConfirm = await req('/api/v1/commands/confirm', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ confirm_token: expireExec.body.confirm_token }),
    });
    record('Expired confirm_token -> 410 CONFIRMATION_EXPIRED', expiredConfirm.status === 410 && expiredConfirm.body?.error?.code === 'CONFIRMATION_EXPIRED',
      `status=${expiredConfirm.status} body=${JSON.stringify(expiredConfirm.body)}`);
  } else {
    record('Expired confirm_token -> 410 CONFIRMATION_EXPIRED', false, 'setup failed: ' + JSON.stringify(expireExec.body));
  }

  // --- Rate limiting: dangerous execute limit is 5/min ---
  console.log('  testing dangerous rate limit (6 rapid power_action requests)...');
  let sawRateLimit = false;
  let lastStatus = [];
  for (let i = 0; i < 8; i++) {
    const r = await req('/api/v1/commands/execute', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ type: 'power_action', action: 'lock' }),
    });
    lastStatus.push(r.status);
    if (r.status === 429) { sawRateLimit = true; }
  }
  record('Dangerous command rate limit trips (429 seen within 8 rapid requests)', sawRateLimit, `statuses=${JSON.stringify(lastStatus)}`);

  // --- Revoked token test ---
  const revoke = await req('/api/v1/auth/revoke', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({}),
  });
  record('Self-revoke succeeds', revoke.status === 200 && revoke.body.revoked === true, JSON.stringify(revoke.body));

  const afterRevoke = await req('/api/v1/status', { headers: authHeaders(TOKEN) });
  record('Revoked token -> 401 on subsequent request', afterRevoke.status === 401, JSON.stringify(afterRevoke.body));

  // --- Summary ---
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log(`\n=== ${pass}/${results.length} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.log('Failed tests:');
    for (const r of results.filter(r => !r.pass)) console.log(`  - ${r.name}: ${r.detail}`);
  }
  console.log('\nJSON_RESULTS_START');
  console.log(JSON.stringify(results));
  console.log('JSON_RESULTS_END');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

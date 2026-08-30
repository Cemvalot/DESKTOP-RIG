#!/usr/bin/env node
// Follow-up to api-test.js: tests that need a clean rate-limit window /
// fresh token (shutdown confirm, cancel-flow, expiry-flow, revoke,
// Retry-After header). Run with a fresh pairing code claimed manually.
// Usage: LAUNCHPAD_TOKEN=<token> node tests/api-test-part2.js

const BASE = process.env.LAUNCHPAD_BASE || 'http://127.0.0.1:8787';
const TOKEN = process.env.LAUNCHPAD_TOKEN;
if (!TOKEN) { console.error('Set LAUNCHPAD_TOKEN'); process.exit(1); }

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
const authHeaders = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function main() {
  // --- Cancel flow: request dangerous command, never confirm ---
  const cancelExec = await req('/api/v1/commands/execute', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ type: 'power_action', action: 'shutdown' }),
  });
  record('power_action shutdown returns confirmation_required (cancel-flow setup)',
    cancelExec.status === 200 && cancelExec.body.status === 'confirmation_required', JSON.stringify(cancelExec.body));
  // Simulate "Cancel" = client just never calls /confirm. Verify token becomes unusable after window expires.

  // --- Expiry flow ---
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
    record('Expired confirm_token -> 410 CONFIRMATION_EXPIRED',
      expiredConfirm.status === 410 && expiredConfirm.body?.error?.code === 'CONFIRMATION_EXPIRED',
      `status=${expiredConfirm.status} body=${JSON.stringify(expiredConfirm.body)}`);
  } else {
    record('Expired confirm_token -> 410 CONFIRMATION_EXPIRED', false, 'setup failed: ' + JSON.stringify(expireExec.body));
  }

  // Also confirm the earlier "cancelled" shutdown token, now also well past its 10s window,
  // correctly rejects (proves an ignored/cancelled dialog can never later execute the command).
  const lateConfirmOfCancelled = await req('/api/v1/commands/confirm', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({ confirm_token: cancelExec.body.confirm_token }),
  });
  record('Cancelled (never-confirmed) dangerous command cannot be confirmed late',
    lateConfirmOfCancelled.status === 410, `status=${lateConfirmOfCancelled.status} body=${JSON.stringify(lateConfirmOfCancelled.body)}`);

  // --- Retry-After header on 429 ---
  let got429 = null;
  for (let i = 0; i < 8; i++) {
    const r = await req('/api/v1/commands/execute', {
      method: 'POST', headers: authHeaders(TOKEN),
      body: JSON.stringify({ type: 'power_action', action: 'lock' }),
    });
    if (r.status === 429) { got429 = r; break; }
  }
  record('429 response includes Retry-After header', !!got429 && got429.headers.has('retry-after'),
    got429 ? `Retry-After=${got429.headers.get('retry-after')} body=${JSON.stringify(got429.body)}` : 'never got 429');

  // --- Revoke flow (own token) ---
  const revoke = await req('/api/v1/auth/revoke', {
    method: 'POST', headers: authHeaders(TOKEN),
    body: JSON.stringify({}),
  });
  record('Self-revoke succeeds', revoke.status === 200 && revoke.body.revoked === true, JSON.stringify(revoke.body));

  const afterRevoke = await req('/api/v1/status', { headers: authHeaders(TOKEN) });
  record('Revoked token -> 401 on subsequent request', afterRevoke.status === 401, JSON.stringify(afterRevoke.body));

  const pass = results.filter(r => r.pass).length;
  console.log(`\n=== ${pass}/${results.length} passed ===`);
  console.log('\nJSON_RESULTS_START');
  console.log(JSON.stringify(results));
  console.log('JSON_RESULTS_END');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });

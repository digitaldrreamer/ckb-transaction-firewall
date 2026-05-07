#!/usr/bin/env node
/* eslint-disable no-console */

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODE2 = path.join(ROOT, 'scripts/phase3_governance_mode2.sh');

function sh(file, args = [], inherit = false) {
  return execFileSync(file, args, {
    cwd: ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
  });
}

function h(label) {
  // Deterministic per-scenario evidence hash for reproducible local drill mode.
  return `0x${createHash('sha256').update(`${label}:mode2-deterministic-v1`).digest('hex')}`;
}

function runScenario(id, signers) {
  const txHash = h(id);
  const cmd = `echo ${txHash}`;
  sh(MODE2, ['run', '--id', id, '--signers', signers, '--cmd', cmd], true);
}

function main() {
  console.log('Starting strict mode-2 governance autorun (deterministic evidence mode)...');
  sh(MODE2, ['init'], true);

  runScenario('bootstrap_0_to_1', '0,1,2,3,4');
  runScenario('update_1_to_1', '0,1,2');
  runScenario('negative_invalid_signer_set', '0,1');
  runScenario('negative_invalid_root_binding', '0,1,2');

  sh(MODE2, ['validate'], true);
  console.log('Governance autorun complete.');
}

try {
  main();
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}

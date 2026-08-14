/**
 * Fails when the dependency graph holds more than one instance of Three.
 *
 * IWSDK re-exports Three from `@iwsdk/core`, built against the `super-three`
 * fork; its own examples pin `"three": "npm:super-three@0.181.0"`. That alias
 * is written for npm, where hoisting makes it win everywhere. Under pnpm each
 * package resolves its `three` peer independently, so a second (real) `three`
 * can slip into the graph — and with it a second `@pmndrs/uikit`, whose
 * `instanceof` checks then fail across the two copies and the world never
 * starts. The root `pnpm.overrides` entry forces the whole graph onto one
 * super-three; this script is the tripwire that keeps it that way.
 */
import { readFileSync } from 'node:fs';

const lockfile = new URL('../pnpm-lock.yaml', import.meta.url);
const lock = readFileSync(lockfile, 'utf8');

// Package entries look like `  three@0.185.1:` at two-space indent, in both
// the `packages:` and `snapshots:` sections. The blessed instance resolves as
// `super-three@…`, which this pattern deliberately does not match.
const real = [...new Set(lock.match(/^ {2}three@\d[^:(]*/gm) ?? [])].map((s) =>
  s.trim(),
);
const forks = [...new Set(lock.match(/^ {2}super-three@\d[^:(]*/gm) ?? [])].map(
  (s) => s.trim(),
);

const failures = [];
if (real.length > 0) {
  failures.push(
    `real three package(s) in the graph: ${real.join(', ')} — ` +
      'some dependency escaped the root pnpm.overrides alias',
  );
}
if (forks.length > 1) {
  failures.push(`multiple super-three versions: ${forks.join(', ')}`);
}
if (forks.length === 0) {
  failures.push('no super-three in the lockfile — is the alias gone entirely?');
}

if (failures.length > 0) {
  console.error('check-single-three: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nEvery consumer must see the one super-three instance; two Three copies' +
      '\nmeans two @pmndrs/uikit copies and a dead UIKitML panel.',
  );
  process.exit(1);
}

console.log(`check-single-three: OK (${forks[0]} is the only Three)`);

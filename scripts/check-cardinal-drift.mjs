/**
 * Fails when a generated Cardinal artifact does not match the schema.
 *
 * The generated files are committed so their diffs serve as the protocol
 * change record. That only holds if they cannot drift: this regenerates into a
 * temp directory and compares. It catches both halves of the mistake — editing
 * the schema without regenerating, and editing a generated file by hand.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Path of each artifact, relative to whichever root the generator writes to. */
const artifacts = [
  'packages/client/src/cardinal/codecs.generated.ts',
  'packages/client/src/cardinal/components.generated.ts',
  'packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex',
  'fixtures/cardinal_vectors.tsv',
];

// Regenerate into a scratch tree and compare. Never into the working tree: an
// in-place regeneration would have to be undone afterwards, and undoing it
// with `git checkout` would destroy any legitimate uncommitted edit the
// developer happened to be holding.
const scratch = mkdtempSync(join(tmpdir(), 'cardinal-drift-'));

try {
  execFileSync('node', ['scripts/generate-cardinal.mjs'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, CARDINAL_OUT_DIR: scratch },
  });

  const drifted = artifacts.filter(
    (relative) =>
      readFileSync(join(root, relative), 'utf8') !==
      readFileSync(join(scratch, relative), 'utf8'),
  );

  if (drifted.length > 0) {
    console.error('check-cardinal-drift: FAIL');
    for (const relative of drifted) console.error(`  - out of date: ${relative}`);
    console.error(
      '\nThe schema and its generated artifacts disagree. Run:' +
        '\n  node scripts/generate-cardinal.mjs' +
        '\nand commit the result — the diff is the protocol change record.',
    );
    process.exit(1);
  }

  console.log('check-cardinal-drift: OK (generated artifacts match the schema)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

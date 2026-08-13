/**
 * Assertions about the published artefact rather than the source.
 *
 * These cover a blind spot the rest of the suite has by construction: every
 * other test imports from `src`, so nothing notices when the *build output* is
 * broken in a way the source is not.
 *
 * That is not hypothetical. `PhoenixAdapter` resolves its worker with
 * `new URL('./network.worker.js', import.meta.url)`, and the path is relative to
 * the bundled `dist/index.js`, not to the source file it is written in. It was
 * `'../network.worker.js'` — correct-looking from `src/adapters/`, and wrong in
 * the only place it is ever evaluated. The library still built, the library
 * still tested green, and every application that depended on it failed at its
 * own build step with `Could not resolve ../network.worker.js`.
 *
 * Skipped when `dist` has not been built, so `pnpm test` on a fresh clone still
 * works; CI runs `pnpm build` before `pnpm test`, so it never skips there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const bundlePath = `${distDir}index.js`;
const workerPath = `${distDir}network.worker.js`;

const built = existsSync(bundlePath);

describe.skipIf(!built)('built package', () => {
  const bundle = built ? readFileSync(bundlePath, 'utf8') : '';

  it('emits the worker alongside the entry', () => {
    expect(existsSync(workerPath)).toBe(true);
  });

  it('references the worker by a path that resolves from dist/', () => {
    const match = bundle.match(/new URL\((["'])(.*?network\.worker\.js)\1/u);

    expect(match, 'no worker URL found in the bundle').not.toBeNull();

    const specifier = match?.[2] ?? '';
    expect(specifier).toBe('./network.worker.js');

    // The assertion that actually matters: whatever the specifier is, it has to
    // land on a file that exists.
    expect(existsSync(new URL(specifier, `file://${bundlePath}`))).toBe(true);
  });

  it('keeps the worker self-contained', () => {
    // The host application's bundler does not walk into a worker built this
    // way, so a bare `import 'phoenix'` left inside would 404 at runtime.
    const worker = readFileSync(workerPath, 'utf8');

    expect(worker).not.toMatch(/from\s*["']phoenix["']/u);
  });

  it('leaves the peer dependencies external in the entry', () => {
    // The opposite requirement for the library entry: inlining @iwsdk/core
    // would give the application a second ECS, with its own component storage.
    expect(bundle).toMatch(/from\s*["']@iwsdk\/core["']/u);
  });
});

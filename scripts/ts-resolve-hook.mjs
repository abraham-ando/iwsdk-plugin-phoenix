/**
 * Resolve TypeScript's `.js` import specifiers to the `.ts` files they mean.
 *
 * TypeScript source under `packages/client/src` imports siblings with a `.js`
 * suffix — the convention that makes the *emitted* JavaScript correct. Node
 * strips types natively but does not perform that remap, so importing any such
 * module directly fails on its own internal imports.
 *
 * `scripts/generate-cardinal.mjs` needs to do exactly that: it encodes the
 * golden vectors with the codec that actually ships, rather than a second
 * implementation that could agree with itself while disagreeing with the
 * client. Without this hook that only works by accident, for modules whose
 * relative imports happen to be absent — a generated component with a `quat`
 * field would break it.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      const resolved = await nextResolve(specifier, context);
      // Only remap when the `.js` genuinely does not exist: a real emitted
      // file must keep winning over its source.
      if (existsSync(fileURLToPath(resolved.url))) return resolved;
    } catch {
      // Fall through to the .ts attempt.
    }

    return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
  }

  return nextResolve(specifier, context);
}

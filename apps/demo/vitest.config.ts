import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Le rig de test vit dans `@iwsdk/cardinal-character-three`, avec
      // l'invariant qu'il encode (les 19 rôles d'os de HUMANOID) ; le
      // dupliquer ici le laisserait diverger en silence.
      //
      // Un alias plutôt qu'un `../../../packages/…` : le chemin relatif
      // traversait une frontière de paquet et cassait au premier déplacement
      // de fichier. Et un alias plutôt qu'un sous-chemin d'export du paquet :
      // ces fixtures sont du code de TEST, elles n'ont rien à faire dans la
      // surface publique que consomme la démo.
      '@character-three/fixtures': fileURLToPath(
        new URL('../../packages/character-three/test/fixtures', import.meta.url),
      ),
    },
  },
  test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'] },
});

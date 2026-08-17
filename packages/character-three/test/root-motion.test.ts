import { describe, it, expect, beforeAll } from 'vitest';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { sanitizeClip } from '../src/clips/sanitize';
import type { AnimationClip } from '@iwsdk/core';
import { clipsAvailable, loadRealClip, amplitudeXYZ, SKIP_REASON } from './fixtures/realClip';

// `roleOfNode` d'un rig RPM : les noms Mixamo, tels que la bibliothèque les
// exporte. Seule la hanche nous intéresse ici — c'est elle qui porte la
// translation.
const roleOfNode = (name: string): string | null => (name === 'Hips' ? 'root' : null);

const available = clipsAvailable();
const maybe = available ? describe : describe.skip;
if (!available) console.warn(`\n⚠️  root-motion.test.ts SAUTÉ : ${SKIP_REASON}\n`);

maybe('politique de root motion sur un vrai clip de marche', () => {
  let walk: AnimationClip;
  beforeAll(async () => {
    walk = await loadRealClip('walk-masculine.glb');
  });

  function hipsAmplitude(clip: AnimationClip): [number, number, number] {
    const track = clip.tracks.find((t) => t.name === 'Hips.position');
    expect(track, 'le clip doit porter une piste Hips.position').toBeDefined();
    return amplitudeXYZ(track!.values);
  }

  it('mesure bien un vrai voyage horizontal avant toute politique', () => {
    // Si ce garde tombe, ce n'est plus le bon clip et les trois tests
    // suivants ne prouveraient plus rien.
    const [x, , z] = hipsAmplitude(walk);
    expect(Math.max(x, z)).toBeGreaterThan(1);
  });

  it('« keep » laisse le voyage intact', () => {
    const before = hipsAmplitude(walk);
    const after = hipsAmplitude(sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'keep' }).clip);
    expect(after[0]).toBeCloseTo(before[0], 5);
    expect(after[2]).toBeCloseTo(before[2], 5);
  });

  it('« strip » retire la piste racine', () => {
    const { clip } = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'strip' });
    expect(clip.tracks.find((t) => t.name === 'Hips.position')).toBeUndefined();
  });

  it('« flatten » annule l horizontale et PRÉSERVE la verticale', () => {
    const before = hipsAmplitude(walk);
    const after = hipsAmplitude(sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' }).clip);
    expect(after[0]).toBeLessThan(1e-6);
    expect(after[2]).toBeLessThan(1e-6);
    // La verticale doit rester : c'est le balancement de la marche. Une
    // implémentation qui remettrait les trois axes à zéro passe les deux
    // assertions ci-dessus et tombe sur celle-ci.
    expect(after[1]).toBeCloseTo(before[1], 5);
    expect(after[1]).toBeGreaterThan(0);
  });

  it('« flatten » rebase sur la première clé au lieu de viser zéro', () => {
    const { clip } = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' });
    const track = clip.tracks.find((t) => t.name === 'Hips.position')!;
    const source = walk.tracks.find((t) => t.name === 'Hips.position')!;
    // X et Z valent la PREMIÈRE clé du clip source, pas 0 : les hanches ne
    // sont pas à l'origine de l'armature, et les y ramener téléporterait le
    // bassin.
    expect(track.values[0]).toBeCloseTo(source.values[0]!, 6);
    expect(track.values[2]).toBeCloseTo(source.values[2]!, 6);
  });

  it('ne mute jamais le clip source, partagé par tout le village', () => {
    const before = hipsAmplitude(walk);
    sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' });
    const after = hipsAmplitude(walk);
    expect(after[0]).toBeCloseTo(before[0], 6);
  });

  it('la clé de mémo inclut la politique', () => {
    // Même clip, même famille, mêmes rôles : seule la politique change. Une
    // clé qui l'ignorerait rendrait au second appelant le verdict du premier.
    const kept = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'keep' }).clip;
    const flat = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' }).clip;
    expect(flat).not.toBe(kept);
    expect(amplitudeXYZ(flat.tracks.find((t) => t.name === 'Hips.position')!.values)[0]).toBeLessThan(1e-6);
  });

  it('le défaut est « keep », donc les appelants de l étape 2 ne changent pas', () => {
    const withoutOptions = sanitizeClip(walk, HUMANOID, roleOfNode).clip;
    const explicitKeep = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'keep' }).clip;
    expect(hipsAmplitude(withoutOptions)[0]).toBeCloseTo(hipsAmplitude(explicitKeep)[0], 6);
  });
});

maybe('la vraie danse : dix-sept pistes de translation, seize constantes', () => {
  it('en retire seize sans lever, et garde la racine', async () => {
    const dance = await loadRealClip('dance-fixture.glb');
    const positions = dance.tracks.filter((t) => t.name.endsWith('.position'));
    expect(positions.length).toBe(17);

    const { clip, stripped } = sanitizeClip(dance, HUMANOID, roleOfNode);
    expect(stripped.length).toBe(16);
    expect(stripped).not.toContain('Hips.position');
    expect(clip.tracks.find((t) => t.name === 'Hips.position')).toBeDefined();
  });
});

maybe('les deux clips féminins suivent la même convention', () => {
  it.each(['idle-feminine.glb', 'walk-feminine.glb'])(
    '%s : une seule piste de translation, et c est la hanche',
    async (file) => {
      const clip = await loadRealClip(file);
      const positions = clip.tracks.filter((t) => t.name.endsWith('.position'));
      const moving = positions.filter((t) => Math.max(...amplitudeXYZ(t.values)) > 1e-6);
      expect(moving.map((t) => t.name)).toEqual(['Hips.position']);
    },
  );
});

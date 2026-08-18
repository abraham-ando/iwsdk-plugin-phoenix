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

  function hipsTrack(clip: AnimationClip) {
    const track = clip.tracks.find((t) => t.name === 'Hips.position');
    expect(track, 'le clip doit porter une piste Hips.position').toBeDefined();
    return track!;
  }

  function hipsAmplitude(clip: AnimationClip): [number, number, number] {
    return amplitudeXYZ(hipsTrack(clip).values);
  }

  /** Déplacement NET sur X et Z : dernière clé moins première. */
  function hipsNetXZ(clip: AnimationClip): [number, number] {
    const v = hipsTrack(clip).values;
    const last = v.length - 3;
    return [v[last]! - v[0]!, v[last + 2]! - v[2]!];
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

  it('« flatten » retire le VOYAGE, garde l oscillation, PRÉSERVE la verticale', () => {
    const before = hipsAmplitude(walk);
    const beforeNet = hipsNetXZ(walk);
    const flat = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' }).clip;
    const after = hipsAmplitude(flat);
    const afterNet = hipsNetXZ(flat);

    // Mesuré sur `walk-masculine.glb` (47 clés, 0 → 1,91667 s) :
    //
    //   axe | amplitude source | net source | amplitude après | net après
    //   X   | 0,05459 m        | 0,00005 m  | 0,05456 m       | 0
    //   Y   | 0,05222 m        | —          | 0,05222 m       | —  (intact)
    //   Z   | 3,20979 m        | 3,20979 m  | 0,04513 m       | 0
    //
    // Ce que `flatten` doit faire est retirer le DÉPLACEMENT NET, pas
    // l'horizontale : le voyage de 3,21 m disparaît…
    expect(beforeNet[1]).toBeGreaterThan(1); // garde : le voyage existait
    expect(Math.abs(afterNet[0])).toBeLessThan(1e-6);
    expect(Math.abs(afterNet[1])).toBeLessThan(1e-6);

    // …et le balancement LATÉRAL du bassin survit. C'est cette assertion qui
    // distingue « retirer le voyage » de « tout écraser » : l'épinglage de
    // chaque clé sur la clé 0 — le comportement d'avant — passe les deux
    // assertions ci-dessus et tombe sur celle-ci. 5,46 cm en X, c'est PLUS que
    // les 5,22 cm de balancement vertical que la politique conserve
    // délibérément ; les écraser était une perte plus grosse que celle qu'on
    // se donnait du mal à éviter.
    expect(after[0]).toBeGreaterThan(0.04);
    expect(after[0]).toBeCloseTo(before[0], 3);
    expect(after[2]).toBeGreaterThan(0.02);

    // La verticale doit rester intacte : c'est le balancement de la marche.
    // Une implémentation qui remettrait les trois axes à zéro passe tout ce
    // qui précède et tombe ici.
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
    const beforeNet = hipsNetXZ(walk);
    sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' });
    const after = hipsAmplitude(walk);
    const afterNet = hipsNetXZ(walk);
    expect(after[0]).toBeCloseTo(before[0], 6);
    // Z aussi, et sur le NET : c'est lui que `flatten` annule, donc c'est lui
    // qu'une mutation sur place aurait effacé du clip partagé.
    expect(afterNet[1]).toBeCloseTo(beforeNet[1], 6);
    expect(afterNet[1]).toBeGreaterThan(1);
  });

  it('la clé de mémo inclut la politique', () => {
    // Même clip, même famille, mêmes rôles : seule la politique change. Une
    // clé qui l'ignorerait rendrait au second appelant le verdict du premier.
    const kept = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'keep' }).clip;
    const flat = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' }).clip;
    expect(flat).not.toBe(kept);
    expect(Math.abs(hipsNetXZ(flat)[1])).toBeLessThan(1e-6);
    expect(hipsNetXZ(kept)[1]).toBeGreaterThan(1);
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

  it('« flatten » garde aussi le balancement latéral du rig FÉMININ', async () => {
    // Le rig féminin balance PLUS que le masculin, et c'est le cas qui rend la
    // perte de l'épinglage la plus visible. Mesuré sur `walk-feminine.glb`
    // (76 clés, 0 → 3,125 s) :
    //
    //   axe | amplitude source | net source | amplitude après | net après
    //   X   | 0,08256 m        | −0,00058 m | 0,08267 m       | 0
    //   Y   | 0,04545 m        | —          | 0,04545 m       | —  (intact)
    //   Z   | 4,38555 m        | 4,38555 m  | 0,14650 m       | 0
    const walk = await loadRealClip('walk-feminine.glb');
    const source = walk.tracks.find((t) => t.name === 'Hips.position')!.values;
    const { clip } = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' });
    const values = clip.tracks.find((t) => t.name === 'Hips.position')!.values;
    const last = values.length - 3;

    expect(Math.abs(values[last]! - values[0]!)).toBeLessThan(1e-6);
    expect(Math.abs(values[last + 2]! - values[2]!)).toBeLessThan(1e-6);
    // 8,26 cm de balancement latéral, contre 4,55 cm de balancement vertical :
    // l'épinglage jetait le plus grand des deux.
    expect(amplitudeXYZ(values)[0]).toBeGreaterThan(0.07);
    expect(amplitudeXYZ(values)[0]).toBeCloseTo(amplitudeXYZ(source)[0], 3);
  });
});

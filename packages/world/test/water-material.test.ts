import { describe, it, expect } from 'vitest';
import {
  WATER_UNIFORM_NAMES,
  buildWaterUniforms,
  waterVertexShader,
  waterFragmentShader,
} from '../src/water/WaterMaterial';
import { RIVER_WAVES_LOW } from '../src/water/waves';

describe('uniformes', () => {
  const uniforms = buildWaterUniforms(RIVER_WAVES_LOW);

  it('déclare exactement les uniformes annoncées', () => {
    expect(Object.keys(uniforms).sort()).toEqual([...WATER_UNIFORM_NAMES].sort());
  });

  it('aplatit cinq flottants par vague', () => {
    const packed = uniforms.uWaves!.value as number[];
    expect(packed.length).toBe(RIVER_WAVES_LOW.length * 5);
  });

  it('part à temps nul', () => {
    expect(uniforms.uTime!.value).toBe(0);
  });
});

describe('sources GLSL', () => {
  const vertex = waterVertexShader(RIVER_WAVES_LOW.length);
  const fragment = waterFragmentShader();

  it("n'utilise AUCUNE uniforme non déclarée", () => {
    // Un nom d'uniforme mal orthographié ne lève rien : il vaut simplement
    // zéro à l'exécution, et l'eau devient noire ou immobile sans un mot.
    const source = `${vertex}\n${fragment}`;
    const used = new Set(
      [...source.matchAll(/\buniform\s+\w+\s+(\w+)/g)].map((m) =>
        (m[1] as string).replace(/\[.*/, ''),
      ),
    );
    for (const name of used) {
      expect(WATER_UNIFORM_NAMES, `uniforme ${name} utilisée mais non déclarée`).toContain(name);
    }
    expect(used.size).toBeGreaterThan(3);
  });

  it('consomme les attributs que la géométrie fournit', () => {
    expect(vertex).toContain('aDepth');
    expect(vertex).toContain('aFlow');
  });

  it('transmet la profondeur au fragment', () => {
    expect(vertex).toMatch(/varying\s+float\s+vDepth/);
    expect(fragment).toMatch(/varying\s+float\s+vDepth/);
  });

  it('déroule une itération par vague déclarée', () => {
    // GLSL ES 1.0 exige des bornes de boucle constantes, et le nombre de
    // vagues dépend du niveau de qualité : la boucle est donc déroulée.
    // On compte les itérations, pas les indices : `uniform float uWaves[5]`
    // est la TAILLE du tableau pour une vague, non un accès à l'élément 5.
    const count = (src: string): number => [...src.matchAll(/vec2 dir = vec2\(/g)].length;
    expect(count(waterVertexShader(3))).toBe(3);
    expect(count(waterVertexShader(1))).toBe(1);
    expect(waterVertexShader(3)).toContain('uWaves[10]');
  });

  it('calcule un Fresnel de Schlick et une écume de rive', () => {
    expect(fragment).toContain('fresnel');
    expect(fragment).toContain('foam');
  });

  it('éteint les vagues près de la rive', () => {
    // Une crête sur trois centimètres d'eau flotterait dans le vide.
    expect(vertex).toContain('shore');
    expect(vertex).toMatch(/shore\s*\*/);
  });
});

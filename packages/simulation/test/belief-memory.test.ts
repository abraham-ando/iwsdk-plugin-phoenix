import { describe, it, expect } from 'vitest';
import { BeliefState, MAX_OBJECT_BELIEFS, type Belief } from '../src/agents/BeliefState';

function belief(id: string, tick: number): Belief {
  return { objectId: id, type: 'oak_tree', x: 0, z: 0, state: { woodLeft: 8 }, lastSeenTick: tick };
}

describe('BeliefState — borne de mémoire', () => {
  it("N'EXCÈDE JAMAIS LA BORNE, si loin qu'aille l'agent", () => {
    // Un agent qui parcourt 400 m croise des milliers d'arbres. Sans borne,
    // Mode-1 les note tous à chaque décision : 0,8 ms par agent et par tick.
    const bs = new BeliefState();
    for (let i = 0; i < MAX_OBJECT_BELIEFS * 5; i++) bs.learn(belief(`oak_${i}`, i));
    expect(bs.known()).toHaveLength(MAX_OBJECT_BELIEFS);
  });

  it("OUBLIE CE QU'IL A VU LE PLUS ANCIENNEMENT, jamais le plus récent", () => {
    // L'oubli doit porter sur ce qui ne sert plus. Évincer au hasard ferait
    // perdre à l'agent le buisson qu'il vient de repérer.
    const bs = new BeliefState();
    for (let i = 0; i < MAX_OBJECT_BELIEFS; i++) bs.learn(belief(`oak_${i}`, 100 + i));
    bs.learn(belief('ancien', 0));
    bs.learn(belief('recent', 9999));

    const ids = bs.known().map((b) => b.objectId);
    expect(ids).toContain('recent');
    expect(ids).not.toContain('ancien');
    expect(ids).not.toContain('oak_0'); // le plus ancien du lot initial
    expect(ids).toContain(`oak_${MAX_OBJECT_BELIEFS - 1}`);
  });

  it('ÉVINCE DE FAÇON DÉTERMINISTE quand les dates sont à égalité', () => {
    // Deux exécutions du même scénario doivent rendre le même instantané ;
    // une éviction dépendant de l'ordre d'insertion le romprait.
    const build = () => {
      const bs = new BeliefState();
      for (let i = 0; i < MAX_OBJECT_BELIEFS + 10; i++) bs.learn(belief(`oak_${i}`, 42));
      return bs.known().map((b) => b.objectId);
    };
    expect(build()).toEqual(build());
  });

  it("revoir un objet le rajeunit et le sauve de l'oubli", () => {
    const bs = new BeliefState();
    bs.learn(belief('vieux', 0));
    for (let i = 0; i < MAX_OBJECT_BELIEFS - 1; i++) bs.learn(belief(`oak_${i}`, 100 + i));
    bs.learn(belief('vieux', 10_000)); // revu
    bs.learn(belief('nouveau', 10_001));
    expect(bs.known().map((b) => b.objectId)).toContain('vieux');
  });
});

describe('BeliefState — known() mémoïsé', () => {
  it('VOIT LES ÉCRITURES FAITES APRÈS UNE PREMIÈRE LECTURE', () => {
    // Un cache qui ne s'invalide pas ferait décider Mode-1 sur un monde périmé.
    const bs = new BeliefState();
    bs.learn(belief('a', 1));
    expect(bs.known()).toHaveLength(1);
    bs.learn(belief('b', 2));
    expect(bs.known()).toHaveLength(2);
    bs.forget('a');
    expect(bs.known().map((b) => b.objectId)).toEqual(['b']);
  });

  it("reste trié par identifiant, ordre dont dépend le déterminisme", () => {
    const bs = new BeliefState();
    for (const id of ['c', 'a', 'b']) bs.learn(belief(id, 1));
    expect(bs.known().map((b) => b.objectId)).toEqual(['a', 'b', 'c']);
  });

  it("rend le même tableau tant que rien n'a changé", () => {
    // C'est la raison d'être de la mémoïsation : Mode-1 appelle known() à
    // chaque décision de chaque agent.
    const bs = new BeliefState();
    bs.learn(belief('a', 1));
    expect(bs.known()).toBe(bs.known());
  });
});

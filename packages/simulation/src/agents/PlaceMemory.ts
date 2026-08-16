import type { Observation } from './Perception';
import type { BiomeId } from '../world/biomes';
import { SCATTER_TILE } from '../world/scatter';

/**
 * La carte mentale d'un agent (spec E1 §5) : des lieux ACQUIS en marchant,
 * datés, donc faillibles. Aucune région n'est donnée d'emblée — un savoir
 * géographique fourni serait infaillible et non acquis, l'inverse d'une
 * croyance au sens du modèle du monde.
 *
 * La grille est celle du semis : un lieu cru et un lieu semé désignent
 * exactement la même case de 32 m.
 */
export interface PlaceBelief {
  /** Biome et tuile, par exemple 'forest@3,-2'. */
  readonly key: string;
  readonly biome: BiomeId;
  /** Centre de la tuile, non le pas de l'agent. */
  readonly x: number;
  readonly z: number;
  readonly lastSeenTick: number;
}

/**
 * Une centaine de tuiles couvre les 400 m simulés. La borne existe pour la
 * même raison que celle des objets : une mémoire qui décline est une mémoire
 * faillible.
 */
export const MAX_PLACE_BELIEFS = 128;

export function placeKey(biome: BiomeId, tileX: number, tileZ: number): string {
  return `${biome}@${tileX},${tileZ}`;
}

export function tileOf(v: number): number {
  return Math.floor(v / SCATTER_TILE);
}

function tileCenter(tile: number): number {
  return tile * SCATTER_TILE + SCATTER_TILE / 2;
}

export class PlaceMemory {
  private places = new Map<string, PlaceBelief>();

  /** Enregistre la tuile que l'agent foule à cet instant. */
  record(obs: Observation, x: number, z: number): void {
    const tileX = tileOf(x);
    const tileZ = tileOf(z);
    this.learnPlace({
      key: placeKey(obs.groundBiome, tileX, tileZ),
      biome: obs.groundBiome,
      x: tileCenter(tileX),
      z: tileCenter(tileZ),
      lastSeenTick: obs.tick,
    });
  }

  /**
   * Adopte un lieu, qu'il vienne des pieds de l'agent ou de la bouche d'un
   * autre. Comme pour les objets, la rumeur est datée du moment où on
   * l'entend, non du moment du fait.
   */
  learnPlace(belief: PlaceBelief): void {
    this.places.set(belief.key, { ...belief });
    if (this.places.size <= MAX_PLACE_BELIEFS) return;
    // À date égale, la clé tranche : l'éviction doit être déterministe.
    const oldestFirst = [...this.places.values()].sort(
      (a, b) => a.lastSeenTick - b.lastSeenTick || a.key.localeCompare(b.key)
    );
    const excess = this.places.size - MAX_PLACE_BELIEFS;
    for (let i = 0; i < excess; i++) this.places.delete(oldestFirst[i]!.key);
  }

  /** Tous les lieux connus, triés par clé. */
  all(): PlaceBelief[] {
    return [...this.places.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Les lieux connus d'un biome, du plus proche au plus lointain. C'est ce
   * qui donne à Mode-2 de quoi planifier un déplacement, au lieu de réagir à
   * ce qui passe à portée de vue.
   */
  placesOf(biome: BiomeId, fromX: number, fromZ: number): PlaceBelief[] {
    return this.all()
      .filter((p) => p.biome === biome)
      .sort(
        (a, b) =>
          Math.hypot(a.x - fromX, a.z - fromZ) - Math.hypot(b.x - fromX, b.z - fromZ) ||
          a.key.localeCompare(b.key)
      );
  }

  /**
   * Fraction des lieux crus dont le biome ne correspond plus à celui du
   * terrain, au centre mémorisé. Pendant du `divergenceFrom` des objets :
   * impossible à mesurer dans le monde réel, gratuit en simulation.
   *
   * Le tirage est injecté plutôt qu'importé, pour que la métrique se teste
   * sans dépendre du relief.
   */
  divergenceFrom(sample: (x: number, z: number) => BiomeId): number {
    const places = [...this.places.values()];
    if (places.length === 0) return 0;
    let wrong = 0;
    for (const place of places) {
      if (sample(place.x, place.z) !== place.biome) wrong++;
    }
    return wrong / places.length;
  }

  toJSON(): PlaceBelief[] {
    return this.all().map((p) => ({ ...p }));
  }
}

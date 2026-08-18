/**
 * Identifiants réseau fixes des onze villageois — patron d'`adoptSharedPlant`
 * (`multiplayer.ts`) : chaque pair crée déjà ce personnage localement et de
 * façon identique, il ne lui manque qu'une identité réseau CONNUE D'AVANCE.
 * Pas de SPAWN_ENTITY dynamique, pas d'ownership à arbitrer.
 *
 * Table explicite plutôt qu'un hachage : onze noms fixes et connus se
 * déclarent directement, ce qui est plus sûr et plus lisible qu'une fonction
 * dont il faudrait prouver l'absence de collision.
 *
 * Plage réservée à partir de 100_010 — au-dessus de SHARED_PLANT_ID
 * (100_001), avec neuf identifiants de marge pour tout objet fixe futur qui
 * s'intercalerait sans forcer une renumérotation. Loin au-dessus de ce que
 * `IdAllocator.local/0` (le compteur séquentiel des joueurs) atteindra
 * jamais en pratique — la même convention manuelle que la plante.
 */
export const VILLAGER_NETWORK_IDS: Readonly<Record<string, number>> = {
  haran: 100_010, mira: 100_011, lio: 100_012, aya: 100_013,
  dagan: 100_014, sira: 100_015, nia: 100_016, kan: 100_017,
  narek: 100_018, ivan: 100_019, tao: 100_020,
};

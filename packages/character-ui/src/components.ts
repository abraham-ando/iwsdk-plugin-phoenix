import { createComponent, Types } from '@iwsdk/core';

/**
 * L'onglet visible. UNIQUE source de vérité du routeur : IWSDK ne fournit
 * aucune navigation entre panneaux, donc c'est nous qui la tenons, et la tenir
 * à deux endroits est le moyen le plus sûr de les faire diverger.
 *
 * `Types.Enum` attend une MAP `{ clé: valeur }`, jamais un tableau : elics
 * valide le défaut par `Object.values(enum).includes(default)`, et le type
 * `EnumType` n'accepte pas `string[]`.
 */
export const CharacterUIRoute = createComponent('CharacterUIRoute', {
  tab: {
    type: Types.Enum,
    enum: { settings: 'settings', persona: 'persona' },
    default: 'settings',
    label: 'Onglet',
  },
});

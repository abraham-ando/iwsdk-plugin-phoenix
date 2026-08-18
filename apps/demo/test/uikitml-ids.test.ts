import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENE_ROW_IDS, TAB_IDS, TAB_BUTTON_IDS, PANEL_IDS } from '@iwsdk/cardinal-character-ui';

/**
 * Confronte le document RÉEL aux identifiants que les contrôleurs demandent.
 *
 * Un document factice ne voit jamais cette panne : le contrôleur appelle
 * `getElementById('gene-bar-stature')`, le document écrit `geneBarStature`, et
 * tous les tests à document factice passent pendant que le panneau reste vide.
 * C'est la panne la plus probable de cette étape, et la seule qu'aucun autre
 * test ne peut attraper.
 *
 * `NEED_ROW_IDS` et `PERSONA_IDS` naissent à la tâche 6, qui complétera ce
 * fichier avec les blocs correspondants — les référencer maintenant laisserait
 * le typecheck rouge entre les deux tâches.
 */
function idsDuDocument(): Set<string> {
  const chemin = join(__dirname, '../public/ui/character.uikitml');
  const source = readFileSync(chemin, 'utf8');
  const trouves = new Set<string>();
  for (const m of source.matchAll(/\bid="([^"]+)"/g)) trouves.add(m[1]!);
  return trouves;
}

describe('le contrat d identifiants du document', () => {
  const presents = idsDuDocument();

  it('le document en déclare un nombre plausible', () => {
    // Garde contre un fichier vide ou une regex qui ne matche rien : sans lui,
    // un document introuvable ferait passer tous les tests ci-dessous.
    expect(presents.size).toBeGreaterThan(50);
  });

  it('porte les treize lignes de gène, au complet', () => {
    const manquants: string[] = [];
    for (const [gene, ids] of Object.entries(GENE_ROW_IDS)) {
      for (const [role, id] of Object.entries(ids)) {
        if (!presents.has(id)) manquants.push(`${gene}.${role} → ${id}`);
      }
    }
    expect(manquants).toEqual([]);
  });

  it('porte les conteneurs d onglet, leurs boutons, et les champs du panneau', () => {
    const attendus = [
      ...Object.values(TAB_IDS),
      ...Object.values(TAB_BUTTON_IDS),
      ...Object.values(PANEL_IDS),
    ];
    expect(attendus.filter((id) => !presents.has(id))).toEqual([]);
  });
});

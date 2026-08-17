import type { PlanRequest } from './Mode2';

/**
 * Ce qu'il faut pour transformer une `PlanRequest` en question posée à un
 * modèle, et sa réponse en charge utile pour le moteur.
 *
 * Ces trois fonctions vivaient en privé dans le serveur BFF, et le moteur en
 * gardait une imitation dont le commentaire disait qu'elle « reflétait » la
 * version serveur. Trois consommateurs les veulent — le serveur, le
 * navigateur qui infère en local, et les exécutions sans tête — et une
 * imitation finit toujours par diverger de son modèle.
 *
 * Elles sont pures : ni réseau, ni horloge, ni aléa. Le transport appartient
 * à l'appelant.
 */

/** Consigne système, propre à la raison de la demande. */
export function buildSystemPrompt(request: Readonly<PlanRequest>): string {
  if (request.reason === 'dialogue') {
    const [a, b] = request.participantIds ?? ['A', 'B'];
    return (
      `Tu écris un court dialogue préhistorique en français entre ${a} et ${b}. ` +
      `Persona de ${a}: ${request.persona}. 2 à 4 répliques naturelles, informatives ` +
      `(ressources, dangers, liens). Réponds UNIQUEMENT en JSON: ` +
      `{"lines":[{"speaker":"${a}","text":"..."}],"sharedFacts":[{"objectId":"...","type":"...","x":0,"z":0,"state":{}}]} ` +
      `— sharedFacts reprend des croyances citées dans la requête, ou [].`
    );
  }
  if (request.reason === 'reflection') {
    return (
      `Tu es ${request.persona} (${request.role}, tribu ${request.tribe}). ` +
      `Synthétise la journée décrite (souvenirs fournis) en 1 à 3 enseignements durables, ` +
      `concrets et utiles demain. Réponds UNIQUEMENT en JSON: {"insights":["..."]}`
    );
  }
  if (request.reason === 'player_dialogue') {
    return (
      `Tu es ${request.persona} (${request.role}, tribu ${request.tribe}), un villageois ` +
      `préhistorique. Un étranger (le joueur, présent dans ta vallée) vient de te dire : ` +
      `"${request.playerText ?? ''}". Réponds-lui en 1 ou 2 phrases, dans ton personnage, ` +
      `en français. Réponds UNIQUEMENT en JSON: {"reply":"..."}`
    );
  }
  return (
    `Tu es ${request.persona} (${request.role}, tribu ${request.tribe}), un villageois autonome. ` +
    `Tes besoins (0-100, 100=satisfait sauf stress): ${JSON.stringify(request.needs)}. ` +
    `Choisis un plan de 1 à 4 pas parmi les outils fournis (verbe + objectId obligatoire pour ` +
    `les verbes-monde). Pour chaque pas, "predicted" décrit le résultat concret attendu. ` +
    `Réponds UNIQUEMENT en JSON: {"steps":[{"goal":"...","verb":"...","objectId":"...","predicted":"..."}]}`
  );
}

/**
 * Isole l'objet JSON d'une complétion bavarde. Lève si elle n'en contient
 * aucun d'entier : un plan tronqué doit faire échouer l'étage, pour que le
 * suivant prenne le relais — jamais être exécuté à moitié.
 */
export function extractPlanJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no json object in completion');
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * Recolle l'identité de la demande sur la réponse du modèle. Le moteur
 * apparie par `requestId` : un modèle qui l'oublie ou l'invente ferait perdre
 * le plan sans un mot, d'où la remise APRÈS l'étalement du contenu analysé.
 */
export function planEnvelope(
  request: Readonly<PlanRequest>,
  parsed: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return {
    ...parsed,
    requestId: request.requestId,
    reason: request.reason,
    agentId: request.agentId,
    ...(request.participantIds ? { participantIds: request.participantIds } : {}),
  };
}

/** Un planificateur : de quelque part, une charge utile pour le moteur. */
export type Planner = (request: Readonly<PlanRequest>) => Promise<Record<string, unknown>>;

export interface PlanTier {
  /** Nom lisible, rendu avec la réponse : il dit QUI a délibéré. */
  readonly name: string;
  readonly plan: Planner;
}

/**
 * Essaie les étages dans l'ordre et rend le premier qui répond.
 *
 * Ne lève jamais : l'appelant doit pouvoir libérer son drapeau d'attente,
 * faute de quoi l'agent resterait indéfiniment « en train de réfléchir ». Un
 * étage muet est un étage de moins, pas une panne.
 *
 * L'étage retenu est nommé dans le résultat, parce que la question « quel
 * modèle a produit ce plan ? » est celle qui rend la comparaison possible.
 */
export async function planWithTiers(
  request: Readonly<PlanRequest>,
  tiers: ReadonlyArray<PlanTier>
): Promise<{ tier: string; payload: Record<string, unknown> } | null> {
  for (const tier of tiers) {
    try {
      return { tier: tier.name, payload: await tier.plan(request) };
    } catch {
      // Étage suivant. La raison de l'échec appartient à l'étage, qui l'a
      // journalisée s'il l'a jugé utile.
    }
  }
  return null;
}

/**
 * Combien de jetons il faut laisser au modèle, selon ce qu'on lui demande.
 *
 * La valeur compte autant que la consigne : mesuré sur Llama-3.2-1B en local,
 * un plafond de 128 jetons — le défaut d'un adaptateur conçu pour des bulles
 * de dialogue — coupait le JSON au milieu du deuxième pas. L'extraction
 * échouait, l'étage tombait, et rien ne disait pourquoi.
 *
 * Généreux : un plafond trop haut ne coûte que le temps réellement consommé,
 * la génération s'arrêtant d'elle-même à la fin de l'objet.
 */
export function maxTokensFor(request: Readonly<PlanRequest>): number {
  switch (request.reason) {
    case 'player_dialogue':
      return 192; // une ou deux phrases
    case 'reflection':
      return 320; // un à trois enseignements
    case 'dialogue':
      return 640; // deux à quatre répliques, plus les faits partagés
    default:
      return 640; // un plan de un à quatre pas, chacun avec son résultat attendu
  }
}

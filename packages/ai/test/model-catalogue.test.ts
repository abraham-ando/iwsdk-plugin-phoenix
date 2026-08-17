import { describe, it, expect } from 'vitest';
import {
  LOCAL_MODELS,
  LOCAL_MODEL_VRAM_CEILING_MB,
  DEFAULT_LOCAL_MODEL,
  localModel,
} from '../src/models/catalogue';

describe('catalogue des modèles locaux', () => {
  it('CHAQUE ENTRÉE EXISTE POUR DE BON dans WebLLM', async () => {
    // Le défaut fondateur : `llama-3.2-1b-it-q4f16-MLC` a vécu des mois comme
    // défaut et dans la documentation sans exister nulle part. Un catalogue
    // affiché à l'utilisateur ne peut pas se permettre une seule invention.
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    const connus = new Map(prebuiltAppConfig.model_list.map((m) => [m.model_id, m]));
    for (const choix of LOCAL_MODELS) {
      expect(connus.has(choix.id), `${choix.id} est inconnu de WebLLM`).toBe(true);
    }
  });

  it("ANNONCE LA VRAM QUE WEBLLM ANNONCE, sans dérive", async () => {
    // Le chiffre est montré à l'utilisateur pour qu'il décide. S'il s'écarte
    // de la réalité, le panneau ment — et sur un casque, la mémoire est ce
    // qui décide si la session tient.
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    const connus = new Map(prebuiltAppConfig.model_list.map((m) => [m.model_id, m]));
    for (const choix of LOCAL_MODELS) {
      const reel = Math.round(connus.get(choix.id)!.vram_required_MB!);
      expect(choix.vramMB, `${choix.id} annoncé à ${choix.vramMB} Mo, WebLLM dit ${reel}`).toBe(reel);
    }
  });

  it('RESTE SOUS LE PLAFOND, faute de quoi le catalogue ne veut plus rien dire', () => {
    for (const choix of LOCAL_MODELS) {
      expect(choix.vramMB, choix.id).toBeLessThanOrEqual(LOCAL_MODEL_VRAM_CEILING_MB);
    }
  });

  it('propose le défaut parmi ses propres choix', () => {
    expect(localModel(DEFAULT_LOCAL_MODEL)).toBeDefined();
  });

  it('donne à chaque modèle un nom lisible et une mise en garde', () => {
    for (const choix of LOCAL_MODELS) {
      expect(choix.label.length, choix.id).toBeGreaterThan(2);
      expect(choix.note.length, choix.id).toBeGreaterThan(30);
    }
  });

  it("se présente du plus léger au plus lourd, comme on choisit", () => {
    const vram = LOCAL_MODELS.map((m) => m.vramMB);
    expect([...vram].sort((a, b) => a - b)).toEqual(vram);
  });

  it("ne propose aucun doublon", () => {
    expect(new Set(LOCAL_MODELS.map((m) => m.id)).size).toBe(LOCAL_MODELS.length);
  });
});

import { describe, it, expect } from 'vitest';
import { UIKitMLTemplateBuilder } from '../src/ui/UIKitMLTemplateBuilder';

describe('UIKitMLTemplateBuilder', () => {
  it('generates valid UIKitML markup for idle, thinking, and speaking states', () => {
    const idleXml = UIKitMLTemplateBuilder.buildSpeechBubble({
      npcName: 'Aldric',
      theme: 'fantasy',
    });
    expect(idleXml).toContain('<uikitml>');
    expect(idleXml).toContain('Aldric');
    expect(idleXml).toContain('class="dialogue-idle"');

    const thinkingXml = UIKitMLTemplateBuilder.buildSpeechBubble({
      npcName: 'Aldric',
      theme: 'cyberpunk',
      isThinking: true,
      emotionTag: 'JOY',
    });
    expect(thinkingXml).toContain('class="thinking-text"');
    expect(thinkingXml).toContain('<badge class="emotion-badge">JOY</badge>');
    expect(thinkingXml).toContain('#00ffcc');

    const speakingXml = UIKitMLTemplateBuilder.buildSpeechBubble({
      npcName: 'Aldric',
      theme: 'minimal',
      speechText: 'Bienvenue aventurier dans la cité!',
      karaokeWordIndex: 1,
    });
    expect(speakingXml).toContain('class="word-active">aventurier');
    expect(speakingXml).toContain('class="word-normal">dans');
  });

  it('n emploie aucune unité px : UIKitML compte en centimètres', () => {
    const xml = UIKitMLTemplateBuilder.buildSpeechBubble({ npcName: 'Test' });
    // `/px\b/` et non `/\d+px/` : le motif précédent exigeait un chiffre
    // COLLÉ au `px` et laissait donc passer toute unité qui n'en a pas juste
    // avant — `calc(1rem + px)`, `"{size}px"` après interpolation, un `px`
    // séparé de sa valeur par une espace. Ici on refuse l'unité elle-même.
    expect(xml).not.toMatch(/px\b/);
  });
});

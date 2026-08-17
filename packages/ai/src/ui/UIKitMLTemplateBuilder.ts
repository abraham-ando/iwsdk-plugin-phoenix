export type DialogueTheme = 'fantasy' | 'cyberpunk' | 'minimal';

export interface DialoguePanelOptions {
  npcName: string;
  theme?: DialogueTheme;
  speechText?: string;
  isThinking?: boolean;
  emotionTag?: string;
  karaokeWordIndex?: number;
}

/**
 * Generates declarative UIKitML XML templates for native 3D spatial UI rendering in IWSDK.
 */
export class UIKitMLTemplateBuilder {
  /**
   * Build an IWSDK UIKitML spatial speech bubble template.
   */
  public static buildSpeechBubble(options: DialoguePanelOptions): string {
    const {
      npcName,
      theme = 'fantasy',
      speechText = '',
      isThinking = false,
      emotionTag,
      karaokeWordIndex = 0,
    } = options;

    const styles = this.getThemeStyles(theme);

    let contentXml = '';
    if (isThinking) {
      contentXml = `<text class="thinking-text">💭 Réflexion en cours...</text>`;
    } else if (speechText) {
      const words = speechText.split(/\s+/);
      const formattedWords = words.map((w, idx) => {
        const cls = idx === karaokeWordIndex ? 'word-active' : 'word-normal';
        return `<span class="${cls}">${w} </span>`;
      });
      contentXml = `<text class="dialogue-body">${formattedWords.join('')}</text>`;
    } else {
      contentXml = `<text class="dialogue-idle">...</text>`;
    }

    const emotionXml = emotionTag
      ? `<badge class="emotion-badge">${emotionTag}</badge>`
      : '';

    // Les tailles UIKitML sont en centimètres, pas en pixels : un panneau à
    // 32 fait 32 cm de large, pas 320 px. Aucune unité ne doit apparaître —
    // le nombre nu est déjà l'unité.
    return `<uikitml>
  <style>
    .panel-root {
      background-color: ${styles.bgColor};
      border: ${styles.border};
      border-radius: ${styles.borderRadius};
      padding: 1.6;
      width: 32;
      color: ${styles.textColor};
      font-family: 'Inter', sans-serif;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.8;
    }
    .npc-name {
      font-size: 1.6;
      font-weight: bold;
      color: ${styles.accentColor};
    }
    .emotion-badge {
      font-size: 1.1;
      background-color: ${styles.badgeBg};
      padding: 0.2 0.8;
      border-radius: 1.2;
    }
    .dialogue-body {
      font-size: 1.4;
      line-height: 1.4;
    }
    .word-active {
      color: ${styles.activeWordColor};
      font-weight: bold;
    }
    .word-normal {
      color: ${styles.textColor};
    }
    .thinking-text {
      font-size: 1.3;
      font-style: italic;
      color: ${styles.accentColor};
    }
  </style>
  <panel class="panel-root">
    <container class="header-row">
      <text class="npc-name">${npcName}</text>
      ${emotionXml}
    </container>
    ${contentXml}
  </panel>
</uikitml>`;
  }

  private static getThemeStyles(theme: DialogueTheme) {
    switch (theme) {
      case 'cyberpunk':
        return {
          bgColor: 'rgba(10, 15, 30, 0.88)',
          border: '0.1 solid #00ffcc',
          borderRadius: '0.8',
          textColor: '#e0f7fa',
          accentColor: '#00ffcc',
          activeWordColor: '#ff007f',
          badgeBg: 'rgba(0, 255, 204, 0.2)',
        };
      case 'minimal':
        return {
          bgColor: 'rgba(255, 255, 255, 0.15)',
          border: '0.1 solid rgba(255, 255, 255, 0.3)',
          borderRadius: '1.6',
          textColor: '#ffffff',
          accentColor: '#60a5fa',
          activeWordColor: '#fbbf24',
          badgeBg: 'rgba(255, 255, 255, 0.2)',
        };
      case 'fantasy':
      default:
        return {
          bgColor: 'rgba(38, 28, 20, 0.92)',
          border: '0.2 solid #d4af37',
          borderRadius: '1.2',
          textColor: '#fef3c7',
          accentColor: '#d4af37',
          activeWordColor: '#f59e0b',
          badgeBg: 'rgba(212, 175, 55, 0.25)',
        };
    }
  }
}

/**
 * Cardinal AI Interactive Testing HUD
 * Provides in-browser test controls for Spatial RAG, Guardrails, Function Calling,
 * Multi-Agent Banter, and RPM Gestures.
 */

export interface AIHudCallbacks {
  onTalkToEldrin: () => void;
  onTestGarrickGuardrail: () => void;
  onTradeWithSylvia: () => void;
  onTriggerGroupBanter: () => void;
  onTriggerRPMEmote: (emote: string) => void;
  onThrowPhysicsProp?: () => void;
}

export class CardinalAIHud {
  private root: HTMLDivElement;
  private logContainer: HTMLDivElement;

  constructor(container: HTMLElement, callbacks: AIHudCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'cardinal-ai-hud';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '100',
      width: '320px',
      padding: '14px',
      borderRadius: '12px',
      font: '12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#f0f6fc',
      background: 'rgba(13, 17, 23, 0.88)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(88, 166, 255, 0.25)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    } satisfies Partial<CSSStyleDeclaration>);

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.innerHTML = `
      <div style="font-weight: 700; font-size: 13px; color: #58a6ff; display: flex; align-items: center; gap: 6px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950;box-shadow:0 0 8px #3fb950"></span>
        Cardinal AI Console
      </div>
      <span style="font-size: 10px; color: #22c55e; background: rgba(34, 197, 94, 0.12); padding: 2px 6px; border-radius: 4px; font-weight: 600;">Havok Physics Active</span>
    `;
    this.root.appendChild(header);

    const buttonGrid = document.createElement('div');
    buttonGrid.style.display = 'grid';
    buttonGrid.style.gridTemplateColumns = '1fr 1fr';
    buttonGrid.style.gap = '6px';

    const btnEldrin = this.createButton('🔮 Eldrin (RAG)', '#1f6feb', callbacks.onTalkToEldrin);
    const btnGarrick = this.createButton('🛡️ Garrick (Guard)', '#da3633', callbacks.onTestGarrickGuardrail);
    const btnSylvia = this.createButton('💰 Sylvia (Trade)', '#d29922', callbacks.onTradeWithSylvia);
    const btnBanter = this.createButton('🗣️ Cercle PNJ', '#8957e5', callbacks.onTriggerGroupBanter);

    buttonGrid.appendChild(btnEldrin);
    buttonGrid.appendChild(btnGarrick);
    buttonGrid.appendChild(btnSylvia);
    buttonGrid.appendChild(btnBanter);
    this.root.appendChild(buttonGrid);

    if (callbacks.onThrowPhysicsProp) {
      const btnPhysics = this.createButton('☄️ Lancer Silex (Physique Havok)', '#059669', callbacks.onThrowPhysicsProp);
      btnPhysics.style.gridColumn = 'span 2';
      this.root.appendChild(btnPhysics);
    }

    const emoteRow = document.createElement('div');
    emoteRow.style.display = 'flex';
    emoteRow.style.gap = '4px';
    const btnWave = this.createSmallButton('👋 Saluer', () => callbacks.onTriggerRPMEmote('wave'));
    const btnBow = this.createSmallButton('🙇 Révérence', () => callbacks.onTriggerRPMEmote('bow'));
    const btnShrug = this.createSmallButton('🤷 Hausser épaules', () => callbacks.onTriggerRPMEmote('shrug'));
    emoteRow.appendChild(btnWave);
    emoteRow.appendChild(btnBow);
    emoteRow.appendChild(btnShrug);
    this.root.appendChild(emoteRow);

    // Live Feed
    const logHeader = document.createElement('div');
    logHeader.textContent = 'Journal d\'Intelligence Spatiale :';
    logHeader.style.fontSize = '10px';
    logHeader.style.color = '#8b949e';
    logHeader.style.marginTop = '4px';
    this.root.appendChild(logHeader);

    this.logContainer = document.createElement('div');
    Object.assign(this.logContainer.style, {
      maxHeight: '140px',
      overflowY: 'auto',
      background: 'rgba(0, 0, 0, 0.4)',
      borderRadius: '6px',
      padding: '6px 8px',
      fontSize: '11px',
      fontFamily: 'ui-monospace, monospace',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      border: '1px solid rgba(255,255,255,0.06)',
    });
    this.root.appendChild(this.logContainer);

    container.appendChild(this.root);
    this.log('Système Cardinal AI initialisé avec 3 PNJs.');
  }

  public log(message: string, type: 'info' | 'agent' | 'rag' | 'guard' = 'info'): void {
    const entry = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let color = '#c9d1d9';
    if (type === 'agent') color = '#58a6ff';
    if (type === 'rag') color = '#7ee787';
    if (type === 'guard') color = '#f85149';

    entry.innerHTML = `<span style="color:#6e7681;font-size:9px;">[${time}]</span> <span style="color:${color}">${message}</span>`;
    this.logContainer.appendChild(entry);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  private createButton(label: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '6px 8px',
      borderRadius: '6px',
      border: 'none',
      background: color,
      color: '#ffffff',
      fontWeight: '600',
      fontSize: '11px',
      cursor: 'pointer',
      transition: 'opacity 0.2s',
    });
    btn.onmouseenter = () => { btn.style.opacity = '0.85'; };
    btn.onmouseleave = () => { btn.style.opacity = '1.0'; };
    btn.onclick = onClick;
    return btn;
  }

  private createSmallButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      flex: '1',
      padding: '4px 6px',
      borderRadius: '4px',
      border: '1px solid rgba(255,255,255,0.15)',
      background: 'rgba(255,255,255,0.08)',
      color: '#e6edf3',
      fontSize: '10px',
      cursor: 'pointer',
    });
    btn.onclick = onClick;
    return btn;
  }

  public dispose(): void {
    this.root.remove();
  }
}

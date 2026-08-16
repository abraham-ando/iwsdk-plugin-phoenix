/**
 * Simulation HUD — Living Civilization Dashboard.
 * Displays the Cardinal simulation engine state (day/hour, weather, agent
 * needs) and its narrative event stream, with divine interventions wired to
 * REAL engine actions (weather forcing, resource blessing).
 */

import type { CardinalSimulationSystem, SimEvent } from './CardinalSimulationSystem';

const WEATHER_ICONS: Record<string, string> = {
  clear: '☀️',
  cloudy: '☁️',
  rain: '🌧️',
  storm: '⛈️',
};

export class SimulationHud {
  private root: HTMLDivElement;
  private statsRow: HTMLDivElement;
  private feedContainer: HTMLDivElement;
  private system: CardinalSimulationSystem;
  private statsTimer: number;

  constructor(container: HTMLElement, system: CardinalSimulationSystem) {
    this.system = system;

    this.root = document.createElement('div');
    this.root.id = 'simulation-civ-hud';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '150',
      width: '360px',
      maxHeight: '90vh',
      padding: '16px',
      borderRadius: '16px',
      font: '12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#f0f6fc',
      background: 'rgba(10, 14, 20, 0.92)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(245, 158, 11, 0.35)',
      boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65)',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    } satisfies Partial<CSSStyleDeclaration>);

    // Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.innerHTML = `
      <div>
        <div style="font-weight: 800; font-size: 14px; color: #fbbf24; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🔥</span> Monde Préhistorique Autonome
        </div>
        <div style="font-size: 10px; color: #94a3b8;">Moteur Cardinal Simulation · 11 agents autonomes</div>
      </div>
    `;
    this.root.appendChild(header);

    // Telemetry Cards
    this.statsRow = document.createElement('div');
    this.statsRow.style.display = 'grid';
    this.statsRow.style.gridTemplateColumns = 'repeat(3, 1fr)';
    this.statsRow.style.gap = '6px';
    this.root.appendChild(this.statsRow);
    this.updateStats();
    this.statsTimer = window.setInterval(() => this.updateStats(), 1000);

    // Divine Intervention Controls (only actions wired to real engine state)
    const godSection = document.createElement('div');
    godSection.style.display = 'flex';
    godSection.style.flexDirection = 'column';
    godSection.style.gap = '6px';

    const godTitle = document.createElement('div');
    godTitle.innerHTML = `<span style="color:#f59e0b;font-weight:700;">👑 Interventions Divines :</span>`;
    godSection.appendChild(godTitle);

    const godGrid = document.createElement('div');
    godGrid.style.display = 'grid';
    godGrid.style.gridTemplateColumns = '1fr 1fr 1fr';
    godGrid.style.gap = '6px';

    godGrid.appendChild(
      this.createButton('🌧️ Tempête', '#475569', () => this.system.forceRain())
    );
    godGrid.appendChild(
      this.createButton('☀️ Ciel Dégagé', '#d97706', () => this.system.forceClear())
    );
    godGrid.appendChild(
      this.createButton('✨ Bénédiction', '#059669', () => this.system.grantBlessing())
    );

    godSection.appendChild(godGrid);
    this.root.appendChild(godSection);

    // Live Emergent Story Feed
    const feedHeader = document.createElement('div');
    feedHeader.innerHTML = `<span style="color:#94a3b8;font-size:10px;font-weight:600;">📜 CHRONIQUES ÉMERGENTES DU MONDE :</span>`;
    this.root.appendChild(feedHeader);

    this.feedContainer = document.createElement('div');
    Object.assign(this.feedContainer.style, {
      maxHeight: '220px',
      overflowY: 'auto',
      background: 'rgba(0, 0, 0, 0.45)',
      borderRadius: '8px',
      padding: '8px',
      fontSize: '11px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      border: '1px solid rgba(255,255,255,0.08)',
    });
    this.root.appendChild(this.feedContainer);

    container.appendChild(this.root);

    this.system.subscribe((event) => {
      this.addEventToFeed(event);
      this.updateStats();
    });
  }

  private updateStats(): void {
    const agents = [...this.system.runtime.agents.values()];
    const avgHunger =
      agents.length === 0
        ? 0
        : Math.round(agents.reduce((sum, a) => sum + a.needs.hunger, 0) / agents.length);
    const weatherIcon = WEATHER_ICONS[this.system.weather.current] ?? '☀️';

    this.statsRow.innerHTML = `
      <div style="background:rgba(255,255,255,0.05);padding:6px;border-radius:6px;text-align:center;">
        <div style="color:#94a3b8;font-size:9px;">JOUR & HEURE</div>
        <div style="font-weight:700;color:#f8fafc;font-size:12px;">J${this.system.dayIndex()} · ${Math.floor(this.system.hourOfDaySim())}h ${weatherIcon}</div>
      </div>
      <div style="background:rgba(255,255,255,0.05);padding:6px;border-radius:6px;text-align:center;">
        <div style="color:#94a3b8;font-size:9px;">POPULATION</div>
        <div style="font-weight:700;color:#38bdf8;font-size:12px;">${this.system.runtime.agents.size} Âmes</div>
      </div>
      <div style="background:rgba(255,255,255,0.05);padding:6px;border-radius:6px;text-align:center;">
        <div style="color:#94a3b8;font-size:9px;">FAIM MOYENNE</div>
        <div style="font-weight:700;color:#f43f5e;font-size:12px;">${avgHunger}%</div>
      </div>
    `;
  }

  private addEventToFeed(event: SimEvent): void {
    const entry = document.createElement('div');
    let border = 'rgba(255,255,255,0.1)';
    let color = '#e2e8f0';

    if (event.kind === 'weather') {
      border = 'rgba(245, 158, 11, 0.4)';
      color = '#fef08a';
    } else if (event.kind === 'day') {
      border = 'rgba(59, 130, 246, 0.4)';
      color = '#bfdbfe';
    }

    entry.style.borderLeft = `3px solid ${border}`;
    entry.style.paddingLeft = '6px';
    entry.style.color = color;
    entry.innerHTML = `<span style="color:#64748b;font-size:9px;">[Jour ${this.system.dayIndex()}]</span> ${event.text}`;

    this.feedContainer.appendChild(entry);
    // Keep the feed bounded: the sim emits continuously for hours.
    while (this.feedContainer.childElementCount > 120) {
      this.feedContainer.firstElementChild?.remove();
    }
    this.feedContainer.scrollTop = this.feedContainer.scrollHeight;
  }

  private createButton(label: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '7px 8px',
      borderRadius: '8px',
      border: 'none',
      background: color,
      color: '#ffffff',
      fontWeight: '600',
      fontSize: '11px',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    });
    btn.onmouseenter = () => { btn.style.filter = 'brightness(1.15)'; };
    btn.onmouseleave = () => { btn.style.filter = 'none'; };
    btn.onclick = onClick;
    return btn;
  }

  public dispose(): void {
    window.clearInterval(this.statsTimer);
    this.root.remove();
  }
}

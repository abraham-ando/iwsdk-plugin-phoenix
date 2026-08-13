/**
 * A DOM status readout, overlaid on the canvas.
 *
 * Plain DOM rather than a spatial UIKit panel on purpose: this is diagnostics
 * for whoever is testing the demo on a desktop browser, and it needs to stay
 * readable when the interesting failure is "nothing appeared in the room". A
 * panel that lives inside the scene cannot tell you the scene is empty.
 *
 * The XR view is unaffected — the overlay belongs to the page, not the session.
 */
import type { ConnectionState } from '@iwsdk/plugin-phoenix';

export interface DemoHudOptions {
  /** One-line description of what we are connecting to. */
  target: string;
}

export class DemoHud {
  private readonly root: HTMLDivElement;
  private readonly connectionLine: HTMLSpanElement;
  private readonly peersLine: HTMLSpanElement;
  private readonly heldLine: HTMLSpanElement;

  private peerCount = -1;

  constructor(container: HTMLElement, options: DemoHudOptions) {
    this.root = document.createElement('div');
    this.root.setAttribute('data-testid', 'network-hud');
    Object.assign(this.root.style, {
      position: 'fixed',
      bottom: '12px',
      left: '12px',
      zIndex: '10',
      padding: '10px 14px',
      borderRadius: '10px',
      font: '12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
      color: '#e8edf2',
      background: 'rgba(12, 16, 22, 0.78)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);

    this.root.appendChild(line('target', options.target));
    this.connectionLine = valueOf(this.root.appendChild(line('status', 'starting…')));
    this.peersLine = valueOf(this.root.appendChild(line('peers', '0')));
    this.heldLine = valueOf(this.root.appendChild(line('holding', '—')));

    container.appendChild(this.root);
  }

  setConnection(state: ConnectionState, networkId: number): void {
    this.setStatus(networkId > 0 ? `${state} · you are #${networkId}` : state);
  }

  /** Free-form status, for conditions that are not a connection state. */
  setStatus(text: string): void {
    this.connectionLine.textContent = text;
  }

  setPeerCount(count: number): void {
    // Called every frame; touching the DOM only on a change keeps it off the
    // frame budget.
    if (count === this.peerCount) return;
    this.peerCount = count;
    this.peersLine.textContent = String(count);
  }

  setHeld(networkId: number): void {
    this.heldLine.textContent = networkId > 0 ? `#${networkId}` : '—';
  }

  dispose(): void {
    this.root.remove();
  }
}

function line(label: string, value: string): HTMLDivElement {
  const row = document.createElement('div');

  const name = document.createElement('span');
  name.textContent = `${label.padEnd(8)} `;
  name.style.opacity = '0.55';

  const content = document.createElement('span');
  content.textContent = value;

  row.append(name, content);
  return row;
}

function valueOf(row: HTMLDivElement): HTMLSpanElement {
  return row.lastElementChild as HTMLSpanElement;
}

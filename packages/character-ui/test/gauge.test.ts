import { describe, it, expect } from 'vitest';
import { renderGauge } from '../src/gauge';
import { makeFakeDocument } from './fixtures/fakeDocument';

describe('la jauge', () => {
  it('pilote la largeur de la barre en pourcentage', () => {
    const { doc, props } = makeFakeDocument(['bar', 'val']);
    renderGauge(doc, 'bar', 'val', 0.72, '0.72');
    expect(props.get('bar')?.width).toBe('72%');
  });

  it('borne la fraction hors de [0,1] au lieu de produire une largeur absurde', () => {
    const { doc, props } = makeFakeDocument(['bar', 'val']);
    renderGauge(doc, 'bar', 'val', 1.4, 'x');
    expect(props.get('bar')?.width).toBe('100%');
    renderGauge(doc, 'bar', 'val', -0.3, 'x');
    expect(props.get('bar')?.width).toBe('0%');
  });

  it('écrit le texte de valeur séparément de la barre', () => {
    // Une barre juste et un texte faux est le pire des deux mondes : on voit
    // une valeur et on en lit une autre.
    const { doc, texts } = makeFakeDocument(['bar', 'val']);
    renderGauge(doc, 'bar', 'val', 0.5, '0.50');
    expect(texts.get('val')).toBe('0.50');
  });

  it('ne lève pas si la barre manque du document', () => {
    const { doc } = makeFakeDocument([]);
    expect(() => renderGauge(doc, 'bar', 'val', 0.5, '0.50')).not.toThrow();
  });
});

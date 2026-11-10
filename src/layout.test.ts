import { describe, expect, it } from 'vitest';
import { layoutMap, wrapText } from './layout';
import { addChild, addFree, createMap, shiftNode } from './model';

describe('Layout', () => {
  it('radial: Kinder liegen im gleichen Abstand um die Wurzel', () => {
    const m = createMap('R');
    m.layout = 'radial';
    const r = m.roots[0];
    for (let i = 0; i < 4; i++) addChild(m, r, 'K' + i);
    const b = layoutMap(m);
    const dists = m.nodes[r].children.map((c) => Math.hypot(b[c].x - b[r].x, b[c].y - b[r].y));
    for (const d of dists) expect(d).toBeCloseTo(dists[0], 5);
    expect(new Set(m.nodes[r].children.map((c) => b[c].branch)).size).toBe(4);
  });

  it('tree: Kinder rechts vom Elternknoten, ohne Überlappung', () => {
    const m = createMap('R');
    m.layout = 'tree';
    const r = m.roots[0];
    const a = addChild(m, r, 'A');
    const c = addChild(m, r, 'B');
    const b = layoutMap(m);
    expect(b[a].x).toBeGreaterThan(b[r].x);
    expect(Math.abs(b[a].y - b[c].y)).toBeGreaterThanOrEqual(b[a].h);
  });

  it('freie Knoten behalten ihre Position', () => {
    const m = createMap('R');
    const f = addFree(m, 500, -300, 'Frei');
    const b = layoutMap(m);
    expect(b[f]).toMatchObject({ x: 500, y: -300 });
  });

  it('manuelle Verschiebung wirkt auch auf den Teilbaum', () => {
    const m = createMap('R');
    const r = m.roots[0];
    const a = addChild(m, r, 'A');
    const a1 = addChild(m, a, 'A1');
    const before = layoutMap(m);
    shiftNode(m, a, 40, -25);
    const after = layoutMap(m);
    expect(after[a].x - before[a].x).toBeCloseTo(40);
    expect(after[a1].y - before[a1].y).toBeCloseTo(-25);
    expect(after[r]).toMatchObject({ x: before[r].x, y: before[r].y });
  });

  it('beidseitig: Hauptäste verteilen sich auf links und rechts, Unterknoten folgen nach außen', () => {
    const m = createMap('R');
    const r = m.roots[0];
    const ids = ['A', 'B', 'C', 'D'].map((t) => addChild(m, r, t));
    const sub = addChild(m, ids[3], 'D1');
    const b = layoutMap(m);
    const sides = ids.map((i) => b[i].side);
    expect(sides).toContain(1);
    expect(sides).toContain(-1);
    for (const i of ids) expect(Math.sign(b[i].x - b[r].x)).toBe(b[i].side);
    expect(Math.sign(b[sub].x - b[ids[3]].x)).toBe(b[ids[3]].side);
  });

  it('lange Texte werden mehrzeilig, Knoten bleiben unter der Maximalbreite', () => {
    const m = createMap('R');
    const long = addChild(m, m.roots[0], 'Das ist ein sehr langer Text der in mehrere Zeilen umgebrochen werden muss damit der Knoten nicht zu breit wird');
    const b = layoutMap(m);
    expect(b[long].lines.length).toBeGreaterThan(1);
    expect(b[long].w).toBeLessThan(360);
    expect(b[long].h).toBeGreaterThan(b[m.roots[0]].h / 2);
  });

  it('wrapText trennt zu lange Wörter hart und begrenzt die Zeilenzahl', () => {
    expect(wrapText('a b c', 10)).toEqual(['a b c']);
    expect(wrapText('Donaudampfschifffahrt', 8).every((l) => l.length <= 8)).toBe(true);
    expect(wrapText('Kosten-/Ertragserfassung', 14)[0]).toBe('Kosten-/');
    expect(wrapText('wort '.repeat(200), 10).length).toBeLessThanOrEqual(8);
  });
});

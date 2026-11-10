import { describe, expect, it } from 'vitest';
import { layoutMap } from './layout';
import { addChild, addFree, createMap } from './model';

describe('Layout', () => {
  it('radial: Kinder liegen im gleichen Abstand um die Wurzel', () => {
    const m = createMap('R');
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
});

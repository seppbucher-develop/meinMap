import { describe, expect, it } from 'vitest';
import {
  addChild, addFree, addSibling, canMove, computeDone, createMap, deleteNode,
  detachToFree, isDerived, moveNode, sanitizeMap, setType, toggleDone,
} from './model';

function setup() {
  const m = createMap('Root');
  const root = m.roots[0];
  const a = addChild(m, root, 'A');
  const b = addChild(m, root, 'B');
  const a1 = addChild(m, a, 'A1');
  const a2 = addChild(m, a, 'A2');
  return { m, root, a, b, a1, a2 };
}

describe('Struktur', () => {
  it('legt Geschwister direkt hinter dem Knoten an', () => {
    const { m, root, a, b } = setup();
    const c = addSibling(m, a, 'C');
    expect(m.nodes[root].children).toEqual([a, c, b]);
  });

  it('Geschwister eines Wurzelknotens ist ein freier Knoten', () => {
    const { m, root } = setup();
    const f = addSibling(m, root);
    expect(m.roots).toEqual([root, f]);
    expect(m.nodes[f].parent).toBeNull();
  });

  it('löscht den Teilbaum', () => {
    const { m, a, a1 } = setup();
    deleteNode(m, a);
    expect(m.nodes[a]).toBeUndefined();
    expect(m.nodes[a1]).toBeUndefined();
  });
});

describe('Umhängen', () => {
  it('als Kind, davor und danach', () => {
    const { m, root, a, b, a1 } = setup();
    expect(moveNode(m, b, a, 'child')).toBe(true);
    expect(m.nodes[a].children.slice(-1)).toEqual([b]);
    expect(m.nodes[b].parent).toBe(a);
    expect(m.nodes[root].children).toEqual([a]);
    moveNode(m, b, a1, 'before');
    expect(m.nodes[a].children[0]).toBe(b);
    moveNode(m, b, a1, 'after');
    expect(m.nodes[a].children.indexOf(b)).toBe(m.nodes[a].children.indexOf(a1) + 1);
  });

  it('verbietet Zyklen und Geschwister von Wurzeln', () => {
    const { m, root, a, a1 } = setup();
    expect(canMove(m, a, a1, 'child')).toBe(false);
    expect(canMove(m, a, a, 'child')).toBe(false);
    expect(canMove(m, a, root, 'before')).toBe(false);
    expect(moveNode(m, a, a1, 'child')).toBe(false);
  });

  it('freie Knoten lassen sich anhängen und wieder lösen', () => {
    const { m, root } = setup();
    const f = addFree(m, 300, 300, 'Frei');
    expect(moveNode(m, f, root, 'child')).toBe(true);
    expect(m.roots).toEqual([root]);
    expect(m.nodes[f].x).toBeUndefined();
    detachToFree(m, f, 10, 20);
    expect(m.roots).toEqual([root, f]);
    expect(m.nodes[f]).toMatchObject({ parent: null, x: 10, y: 20 });
    expect(m.nodes[root].children).not.toContain(f);
  });
});

describe('Done-Logik', () => {
  it('info zählt als done, Eltern werden abgeleitet', () => {
    const { m, a, a1, a2 } = setup();
    setType(m, a, 'checkbox');
    setType(m, a1, 'checkbox');
    setType(m, a2, 'info');
    expect(computeDone(m)[a]).toBe(false);
    toggleDone(m, a1);
    expect(computeDone(m)[a]).toBe(true);
    toggleDone(m, a1);
    expect(computeDone(m)[a]).toBe(false);
  });

  it('propagiert über mehrere Ebenen', () => {
    const { m, root, a, b, a1, a2 } = setup();
    for (const id of [root, a, b, a1, a2]) setType(m, id, 'checkbox');
    toggleDone(m, a1);
    toggleDone(m, a2);
    expect(computeDone(m)[a]).toBe(true);
    expect(computeDone(m)[root]).toBe(false);
    toggleDone(m, b);
    expect(computeDone(m)[root]).toBe(true);
  });

  it('Knoten ohne Typ nehmen nicht teil, ihre Kinder zählen durch', () => {
    const { m, root, a, b, a1, a2 } = setup();
    setType(m, root, 'checkbox');
    setType(m, b, 'checkbox');
    setType(m, a1, 'checkbox');
    setType(m, a2, 'info');
    const d = () => computeDone(m)[root];
    expect(computeDone(m)[a]).toBeNull();
    toggleDone(m, b);
    expect(d()).toBe(false); // a1 (unter A ohne Typ) fehlt noch
    toggleDone(m, a1);
    expect(d()).toBe(true);
  });

  it('Blatt-Checkbox nutzt eigenen Haken, Eltern-Checkbox ist abgeleitet', () => {
    const { m, a, a1 } = setup();
    setType(m, a, 'checkbox');
    setType(m, a1, 'checkbox');
    expect(isDerived(m, a)).toBe(true);
    expect(isDerived(m, a1)).toBe(false);
  });
});

describe('Import', () => {
  it('lehnt Müll ab und repariert Inkonsistenzen', () => {
    expect(() => sanitizeMap(null)).toThrow();
    const { m } = setup();
    const copy = JSON.parse(JSON.stringify(m));
    const ids = Object.keys(copy.nodes);
    copy.nodes[ids[1]].parent = ids[2];
    copy.nodes[ids[2]].parent = ids[1]; // Zyklus
    const fixed = sanitizeMap(copy);
    expect(fixed.roots.length).toBeGreaterThan(0);
  });
});

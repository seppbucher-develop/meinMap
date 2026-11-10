import { describe, expect, it } from 'vitest';
import { aiPackage, applyParsed, mapFromOutline, parseOutline, toOutline } from './outline';
import { addChild, computeDone, createMap, setType, toggleDone } from './model';

describe('Outline', () => {
  it('Roundtrip erhält Struktur, Typen und Done-Zustand', () => {
    const m = createMap('Plan');
    const r = m.roots[0];
    const a = addChild(m, r, 'A');
    const b = addChild(m, r, 'B');
    setType(m, a, 'checkbox'); toggleDone(m, a);
    setType(m, b, 'info');
    const back = mapFromOutline(toOutline(m));
    const ids = Object.values(back.nodes);
    expect(back.title).toBe('Plan');
    expect(ids.map((n) => n.text).sort()).toEqual(['A', 'B', 'Plan']);
    const d = computeDone(back);
    const A = ids.find((n) => n.text === 'A')!;
    expect(A.type).toBe('checkbox');
    expect(d[A.id]).toBe(true);
    expect(ids.find((n) => n.text === 'B')!.type).toBe('info');
  });

  it('liest KI-Antworten im Codeblock und gemischte Aufzählungszeichen', () => {
    const p = parseOutline('Hier:\n```markdown\n# T\n* Wurzel\n\t* [x] Kind\n    1. [ ] Enkel?\n```\nfertig');
    expect(p.title).toBe('T');
    expect(p.roots).toHaveLength(1);
    expect(p.roots[0].children[0]).toMatchObject({ text: 'Kind', type: 'checkbox', done: true });
    expect(p.roots[0].children[0].children[0]).toMatchObject({ text: 'Enkel?', type: 'checkbox', done: false });
  });

  it('mehrere Wurzeln = freie Knoten, applyParsed behält Layout und Positionen', () => {
    const m = createMap('X');
    m.layout = 'tree';
    m.nodes[m.roots[0]].x = 42;
    applyParsed(m, parseOutline('- Neu\n  - K\n- Frei'));
    expect(m.layout).toBe('tree');
    expect(m.roots).toHaveLength(2);
    expect(m.nodes[m.roots[0]].x).toBe(42);
    expect(m.title).toBe('X');
  });

  it('KI-Paket enthält die Gliederung, die sich wieder importieren lässt', () => {
    const m = createMap('Proj');
    addChild(m, m.roots[0], 'Eins');
    const back = mapFromOutline(aiPackage(m));
    expect(back.title).toBe('Proj');
    expect(Object.keys(back.nodes)).toHaveLength(2);
  });

  it('wirft bei leerem Text', () => {
    expect(() => parseOutline('  \n')).toThrow();
  });
});

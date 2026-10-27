// STL and 3MF writers: sizes, headers and escaping of part names.

import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { toStl } from '../src/export/stl';
import { to3mf, xmlAttr } from '../src/export/threemf';
import type { MeshOut } from '../src/geometry/protocol';

// One tetrahedron: 4 vertices, 4 triangles.
const tetra = (name: string): MeshOut => ({
  name,
  role: 'part',
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
});

describe('toStl', () => {
  it('writes a binary STL with one record per triangle', async () => {
    const buf = new DataView(await toStl([tetra('a'), tetra('b')]).arrayBuffer());
    expect(buf.byteLength).toBe(84 + 8 * 50);
    expect(buf.getUint32(80, true)).toBe(8);
  });

  it('writes unit normals', async () => {
    const buf = new DataView(await toStl([tetra('a')]).arrayBuffer());
    for (let t = 0; t < 4; t++) {
      const o = 84 + t * 50;
      const n = Math.hypot(buf.getFloat32(o, true), buf.getFloat32(o + 4, true), buf.getFloat32(o + 8, true));
      expect(n).toBeCloseTo(1, 5);
    }
  });
});

describe('to3mf', () => {
  it('packs one object per part', async () => {
    const zip = unzipSync(new Uint8Array(await to3mf([tetra('Cortador'), tetra('Sello')]).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(zip['3D/3dmodel.model']);
    expect(model.match(/<object /g)).toHaveLength(2);
    expect(model.match(/<triangle /g)).toHaveLength(8);
  });

  it('escapes part names so they cannot break the XML', async () => {
    const zip = unzipSync(new Uint8Array(await to3mf([tetra('a"><script>x</script>&')]).arrayBuffer()));
    const model = strFromU8(zip['3D/3dmodel.model']);
    expect(model).not.toContain('<script>');
    expect(model).toContain('name="a&quot;&gt;&lt;script&gt;x&lt;/script&gt;&amp;"');
  });

  it('xmlAttr leaves plain text alone', () => {
    expect(xmlAttr('Cortador 8 cm')).toBe('Cortador 8 cm');
  });
});

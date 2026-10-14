// 3MF writer: one <object> per part, all placed on the build plate.

import { zipSync, strToU8 } from 'fflate';
import type { MeshOut } from '../geometry/protocol';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const f = (v: number) => (Math.round(v * 1e4) / 1e4).toString();

export function to3mf(meshes: MeshOut[]): Blob {
  const parts: string[] = [];
  const items: string[] = [];
  meshes.forEach((m, k) => {
    const id = k + 1;
    const P = m.positions, I = m.indices;
    const verts: string[] = [];
    for (let i = 0; i < P.length; i += 3) verts.push(`<vertex x="${f(P[i])}" y="${f(P[i + 1])}" z="${f(P[i + 2])}"/>`);
    const tris: string[] = [];
    for (let i = 0; i < I.length; i += 3) tris.push(`<triangle v1="${I[i]}" v2="${I[i + 1]}" v3="${I[i + 2]}"/>`);
    parts.push(
      `<object id="${id}" name="${m.name}" type="model"><mesh><vertices>${verts.join('')}</vertices>` +
        `<triangles>${tris.join('')}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="es-AR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">CookieMaker</metadata>
  <resources>${parts.join('\n')}</resources>
  <build>${items.join('')}</build>
</model>`;
  const zip = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  });
  return new Blob([zip as BlobPart], { type: 'model/3mf' });
}

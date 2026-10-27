// @vitest-environment happy-dom
// The SVG check exists twice, in the app (isCleanSvg) and in the database
// (private.is_clean_svg). Both must agree, and both must accept everything
// designToSvg writes.

import { describe, expect, it } from 'vitest';
import { designToSvg, isCleanSvg, parseSvg, SAMPLES } from '@app/core';
import { tx } from './db';

const cases: [string, string][] = [
  ...SAMPLES.map((s): [string, string] => [`muestra ${s.id}`, designToSvg(parseSvg(s.svg, 100))]),
  ['vacío', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">\n\n</svg>\n'],
  ['script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
  ['onload', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0Z"/></svg>'],
  ['url()', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0Z" fill="url(#a)"/></svg>'],
  ['javascript:', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0Z" fill="javascript:alert(1)"/></svg>'],
  ['entidad', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0Z" fill="&#x23;000"/></svg>'],
  ['doctype', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>'],
  ['comentario', '<svg xmlns="http://www.w3.org/2000/svg"><!-- x --></svg>'],
  ['CDATA', '<svg xmlns="http://www.w3.org/2000/svg"><![CDATA[x]]></svg>'],
  ['comillas simples', "<svg xmlns='http://www.w3.org/2000/svg'></svg>"],
  ['atributo sin comillas', '<svg xmlns="http://www.w3.org/2000/svg"><path d=M0/></svg>'],
  ['otro namespace', '<svg xmlns="http://evil.example"><path d="M0 0Z"/></svg>'],
  ['xlink', '<svg xmlns="http://www.w3.org/2000/svg"><path xlink:href="x" d="M0 0Z"/></svg>'],
  ['style', '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:red" d="M0 0Z"/></svg>'],
  ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject></foreignObject></svg>'],
  ['texto después', '<svg xmlns="http://www.w3.org/2000/svg"></svg><script>x</script>'],
  ['texto antes', 'x<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
  ['no es svg', 'hola'],
  ['etiqueta en mayúsculas', '<SVG xmlns="http://www.w3.org/2000/svg"></SVG>'],
];

describe('clean SVG check', () => {
  it('accepts what designToSvg writes', () => {
    for (const [name, svg] of cases.filter(([n]) => n.startsWith('muestra'))) expect(isCleanSvg(svg), name).toBe(true);
  });

  it('the app and the database agree on every case', async () => {
    await tx(async (t) => {
      for (const [name, svg] of cases) {
        const db = (await t.query<{ ok: boolean }>('select private.is_clean_svg($1) as ok', [svg])).rows[0].ok;
        expect(db, name).toBe(isCleanSvg(svg));
      }
    });
  });

  it('rejects everything that is not a plain path', () => {
    const bad = cases.filter(([n]) => !n.startsWith('muestra') && n !== 'vacío');
    for (const [name, svg] of bad) expect(isCleanSvg(svg), name).toBe(false);
  });
});

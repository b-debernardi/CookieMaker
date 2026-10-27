// The cloud library: only Pro writes, each user sees only their own cutters,
// and what gets stored is checked.

import { describe, expect, it } from 'vitest';
import { PNG, SVG, tx, type Tx } from './db';

const addItem = async (t: Tx, name = 'Estrella', svg = SVG) =>
  (await t.query<{ id: string }>("insert into public.items (name, source, svg) values ($1, 'svg', $2) returning id", [name, svg])).rows[0].id;

const addVersion = async (t: Tx, item: string, size = 80, piece = 'cutter') =>
  (await t.query<{ id: string }>(
    "insert into public.versions (item_id, piece, params, size, dims) values ($1, $2, '{\"sizeW\": 80}', $3, '{80, 80, 16}') returning id",
    [item, piece, size],
  )).rows[0].id;

describe('who can use the library', () => {
  it('a free user has no library', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.as(u);
      expect((await t.error("insert into public.items (name, source, svg) values ('x', 'svg', $1)", [SVG]))?.message).toMatch(/row-level security/);
      expect((await t.query('select * from public.items')).rows).toEqual([]);
    });
  });

  it('a Pro user creates, lists, edits and deletes their cutters and versions', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.grantPro(u);
      await t.as(u);
      const item = await addItem(t);
      const v = await addVersion(t, item);
      expect((await t.query('select user_id from public.items')).rows).toEqual([{ user_id: u }]);
      await t.query("update public.items set name = 'Estrella grande', thumb = $2 where id = $1", [item, PNG]);
      await t.query("update public.versions set params = '{\"sizeW\": 90}' where id = $1", [v]);
      expect((await t.query('delete from public.versions where id = $1', [v])).rowCount).toBe(1);
      expect((await t.query('delete from public.items where id = $1', [item])).rowCount).toBe(1);
    });
  });

  it('after Pro ends the library can be read and deleted, not changed', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.grantPro(u);
      await t.as(u);
      const item = await addItem(t);
      await addVersion(t, item);
      await t.asOwner();
      await t.query("update public.grants set until = now() - interval '1 day' where user_id = $1", [u]);
      await t.as(u);
      expect((await t.query('select id from public.items')).rows).toHaveLength(1);
      expect((await t.query('select id from public.versions')).rows).toHaveLength(1);
      expect((await t.query("update public.items set name = 'otro'")).rowCount).toBe(0);
      expect((await t.error("insert into public.items (name, source, svg) values ('x', 'svg', $1)", [SVG]))?.message).toMatch(/row-level security/);
      expect((await t.query('delete from public.items where id = $1', [item])).rowCount).toBe(1);
      expect((await t.query('select id from public.versions')).rows).toHaveLength(0);
    });
  });

  it('6 months after Pro ends nothing is visible', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.grantPro(u);
      await t.as(u);
      await addItem(t);
      await t.asOwner();
      await t.query("update public.grants set until = now() - interval '7 months' where user_id = $1", [u]);
      await t.as(u);
      expect((await t.query('select id from public.items')).rows).toEqual([]);
    });
  });
});

describe('isolation between users', () => {
  it('a Pro user cannot see, change or delete someone else’s cutters', async () => {
    await tx(async (t) => {
      const a = await t.createUser(), b = await t.createUser();
      await t.grantPro(a);
      await t.grantPro(b);
      await t.as(a);
      const item = await addItem(t);
      await addVersion(t, item);
      await t.as(b);
      expect((await t.query('select * from public.items')).rows).toEqual([]);
      expect((await t.query('select * from public.versions')).rows).toEqual([]);
      expect((await t.query("update public.items set name = 'mío' where id = $1", [item])).rowCount).toBe(0);
      expect((await t.query('delete from public.items where id = $1', [item])).rowCount).toBe(0);
    });
  });

  it('cannot create a cutter in someone else’s name', async () => {
    await tx(async (t) => {
      const a = await t.createUser(), b = await t.createUser();
      await t.grantPro(a);
      await t.as(a);
      expect((await t.error("insert into public.items (user_id, name, source, svg) values ($1, 'x', 'svg', $2)", [b, SVG]))?.message).toMatch(/permission denied/);
    });
  });

  it('cannot add a version to someone else’s cutter', async () => {
    await tx(async (t) => {
      const a = await t.createUser(), b = await t.createUser();
      await t.grantPro(a);
      await t.grantPro(b);
      await t.as(a);
      const item = await addItem(t);
      await t.as(b);
      const e = await t.error("insert into public.versions (item_id, piece, params, size, dims) values ($1, 'cutter', '{}', 80, '{1,1,1}')", [item]);
      expect(e?.message).toMatch(/foreign key|row-level security/);
    });
  });

  it('cannot move a cutter to another user', async () => {
    await tx(async (t) => {
      const a = await t.createUser(), b = await t.createUser();
      await t.grantPro(a);
      await t.as(a);
      const item = await addItem(t);
      expect((await t.error('update public.items set user_id = $2 where id = $1', [item, b]))?.message).toMatch(/permission denied/);
    });
  });
});

describe('what gets stored', () => {
  const asPro = async (t: Tx) => {
    const u = await t.createUser();
    await t.grantPro(u);
    await t.as(u);
    return u;
  };

  it('rejects an SVG that is not the app’s clean SVG', async () => {
    await tx(async (t) => {
      await asPro(t);
      for (const svg of [
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0Z"/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0Z" fill="url(javascript:alert(1))"/></svg>',
        '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'hola',
      ]) {
        expect((await t.error("insert into public.items (name, source, svg) values ('x', 'svg', $1)", [svg]))?.message, svg).toMatch(/items_svg_clean/);
      }
    });
  });

  it('rejects thumbnails that are not small PNGs', async () => {
    await tx(async (t) => {
      await asPro(t);
      const item = await addItem(t);
      expect((await t.error('update public.items set thumb = $2 where id = $1', [item, Buffer.from('<svg/>')]))?.message).toMatch(/items_thumb_png/);
      const big = Buffer.concat([PNG, Buffer.alloc(70_000)]);
      expect((await t.error('update public.items set thumb = $2 where id = $1', [item, big]))?.message).toMatch(/items_thumb_png/);
    });
  });

  it('rejects parameters that are not an object or are too large', async () => {
    await tx(async (t) => {
      await asPro(t);
      const item = await addItem(t);
      const ins = "insert into public.versions (item_id, piece, params, size, dims) values ($1, 'cutter', $2, 80, '{1,1,1}')";
      expect(await t.error(ins, [item, '[1, 2]'])).not.toBeNull();
      expect(await t.error(ins, [item, JSON.stringify({ x: 'a'.repeat(40_000) })])).not.toBeNull();
    });
  });

  it('saving the same size and piece again conflicts, so the app replaces it', async () => {
    await tx(async (t) => {
      await asPro(t);
      const item = await addItem(t);
      await addVersion(t, item, 80.2);
      expect((await t.error("insert into public.versions (item_id, piece, params, size, dims) values ($1, 'cutter', '{}', 79.9, '{1,1,1}')", [item]))?.message).toMatch(/duplicate key/);
      await addVersion(t, item, 80, 'stamp');
      const r = await t.query(
        `insert into public.versions (item_id, piece, params, size, dims) values ($1, 'cutter', '{"v": 2}', 80, '{1,1,1}')
         on conflict (item_id, piece, size_mm) do update set params = excluded.params, size = excluded.size returning params`,
        [item],
      );
      expect(r.rows[0]).toEqual({ params: { v: 2 } });
    });
  });

  it('caps versions per cutter at 20', async () => {
    await tx(async (t) => {
      await asPro(t);
      const item = await addItem(t);
      for (let s = 1; s <= 20; s++) await addVersion(t, item, s * 10);
      const e = await t.error("insert into public.versions (item_id, piece, params, size, dims) values ($1, 'cutter', '{}', 999, '{1,1,1}')", [item]);
      expect(e?.hint).toBe('versions_limit');
    });
  });

  it('caps cutters per account at 500', async () => {
    await tx(async (t) => {
      await asPro(t);
      await t.query("insert into public.items (name, source, svg) select 'c' || g, 'svg', $1 from generate_series(1, 500) g", [SVG]);
      expect((await t.error("insert into public.items (name, source, svg) values ('otro', 'svg', $1)", [SVG]))?.hint).toBe('items_limit');
    });
  });
});

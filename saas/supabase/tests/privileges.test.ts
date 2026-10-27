// What the database exposes at all: RLS everywhere, no stray grants, safe
// SECURITY DEFINER functions, and what a visitor without an account can do.

import { describe, expect, it } from 'vitest';
import { tx } from './db';

describe('catalog', () => {
  it('every table in public has RLS on', async () => {
    await tx(async (t) => {
      const r = await t.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
      );
      expect(r.rows.map((x) => x.relname)).toEqual([]);
    });
  });

  it('every SECURITY DEFINER function pins an empty search_path', async () => {
    await tx(async (t) => {
      const r = await t.query<{ fn: string }>(
        `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.prosecdef
           and not coalesce(p.proconfig @> array['search_path=""'], false)`,
      );
      expect(r.rows.map((x) => x.fn)).toEqual([]);
    });
  });

  it('no function in public or private can be run by everyone (PUBLIC)', async () => {
    await tx(async (t) => {
      const r = await t.query<{ fn: string }>(
        `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private')
           and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')`,
      );
      expect(r.rows.map((x) => x.fn)).toEqual([]);
    });
  });

  it('only the expected functions are callable from the API', async () => {
    await tx(async (t) => {
      const r = await t.query<{ fn: string; role: string }>(
        `select p.proname as fn, a.grantee::regrole::text as role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
              aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee::regrole::text in ('anon', 'authenticated')
         order by 1, 2`,
      );
      expect(r.rows.map((x) => `${x.fn}:${x.role}`)).toEqual([
        'delete_my_account:authenticated',
        'export_my_data:authenticated',
        'my_plan:anon',
        'my_plan:authenticated',
        'register_export:authenticated',
      ]);
    });
  });
});

describe('visitor without an account', () => {
  it('can read the settings (price) and nothing else', async () => {
    await tx(async (t) => {
      await t.asAnon();
      const s = await t.query('select price_usd, free_exports_per_month from public.settings');
      expect(s.rows).toHaveLength(1);
      for (const table of ['profiles', 'items', 'versions', 'exports', 'subscriptions', 'grants', 'audit_log']) {
        const e = await t.error(`select * from public.${table}`);
        expect(e?.message, table).toMatch(/permission denied/);
      }
    });
  });

  it('cannot change the settings', async () => {
    await tx(async (t) => {
      await t.asAnon();
      expect((await t.error('update public.settings set free_exports_per_month = 100'))?.message).toMatch(/permission denied/);
    });
  });

  it('gets "anon" from my_plan and cannot register an export', async () => {
    await tx(async (t) => {
      await t.asAnon();
      const r = await t.query<{ p: { plan: string } }>('select public.my_plan() as p');
      expect(r.rows[0].p.plan).toBe('anon');
      expect((await t.error("select public.register_export('imprint')"))?.message).toMatch(/permission denied/);
    });
  });

  it('cannot reach the private schema', async () => {
    await tx(async (t) => {
      await t.asAnon();
      expect((await t.error('select private.entitlement_of(null)'))?.message).toMatch(/permission denied/);
    });
  });
});

describe('signed-in user', () => {
  it('cannot write the tables only the server writes', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.as(u);
      expect((await t.error("insert into public.exports (user_id, piece, plan) values ($1, 'cutter', 'pro')", [u]))?.message).toMatch(/permission denied/);
      expect((await t.error("insert into public.grants (user_id, until, reason) values ($1, now() + interval '1 year', 'yo')", [u]))?.message).toMatch(/permission denied/);
      expect((await t.error("insert into public.subscriptions (user_id, provider_id, status) values ($1, 'x', 'authorized')", [u]))?.message).toMatch(/permission denied/);
      expect((await t.error('delete from public.exports'))?.message).toMatch(/permission denied/);
    });
  });

  it('can rename themselves but not make themselves admin', async () => {
    await tx(async (t) => {
      const u = await t.createUser('Ana');
      await t.as(u);
      const r = await t.query<{ display_name: string }>("update public.profiles set display_name = 'Ana María' where id = $1 returning display_name", [u]);
      expect(r.rows[0].display_name).toBe('Ana María');
      expect((await t.error("update public.profiles set role = 'admin' where id = $1", [u]))?.message).toMatch(/permission denied/);
    });
  });

  it('sees only their own profile', async () => {
    await tx(async (t) => {
      const a = await t.createUser('A');
      await t.createUser('B');
      await t.as(a);
      const r = await t.query<{ id: string }>('select id from public.profiles');
      expect(r.rows.map((x) => x.id)).toEqual([a]);
    });
  });

  it('cannot change the settings unless admin', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      const admin = await t.createUser();
      await t.query("update public.profiles set role = 'admin' where id = $1", [admin]);
      await t.as(u);
      const r = await t.query('update public.settings set free_exports_per_month = 50');
      expect(r.rowCount).toBe(0);
      await t.as(admin);
      const r2 = await t.query('update public.settings set price_ars = 9000 returning price_ars');
      expect(r2.rows[0]).toEqual({ price_ars: 9000 });
    });
  });
});

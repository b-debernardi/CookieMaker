// Sign-up, downloading your data and deleting your account.

import { describe, expect, it } from 'vitest';
import { SVG, tx } from './db';

describe('sign-up', () => {
  it('creates a profile with the name from Google, cut to 80 characters', async () => {
    await tx(async (t) => {
      const u = await t.createUser('x'.repeat(100));
      const r = await t.query<{ display_name: string; role: string }>('select display_name, role from public.profiles where id = $1', [u]);
      expect(r.rows[0]).toEqual({ display_name: 'x'.repeat(80), role: 'user' });
    });
  });
});

describe('export_my_data', () => {
  it('returns the user’s own data and nobody else’s', async () => {
    await tx(async (t) => {
      const a = await t.createUser('Ana'), b = await t.createUser('Beto');
      await t.grantPro(a);
      await t.grantPro(b);
      await t.as(b);
      await t.query("insert into public.items (name, source, svg) values ('de Beto', 'svg', $1)", [SVG]);
      await t.as(a);
      await t.query("insert into public.items (name, source, svg) values ('de Ana', 'svg', $1)", [SVG]);
      await t.query("select public.register_export('cutter')");
      const d = (await t.query<{ d: Record<string, unknown[]> & { profile: { display_name: string } } }>('select public.export_my_data() as d')).rows[0].d;
      expect(d.profile.display_name).toBe('Ana');
      expect(d.items.map((i) => (i as { name: string }).name)).toEqual(['de Ana']);
      expect(d.exports).toHaveLength(1);
      expect(d.grants).toHaveLength(1);
    });
  });
});

describe('delete_my_account', () => {
  it('deletes the user and everything they own', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.grantPro(u);
      await t.as(u);
      await t.query("insert into public.items (name, source, svg) values ('x', 'svg', $1)", [SVG]);
      await t.query("select public.register_export('cutter')");
      await t.query('select public.delete_my_account()');
      await t.asOwner();
      for (const table of ['auth.users', 'public.profiles']) {
        expect((await t.query(`select 1 from ${table} where id = $1`, [u])).rows, table).toEqual([]);
      }
      for (const table of ['items', 'exports', 'grants']) {
        expect((await t.query(`select 1 from public.${table} where user_id = $1`, [u])).rows, table).toEqual([]);
      }
    });
  });

  it('refuses while a subscription is running', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.query("insert into public.subscriptions (user_id, provider_id, status, current_period_end) values ($1, 'mp-1', 'authorized', now() + interval '10 days')", [u]);
      await t.as(u);
      expect((await t.error('select public.delete_my_account()'))?.hint).toBe('subscription_active');
    });
  });

  it('only ever deletes the caller', async () => {
    await tx(async (t) => {
      const a = await t.createUser(), b = await t.createUser();
      await t.as(a);
      await t.query('select public.delete_my_account()');
      await t.asOwner();
      expect((await t.query('select 1 from auth.users where id = $1', [b])).rows).toHaveLength(1);
    });
  });
});

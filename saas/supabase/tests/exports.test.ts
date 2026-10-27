// The export counter: free is 3 imprints per calendar month (Argentina time),
// Pro is unlimited, and everyone has a daily ceiling.

import { describe, expect, it } from 'vitest';
import { tx, type Tx } from './db';

interface Res { ok: boolean; reason?: string; plan: string; used?: number; limit?: number }
const exp = async (t: Tx, piece = 'imprint') => (await t.query<{ r: Res }>('select public.register_export($1) as r', [piece])).rows[0].r;
const plan = async (t: Tx) => (await t.query<{ p: { plan: string; free_exports_used: number; free_exports_limit: number } }>('select public.my_plan() as p')).rows[0].p;

describe('register_export', () => {
  it('free: three imprints a month, then the limit', async () => {
    await tx(async (t) => {
      await t.as(await t.createUser());
      expect(await exp(t)).toEqual({ ok: true, plan: 'free', used: 1, limit: 3 });
      expect((await exp(t)).used).toBe(2);
      expect((await exp(t)).used).toBe(3);
      expect(await exp(t)).toEqual({ ok: false, reason: 'limit', plan: 'free', used: 3, limit: 3 });
      expect(await plan(t)).toEqual({ plan: 'free', free_exports_used: 3, free_exports_limit: 3 });
    });
  });

  it('free: other pieces are Pro only and do not use up the free exports', async () => {
    await tx(async (t) => {
      await t.as(await t.createUser());
      for (const piece of ['cutter', 'stamp', 'set']) expect(await exp(t, piece)).toEqual({ ok: false, reason: 'pro_only', plan: 'free' });
      expect((await plan(t)).free_exports_used).toBe(0);
    });
  });

  it('exports from last month do not count', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.query(
        `insert into public.exports (user_id, piece, plan, created_at)
         select $1, 'imprint', 'free', date_trunc('month', now(), 'America/Argentina/Buenos_Aires') - interval '1 minute'
         from generate_series(1, 3)`,
        [u],
      );
      await t.as(u);
      expect((await exp(t)).ok).toBe(true);
    });
  });

  it('the monthly limit follows the settings', async () => {
    await tx(async (t) => {
      await t.query('update public.settings set free_exports_per_month = 1');
      await t.as(await t.createUser());
      expect((await exp(t)).ok).toBe(true);
      expect((await exp(t)).reason).toBe('limit');
    });
  });

  it('Pro: any piece, no monthly limit, and Pro exports never count against free', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.grantPro(u);
      await t.as(u);
      for (let i = 0; i < 5; i++) expect(await exp(t, 'set')).toEqual({ ok: true, plan: 'pro' });
      await t.asOwner();
      await t.query("update public.grants set until = now() - interval '1 day' where user_id = $1", [u]);
      await t.as(u);
      expect(await exp(t)).toEqual({ ok: true, plan: 'pro_readonly', used: 1, limit: 3 });
    });
  });

  it('a daily ceiling stops scripts, even on Pro', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await t.grantPro(u);
      await t.query("insert into public.exports (user_id, piece, plan) select $1, 'cutter', 'pro' from generate_series(1, 300)", [u]);
      await t.as(u);
      expect(await exp(t, 'cutter')).toEqual({ ok: false, reason: 'rate_limited', plan: 'pro' });
    });
  });

  it('rejects unknown pieces', async () => {
    await tx(async (t) => {
      await t.as(await t.createUser());
      expect((await t.error("select public.register_export('cohete')"))?.hint).toBe('bad_piece');
      expect((await t.error('select public.register_export(null)'))?.hint).toBe('bad_piece');
    });
  });

  it('a user only sees their own exports', async () => {
    await tx(async (t) => {
      const a = await t.createUser(), b = await t.createUser();
      await t.as(a);
      await exp(t);
      await t.as(b);
      expect((await t.query('select * from public.exports')).rows).toEqual([]);
    });
  });
});

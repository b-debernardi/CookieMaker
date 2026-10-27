// Which plan a user is on, from gifts and subscriptions.

import { describe, expect, it } from 'vitest';
import { tx, type Tx } from './db';

const planOf = async (t: Tx, uid: string) =>
  (await t.query<{ p: string }>('select private.entitlement_of($1) as p', [uid])).rows[0].p;

const subscribe = (t: Tx, uid: string, status: string, periodEnd: string | null, endedAt: string | null = null) =>
  t.query(
    `insert into public.subscriptions (user_id, provider_id, status, current_period_end, ended_at)
     values ($1, gen_random_uuid()::text, $2, ${periodEnd ?? 'null'}, ${endedAt ?? 'null'})`,
    [uid, status],
  );

describe('entitlement_of', () => {
  it('a new user is free', async () => {
    await tx(async (t) => {
      expect(await planOf(t, await t.createUser())).toBe('free');
    });
  });

  it('a running gift gives Pro, an expired one leaves read-only for 6 months', async () => {
    await tx(async (t) => {
      const a = await t.createUser(), b = await t.createUser(), c = await t.createUser();
      await t.grantPro(a);
      await t.grantPro(b, "now() - interval '1 month'");
      await t.grantPro(c, "now() - interval '7 months'");
      expect(await planOf(t, a)).toBe('pro');
      expect(await planOf(t, b)).toBe('pro_readonly');
      expect(await planOf(t, c)).toBe('free');
    });
  });

  it('an authorized subscription is Pro while paid, plus 3 days of grace', async () => {
    await tx(async (t) => {
      const paid = await t.createUser(), grace = await t.createUser(), late = await t.createUser();
      await subscribe(t, paid, 'authorized', "now() + interval '20 days'");
      await subscribe(t, grace, 'authorized', "now() - interval '2 days'");
      await subscribe(t, late, 'authorized', "now() - interval '5 days'");
      expect(await planOf(t, paid)).toBe('pro');
      expect(await planOf(t, grace)).toBe('pro');
      expect(await planOf(t, late)).toBe('pro_readonly');
    });
  });

  it('a pending subscription (never paid) gives nothing', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await subscribe(t, u, 'pending', null);
      expect(await planOf(t, u)).toBe('free');
    });
  });

  it('a cancelled subscription is read-only for 6 months after it ended', async () => {
    await tx(async (t) => {
      const recent = await t.createUser(), old = await t.createUser();
      await subscribe(t, recent, 'cancelled', "now() - interval '1 month'", "now() - interval '1 month'");
      await subscribe(t, old, 'cancelled', "now() - interval '8 months'", "now() - interval '7 months'");
      expect(await planOf(t, recent)).toBe('pro_readonly');
      expect(await planOf(t, old)).toBe('free');
    });
  });

  it('a cancelled subscription keeps Pro until the end of what was paid', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await subscribe(t, u, 'cancelled', "now() + interval '10 days'", "now() + interval '10 days'");
      expect(await planOf(t, u)).toBe('pro');
    });
  });

  it('a paused subscription lasts its paid period, without grace', async () => {
    await tx(async (t) => {
      const on = await t.createUser(), off = await t.createUser();
      await subscribe(t, on, 'paused', "now() + interval '1 day'");
      await subscribe(t, off, 'paused', "now() - interval '1 day'");
      expect(await planOf(t, on)).toBe('pro');
      expect(await planOf(t, off)).toBe('pro_readonly');
    });
  });

  it('an authorized subscription with a past end date is not Pro', async () => {
    await tx(async (t) => {
      const u = await t.createUser();
      await subscribe(t, u, 'authorized', "now() + interval '10 days'", "now() - interval '1 day'");
      expect(await planOf(t, u)).toBe('pro_readonly');
    });
  });
});

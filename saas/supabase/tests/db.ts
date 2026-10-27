// Helpers for the database tests. Each test runs in one transaction that is
// always rolled back, switching between the database owner (to set things up)
// and a signed-in user, the way PostgREST does it: SET ROLE plus the JWT claims.

import pg from 'pg';
import { afterAll } from 'vitest';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Falta DATABASE_URL (ver supabase/tests/README.md). Las pruebas de la base no se saltean.');
}

const pool = new pg.Pool({ connectionString: url, max: 4 });
afterAll(() => pool.end());

export class Tx {
  constructor(readonly c: pg.PoolClient) {}

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.c.query<T>(sql, params);
  }

  /** Back to the database owner, outside RLS. */
  async asOwner() {
    await this.c.query('reset role');
    await this.c.query("select set_config('request.jwt.claims', '', true)");
  }

  /** A signed-in user, as the API would run their requests. */
  async as(uid: string) {
    await this.asOwner();
    await this.c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await this.c.query('set local role authenticated');
  }

  /** A visitor without an account. */
  async asAnon() {
    await this.asOwner();
    await this.c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    await this.c.query('set local role anon');
  }

  /** Creates a user (and, through the trigger, its profile). Run as owner. */
  async createUser(name = 'Prueba'): Promise<string> {
    const r = await this.query<{ id: string }>(
      'insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), $1, $2) returning id',
      [`${crypto.randomUUID()}@example.com`, { full_name: name }],
    );
    return r.rows[0].id;
  }

  /** Gives Pro by hand until `until` (default: in 30 days). Run as owner. */
  async grantPro(uid: string, until = "now() + interval '30 days'") {
    await this.query(`insert into public.grants (user_id, until, reason) values ($1, ${until}, 'prueba')`, [uid]);
  }

  /** Runs `sql` and returns the error it raises, or null. Uses a savepoint so the test can go on. */
  async error(sql: string, params: unknown[] = []): Promise<(Error & { code?: string; hint?: string }) | null> {
    await this.c.query('savepoint t');
    try {
      await this.c.query(sql, params);
      await this.c.query('release savepoint t');
      return null;
    } catch (e) {
      await this.c.query('rollback to savepoint t');
      return e as Error & { code?: string; hint?: string };
    }
  }
}

export async function tx(fn: (t: Tx) => Promise<void>) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await fn(new Tx(c));
  } finally {
    await c.query('rollback');
    c.release();
  }
}

/** A tiny valid PNG (1x1). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n<path d="M0 0L10 0L10 10Z" fill="#000000" fill-rule="nonzero"/>\n</svg>\n';

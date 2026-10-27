# Pruebas de la base

Prueban permisos (RLS y grants), el plan de cada usuario, el contador de exportaciones, la biblioteca y la cuenta.
Cada prueba corre en una transacción que siempre se deshace, así que no dejan nada en la base.

Necesitan `DATABASE_URL` apuntando a una base con las migraciones aplicadas. Sin eso fallan; no se saltean.

**Con Docker y la CLI de Supabase** (lo que corre en CI):

```bash
cd saas
supabase db start && supabase migration up --local
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

**Con un Postgres común, sin Docker:** `shim.sql` imita lo mínimo de Supabase (roles, `auth.users`, `auth.uid()`).

```bash
export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/cookiemaker_test
npm run db:local   # borra y rearma esa base
npm run test:db
```

**Nunca** apuntes `DATABASE_URL` a un proyecto de Supabase en la nube: `db:local` borra la base.

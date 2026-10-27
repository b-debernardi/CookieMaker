# Configurar Supabase

Hay dos proyectos: **pruebas** (staging, `rairjpvvxosafxcezcao`) y **producción** (`hzeoardsvyxgsnmzthdu`). Los dos se configuran igual; lo que cambia son las URLs.
El esquema de la base no se toca a mano: lo aplican las migraciones de `supabase/migrations` (ver "Publicar
migraciones" abajo).

Nunca pongas en el repo, en un chat ni en un mail la contraseña de la base ni la clave `service_role` / `secret`.
El Project URL, el Project ID y la clave `anon` / `publishable` son públicas: van en la página.

## 1. Al crear cada proyecto

- Región: **South America (São Paulo)**, `sa-east-1`.
- Contraseña de la base: larga, generada, guardada en un gestor de contraseñas.
- Security: **Enable Data API** activado, **Automatically expose new tables** desactivado,
  **Enable automatic RLS** activado.

## 2. Authentication

**Sign In / Providers**

- Email: activado. **Confirm email** activado. Contraseñas: mínimo 12 caracteres, con mayúsculas, minúsculas y
  números (la app no las ofrece, pero así queda cerrado). Email OTP expiration: 900 segundos.
- Google: activado, con el Client ID y el Client Secret del paso 3.
- Todo lo demás (teléfono, anónimos, otros proveedores): desactivado.

**URL Configuration**

- Site URL: la dirección de la app (en pruebas, la de Cloudflare Pages de staging; en producción, el dominio).
- Redirect URLs: la misma dirección con `/**` al final. En pruebas, también `http://localhost:5173/**`.

**Attack Protection**

- Captcha: activado, proveedor **Cloudflare Turnstile**, con la Secret Key de Turnstile (paso 4).

**Emails > Templates**

Copiá asunto y contenido de los archivos de `supabase/templates/`:

| Plantilla | Asunto | Archivo |
| --- | --- | --- |
| Magic Link | Tu link para entrar | `magic_link.html` |
| Confirm signup | Confirmá tu mail | `confirmation.html` |
| Change Email Address | Confirmá tu mail nuevo | `email_change.html` |

**Emails > SMTP Settings** (antes de la beta)

El mail que trae Supabase manda muy pocos por hora. Antes de invitar gente hay que poner un SMTP propio
(Resend u otro), con un remitente del dominio.

## 3. Login con Google (Google Cloud Console)

1. Entrá a <https://console.cloud.google.com/> y creá un proyecto (por ejemplo, "Cortantes").
2. **APIs y servicios > Pantalla de consentimiento de OAuth**: tipo **Externo**. Nombre de la app, mail de soporte
   y mail del desarrollador. Permisos: solo `email`, `profile` y `openid`.
3. **APIs y servicios > Credenciales > Crear credenciales > ID de cliente de OAuth**, tipo **Aplicación web**.
   - Orígenes autorizados de JavaScript: la dirección de la app.
   - URIs de redireccionamiento autorizados: `https://<Project ID>.supabase.co/auth/v1/callback`
     (está en Supabase, en Authentication > Providers > Google, como "Callback URL").
4. Copiá el Client ID y el Client Secret en Supabase (Authentication > Providers > Google).
5. Un cliente por proyecto de Supabase (pruebas y producción), o uno con las dos URIs de redirección.

Mientras la pantalla de consentimiento esté "en prueba", solo entran los mails que agregues como usuarios de prueba.
Para la beta hay que publicarla.

## 4. Turnstile (Cloudflare)

En el panel de Cloudflare, **Turnstile > Agregar sitio**, con el dominio de la app (y `localhost` para pruebas).
La **Site Key** va en la página; la **Secret Key** va en Supabase (Attack Protection).

## 5. Publicar migraciones

Las migraciones se aplican desde GitHub Actions (`.github/workflows/saas-db.yml`):

- **Pruebas:** cada merge a `main` que cambie `saas/supabase/migrations` las aplica solo.
- **Producción:** a mano, desde la pestaña Actions ("saas-db", "Run workflow", entorno `production`), y GitHub
  pide aprobarlo.

Para que funcione, en GitHub (Settings > Secrets and variables > Actions):

| Tipo | Nombre | Qué es |
| --- | --- | --- |
| Variable | `SUPABASE_STAGING_REF` | `rairjpvvxosafxcezcao` |
| Variable | `SUPABASE_PRODUCTION_REF` | `hzeoardsvyxgsnmzthdu` |
| Secreto | `SUPABASE_ACCESS_TOKEN` | Un token personal de Supabase (Account > Access Tokens) |
| Secreto | `SUPABASE_STAGING_DB_PASSWORD` | Contraseña de la base de pruebas |
| Secreto | `SUPABASE_PRODUCTION_DB_PASSWORD` | Contraseña de la base de producción |

Y en Settings > Environments, creá `staging` y `production`; en `production` activá "Required reviewers" con tu
usuario. Hasta que las variables estén cargadas, el workflow no hace nada.

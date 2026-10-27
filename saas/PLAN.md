# Plan: CookieMaker SaaS

Versión web y paga de CookieMaker, publicada en internet. Este plan sale de la entrevista del 27/10/2026
y es la referencia para todo el código que se escriba en `saas/`. Si una decisión cambia, se cambia acá primero.

El nombre "CookieMaker" es provisorio: va a cambiar y todavía no hay dominio. Todo lo que muestre el nombre
(textos, mails, metadatos, logo) sale de un solo archivo de configuración para poder cambiarlo sin tocar código.

---

## 1. Resumen

- **Para quién:** makers con impresora 3D que hacen cortantes y se los venden a pastelerías.
- **Qué hace:** lo mismo que la app local (SVG, imagen o texto a cortador, imprint, sello o set, en STL o 3MF),
  con cuentas, biblioteca en la nube para los que pagan y cobro mensual.
- **Modelo:** freemium. Gratis para probar, Pro a USD 7.99 por mes cobrado en pesos con Mercado Pago.
- **Mercado:** Argentina y Latam primero, preparado para sumar pagos en dólares más adelante.
- **Orden de trabajo:** backend primero, con la interfaz actual adaptada para probar con gente real.
  El rediseño completo en React viene después, cuando esté pensado.
- **La app local** (`CookieMaker.html` y `../src`) queda como está, aparte, para uso de Bruno. No se toca.

## 2. Planes

| | Sin cuenta | Gratis (con cuenta) | Pro |
| --- | --- | --- | --- |
| Diseñar y ver en 3D | Sí | Sí | Sí |
| Exportar | No (pide registrarse) | 3 por mes, solo imprint cutter | Sin límite, todas las piezas |
| Cortador, sello, cortador + sello, sets | Ver nada más | Ver nada más | Sí |
| Zonas modificadoras | Ver nada más | Ver nada más | Sí |
| Biblioteca | No | No | Sí, en la nube |
| Precio | | | USD 7.99/mes en pesos |

Reglas:

- El mes de las 3 exportaciones es el mes calendario en hora de Argentina; el contador vuelve a 0 el día 1.
- Cada archivo exportado cuenta una vez (STL o 3MF).
- Sin cuenta y en Gratis se pueden elegir todas las piezas y ver el resultado en 3D, con un candado en el botón
  de exportar que lleva a Pro, así se ve lo que se gana pagando.
- **Si un Pro cancela:** la biblioteca queda guardada 6 meses en solo lectura. Puede bajarla entera en un zip.
  Si vuelve a pagar en ese tiempo la recupera tal cual. Pasados los 6 meses se borra, con aviso por mail
  30 días antes y 7 días antes.
- El precio en pesos lo cambia Bruno a mano desde el panel. Cuando cambia, se avisa por mail a los suscriptos
  antes de que se cobre el precio nuevo.
- Bruno puede regalar Pro (beta, amigos, compensaciones) desde el panel, con fecha de vencimiento.

## 3. Qué se guarda de cada cortante (Pro)

- **Cortante:** nombre, categoría, origen (svg, imagen o texto), el diseño como SVG, y para texto el texto,
  la fuente y el espaciado. Miniatura en PNG chico (hasta 64 KB), guardado en la misma tabla: sin bucket de
  archivos, sin links firmados y sin archivos huérfanos al borrar una cuenta.
- **Versión:** pieza, parámetros, tamaño y medidas. **El STL no se guarda:** se regenera en el navegador al
  bajarlo, a partir del SVG y los parámetros. Ocupa mucho menos y se puede ofrecer más espacio barato.
- **De las imágenes se guarda solo el SVG trazado**, no la imagen original. Para retocar la imagen hay que
  volver a cargarla.
- El SVG que se guarda no es el archivo que subió el usuario: es el que arma la app a partir de los contornos
  (`designToSvg`), que solo tiene `<path>` con números y colores. Así un SVG con scripts o enlaces nunca llega
  a la base (ver Seguridad).
- Límites por cuenta para que el costo esté acotado: 500 cortantes, 20 versiones por cortante, 1 MB por SVG.
  *Números iniciales, se ajustan con datos.*

## 4. Arquitectura

```
Navegador                                    Supabase (staging y producción)
┌──────────────────────────────┐             ┌──────────────────────────────────┐
│ Interfaz (actual adaptada,   │  HTTPS      │ Auth: Google + link por mail     │
│ después React)               │────────────▶│ Postgres con RLS                 │
│ Motor de geometría en Worker │             │   perfiles, cortantes, versiones,│
│ (Manifold, Potrace, three.js)│             │   exportaciones, suscripciones   │
│ Exporta STL / 3MF localmente │             │ Storage privado: miniaturas PNG  │
└──────────────────────────────┘             │ Edge Functions:                  │
         │                                   │   webhook de Mercado Pago        │
         │ estático                          │   crear / cancelar suscripción   │
┌──────────────────────────────┐             │   tareas diarias (vencimientos)  │
│ Cloudflare Pages             │             └──────────────────────────────────┘
│ landing, app, legales        │                       │            │
└──────────────────────────────┘               Mercado Pago     Mails (Resend u otro SMTP)
```

Decisiones:

- **La geometría sigue en el navegador.** El servidor no genera piezas, así que alcanza con un plan barato.
  El límite de exportaciones se cuenta en el servidor pero el archivo se arma en el cliente, así que alguien
  técnico lo puede saltear. Se acepta: el público no es técnico y el costo de evitarlo es alto.
  Si aparece abuso, el paso siguiente es generar el archivo final en una Edge Function.
- **Supabase** resuelve login, base de datos, archivos y permisos. Menos código de seguridad propio.
- **Cloudflare Pages** para la parte estática (gratis), con los headers de seguridad configurados ahí.
- **Mercado Pago, suscripciones** (preapproval) en pesos. El estado del plan solo lo escribe el webhook.
- **Mails** solo transaccionales: entrar, pago aprobado, pago rechazado, cambio de precio, aviso de borrado.
  Supabase necesita un SMTP propio en producción (el que trae tiene un límite muy bajo por hora).
- **Métricas** sin cookies (Plausible o Umami), así no hace falta cartel de cookies.
- **Errores** con Sentry (plan gratis), con aviso por mail.

### Cómo se organiza el código del backend

Con Supabase no hay un servidor clásico con controladores y vistas, así que MVC no aplica. El backend tiene dos partes:

- **La base (SQL):** tablas, RLS y funciones como `entitlement()` y `register_export()`. Las reglas de permisos
  viven acá porque es el único lugar que no se puede saltear.
- **Las Edge Functions (TypeScript):** pagos, mails y tareas diarias. Se organizan en **hexagonal liviano**:
  - `domain/`: reglas puras sin red ni base (estados de la suscripción, qué pasa al cancelar, vencimientos).
    Se prueban con pruebas unitarias simples.
  - `ports/`: interfaces de lo que el dominio necesita (`PaymentProvider`, `Mailer`, `Repo`).
  - `adapters/`: Mercado Pago, Supabase, el proveedor de mails. Sumar Stripe después es escribir otro adaptador.
  - `handlers/`: la entrada HTTP de cada función. Valida, llama al dominio y responde; no tiene reglas.

  Sin más capas que esas: alcanza para probar sin red y cambiar de proveedor, sin la ceremonia de un hexagonal completo.

### Modelo de datos (borrador)

| Tabla | Qué tiene | Quién escribe |
| --- | --- | --- |
| `profiles` | id (= usuario), nombre, rol (`user` / `admin`), alta | el usuario (solo nombre); rol solo por servidor |
| `items` | cortante: nombre, categoría, origen, svg, texto, fuente, miniatura, fechas | el dueño, solo si es Pro activo |
| `versions` | pieza, params (jsonb validado), tamaño, medidas | el dueño, solo si es Pro activo |
| `exports` | usuario, pieza, fecha | solo la función `register_export()` |
| `subscriptions` | id de Mercado Pago, estado, precio, próximo cobro, fin | solo Edge Functions |
| `grants` | Pro regalado: usuario, hasta cuándo, quién lo dio, motivo | solo admin |
| `settings` | precio en pesos, exportaciones gratis por mes | solo admin |
| `audit_log` | qué hizo un admin, sobre quién, cuándo | solo servidor, nunca se edita |

- Una función `entitlement(user)` en Postgres devuelve `free`, `pro` o `pro_readonly` según la suscripción,
  los regalos y la fecha. Todas las reglas de RLS y las funciones usan esa, para que el plan se decida en un
  solo lugar.
- `register_export(piece)` revisa el plan y el contador del mes dentro de una transacción y devuelve si se
  puede exportar. La interfaz solo arma el archivo si dice que sí.
- El esquema vive en el repo como migraciones (`supabase/migrations`), nunca se cambia a mano en producción.

## 5. Seguridad

Lo mínimo para salir a internet. Cada punto tiene una prueba automática o una revisión en la lista de lanzamiento.

**Datos y permisos**
- RLS activado en todas las tablas, sin excepción, con pruebas automáticas que intentan leer y escribir datos
  de otro usuario y de un usuario Gratis contra la biblioteca.
- La clave pública (anon) es la única que llega al navegador. La clave de servicio vive solo en las Edge Functions.
- Los secretos (Mercado Pago, SMTP, Sentry) van en variables de entorno de Supabase y Cloudflare, nunca en el
  repo. `.env` en `.gitignore` y escaneo de secretos activado en GitHub.
- Todo lo que entra a la base se valida en la base misma, porque la app escribe directo por la API: largo de
  textos, SVG limpio, PNG chico, parámetros como objeto JSON de hasta 16 KB. Lo que no cumple se rechaza.
  Los parámetros se vuelven a validar al leerlos (`sanitizeParams`: claves conocidas, números dentro de los
  límites de cada campo, listas cortas), así un valor raro guardado nunca llega al motor.

**Archivos del usuario**
- Al servidor solo llega el SVG regenerado por la app. Igual se vuelve a validar en el servidor: solo
  `<svg>` y `<path>` con atributos `d`, `fill`, `stroke`, `stroke-width` y similares; cualquier otra cosa se rechaza.
- Los SVG nunca se muestran insertados en la página: se dibujan en canvas o como `<img>` desde un blob.
- Miniaturas: PNG de hasta 64 KB guardados en la tabla, con la firma de PNG verificada por la base.
- Límites de tamaño al cargar en el navegador (archivo y resolución de imagen) para que la pestaña no se cuelgue.

**Login y abuso**
- Sin contraseñas: Google o link por mail. Captcha (Cloudflare Turnstile) antes de mandar el link, para que no
  usen el formulario para llenar de mails a alguien.
- Límite de pedidos por usuario e IP en las funciones propias.

**Pagos**
- El webhook de Mercado Pago verifica la firma (`x-signature`) y después consulta el pago a la API de Mercado
  Pago antes de cambiar nada. Nunca se confía en la redirección del navegador.
- Cada notificación se procesa una sola vez (se guarda su id), aunque llegue repetida o desordenada.
- Ningún dato de tarjeta pasa por nuestro servidor: el pago se hace en Mercado Pago.

**Página**
- Headers: Content-Security-Policy estricta (sin scripts en línea; `wasm-unsafe-eval` para el motor),
  HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- La app SaaS se compila en archivos normales, no en un solo HTML como la local, para poder usar esa política.

**Código y dependencias**
- TypeScript estricto, lint, y pruebas en cada cambio.
- Versiones fijas con `package-lock.json`, Dependabot y `npm audit` en CI. Sumar dependencias solo si hace falta.
- Ningún cambio llega a producción sin pasar por staging.

**Datos personales y consumidor (Argentina)**
- Política de privacidad y Términos y Condiciones publicados antes de la beta.
- El usuario puede bajar sus datos y borrar su cuenta desde la app (borra todo en cascada).
- Botón de arrepentimiento y baja de la suscripción en dos clics, como pide Defensa del Consumidor para
  ventas online. *Confirmar requisitos exactos con un contador o abogado antes de cobrar.*
- Mail de contacto para denuncias por marcas o derechos de autor, con un procedimiento simple: se da de baja
  el contenido denunciado y se avisa al usuario.

## 6. Calidad y operación

- **Dos entornos:** staging y producción, cada uno con su proyecto de Supabase y su sitio en Cloudflare.
- **CI en GitHub Actions** (solo cuando cambia `saas/`): tipos, lint, pruebas unitarias, pruebas de geometría,
  pruebas de RLS contra una base local, build y `npm audit`. Si algo falla, no se publica.
- **Publicación:** merge a `main` publica en staging; producción se publica a mano desde un tag, después de
  mirar staging.
- **Pruebas de punta a punta** con Playwright: entrar, diseñar, exportar con el límite, pagar en el sandbox
  de Mercado Pago, cancelar.
- **Backups:** el plan gratis de Supabase no tiene backups diarios y se pausa sin uso. Antes de cobrar se pasa
  producción al plan pago (backups diarios).
- **Panel de administración** chico, solo para el rol `admin`: buscar usuarios, ver pagos y exportaciones,
  regalar Pro, dar de baja una cuenta, cambiar el precio en pesos. Cada acción queda en `audit_log`.

### Costos estimados al principio

| Servicio | Costo |
| --- | --- |
| Cloudflare Pages | Gratis |
| Supabase | Gratis en staging; plan Pro (unos USD 25/mes) en producción antes de cobrar |
| Mails | Gratis hasta unos miles por mes |
| Sentry, Plausible/Umami | Gratis o pocos dólares |
| Dominio | Lo que cueste el nombre elegido |
| Mercado Pago | Comisión por cobro (revisar la vigente) |

Con 4 o 5 suscriptos Pro se cubre el costo fijo.

## 7. Estructura de la carpeta

```
saas/
  PLAN.md
  README.md
  packages/core/      motor copiado de ../src: geometry, input, export, model (sin DOM donde se pueda)
  apps/web/           interfaz: primero la actual adaptada, después la nueva en React
  supabase/
    migrations/       esquema, RLS y funciones de Postgres
    functions/        webhook y suscripción de Mercado Pago, tareas diarias
    tests/            pruebas de permisos
  .env.example        nombres de las variables, sin valores
```

El motor se **copia** a `packages/core` y desde ahí evoluciona aparte, con más pruebas. La app local no se toca.
Las pruebas de CI van en `.github/workflows/` en la raíz del repo, filtradas para que corran solo con cambios en `saas/`.

## 8. Fases

**Fase 0: base.** *(Lista el 27/10/2026, salvo los proyectos de Supabase, que crea Bruno.)* Copiar el motor a `packages/core` y separar lo que depende del DOM. TypeScript estricto,
lint, pruebas (pasar `test/geo.test.ts` a Vitest y sumar casos). CI. Proyectos de Supabase de staging y producción.

**Fase 1: backend.** *(Base de datos, permisos, plan, límites, cuenta y configuración de login listos el 27/10/2026; la configuración del panel de Supabase y Google la hace Bruno, ver `docs/SUPABASE.md`.)* Login con Google y link por mail (con captcha). Esquema, RLS y sus pruebas.
`entitlement()` y `register_export()`. Biblioteca en la nube (crear, listar, editar, borrar, zip).
Borrar cuenta y bajar datos. Mails transaccionales.

**Fase 2: pagos.** Suscripción con Mercado Pago en pesos (sandbox primero). Webhook con firma e idempotencia.
Cancelación, solo lectura por 6 meses y borrado con avisos. Cambio de precio con aviso. Regalos de Pro.

**Fase 3: interfaz actual adaptada.** Usar la app de hoy contra el backend: entrar y salir, candados de Gratis
(solo imprint, 3 por mes, sin biblioteca), biblioteca en la nube para Pro en lugar de IndexedDB, página de
cuenta y de pasar a Pro. Que funcione bien en el celular. Headers de seguridad, Sentry y métricas.

**Fase 4: landing y legales.** Página de inicio con ejemplos, precios y botón para probar. Términos y
Condiciones, privacidad, botón de arrepentimiento, contacto para denuncias.

**Fase 5: panel de administración.**

**Fase 6: beta cerrada.** Algunos makers conocidos con Pro regalado a cambio de opiniones. Ajustar límites,
textos y errores con lo que digan.

**Fase 7: lanzamiento.** Pasar la lista de abajo.

**Fase 8: rediseño completo en React**, cuando Bruno tenga el diseño pensado. Usa `packages/core` y el
backend tal cual; solo cambia `apps/web`.

## 9. Antes de lanzar (lista)

- [ ] Nombre definitivo y dominio.
- [ ] Monotributo (o sociedad) dado de alta: hace falta para cobrar con Mercado Pago y facturar.
- [ ] Revisar con contador o abogado: facturación, Defensa del Consumidor y datos personales.
- [ ] **Ficha para el pastelero**: una ficha que el maker le manda a su cliente con la imagen del cortante,
      las medidas y el precio que pone el maker. Bruno la quiere antes del lanzamiento. **Recordárselo.**
- [ ] Supabase de producción en plan pago con backups.
- [ ] SMTP propio configurado y mails probados.
- [ ] Pruebas de RLS y de punta a punta en verde contra staging.
- [ ] Términos, privacidad y botón de arrepentimiento publicados.
- [ ] Revisión de seguridad completa del código de `saas/`.

## 10. Pendientes y para más adelante

- Nombre y marca (con eso entra el rediseño).
- Ficha para el pastelero (antes de lanzar) y, más adelante, un catálogo público del maker para compartir.
- Pagos en dólares con Stripe para fuera de Argentina.
- Generar el archivo final en el servidor si aparece abuso del límite gratis.

## Decisiones de la entrevista

| # | Tema | Decisión |
| --- | --- | --- |
| 1 | Cliente | Makers con impresora 3D que le venden a pastelerías |
| 2 | Modelo | Freemium |
| 3 | Mercado | Argentina y Latam primero, en pesos con Mercado Pago |
| 4 | App local | Queda aparte, para uso de Bruno |
| 5 | Gratis | 3 exportaciones, solo imprint cutter |
| 6 | Límite | Contado en el servidor, la pieza se genera en el navegador |
| 7 | Precio | USD 7.99/mes, en pesos en Mercado Pago |
| 8 | Ficha para el pastelero | No en la primera versión; sí antes de lanzar |
| 9 | Período | 3 por mes |
| 10 | Login | Google o link por mail, sin contraseña |
| 11 | Marcas ajenas | Usuario responsable por Términos y Condiciones, más mail de denuncias |
| 12 | Facturación | Todavía no hay (requisito antes de cobrar) |
| 13 | Nombre | Va a cambiar; sin dominio todavía |
| 14 | Pantallas | Computadora primero, funcional en celular |
| 15 | Estilo | Rediseño completo, después del backend |
| 16 | Primera visita | Página de inicio con ejemplos y precios |
| 17 | Sin cuenta | Diseña y ve en 3D; registrarse para exportar |
| 18 | Biblioteca Gratis | No tiene biblioteca |
| 19 | Backend | Supabase más funciones para pagos |
| 20 | Interfaz nueva | React |
| 21 | Motor | Copiado a `saas/`, evoluciona aparte |
| 22 | Qué se guarda | Diseño y parámetros; el STL se regenera |
| 23 | Escala | Bruno solo, 100 a 1000 usuarios el primer año |
| 24 | Cancelación | 6 meses en solo lectura, zip, se recupera si vuelve |
| 25 | Métricas | Sin cookies (Plausible o Umami) |
| 26 | Publicación | Staging y producción, solo con pruebas en verde, Sentry |
| 27 | Mails | Solo transaccionales |
| 28 | Admin | Panel chico |
| 29 | Primer hito | Backend más la interfaz actual adaptada |
| 30 | Lanzamiento | Beta cerrada con Pro regalado |
| 31 | Imágenes | Solo se guarda el SVG |
| 32 | Precio en pesos | A mano desde el panel, con aviso por mail |
| 33 | Qué cuenta como exportación | Cada STL o 3MF exportado |
| 34 | Piezas Pro en Gratis | Se ven en 3D, con candado al exportar |

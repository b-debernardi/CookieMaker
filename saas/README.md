# CookieMaker SaaS

Versión web de CookieMaker, para publicar en internet con cuentas de usuario y plan Pro.
El plan completo, con todas las decisiones, está en [`PLAN.md`](PLAN.md).
La app local (`../src`, `CookieMaker.html`) es independiente y no se toca desde acá.

## Estado

- **Fase 0 (base):** lista. El motor está copiado en `packages/core`, con TypeScript estricto, lint, pruebas y CI.
- **Fase 1 (backend):** base de datos, permisos, plan, límite de exportaciones y cuenta. Falta configurar el
  panel de Supabase y el login con Google: [`docs/SUPABASE.md`](docs/SUPABASE.md).
- **Fase 2 (pagos):** sigue.

## Desarrollo

Necesita Node 22.12 o más nuevo.

```bash
cd saas
npm install
npm run check      # tipos, lint y pruebas del motor
npm test           # solo pruebas del motor
npm run test:db    # pruebas de la base (necesita DATABASE_URL, ver supabase/tests/README.md)
```

## Estructura

| Carpeta | Qué hay |
| --- | --- |
| `packages/core/src/model` | Parámetros, valores por defecto, límites de cada campo y cambio de tamaño |
| `packages/core/src/input` | SVG, texto e imagen (umbral) a contornos, y contornos a SVG limpio |
| `packages/core/src/geometry` | Pipeline con Manifold; `runBuild` arma y acomoda las piezas |
| `packages/core/src/export` | STL binario y 3MF |
| `packages/core/src/browser` | Solo navegador: worker, carga del WASM, fuentes, trazado con Potrace |
| `packages/core/test` | Pruebas con Vitest (geometría, exportación, SVG, parámetros, entrada) |
| `supabase/migrations` | Esquema, permisos (RLS), plan de cada usuario y funciones que llama la app |
| `supabase/tests` | Pruebas de la base: permisos, plan, exportaciones, biblioteca y cuenta |
| `supabase/templates` | Mails de login en español |
| `docs/SUPABASE.md` | Cómo configurar los proyectos de Supabase, Google y Turnstile |

## La base en dos líneas

La app habla directo con Supabase; todo lo que puede hacer cada usuario lo decide la base. Las funciones que
llama la app son `my_plan()`, `register_export(pieza)`, `export_my_data()` y `delete_my_account()`.

`@app/core` se importa sin nada del navegador salvo `DOMParser` (lo usa el lector de SVG), así que las
pruebas corren en Node. Lo que necesita Vite o canvas está en `@app/core/browser`, y el worker se importa
con `@app/core/browser/worker?worker`.

## Diferencias con el motor de la app local

- `runBuild(wasm, pedido)` es el antiguo worker sin el `onmessage`, para poder probarlo en Node.
- `loadManifold` recibe cómo conseguir el `.wasm` en lugar de importarlo con Vite, y si la carga falla se
  puede reintentar.
- `textToDesign(fuente, opciones)` recibe la fuente ya cargada. El texto se corta a 200 caracteres.
- Imágenes de hasta 15 MB y 8000 px por lado, y fuentes de hasta 5 MB.
- Los nombres de las piezas se escapan en el 3MF.
- Un diseño vacío, o con contornos de menos de 3 puntos, da el aviso "El diseño está vacío." en vez de un
  error interno de Manifold. *El mismo error está en la app local.*

# CookieMaker

Generador local de cortadores de galletas, imprint cutters y sellos con mango cónico, para imprimir en FDM.
Convierte un SVG, una imagen o un texto en STL o 3MF.

## Usarlo

Abrí `CookieMaker.html` con doble clic. Es un solo archivo, sin servidor ni conexión a internet.

1. Elegí la entrada: SVG, imagen o texto (o arrastrá un archivo a la página). Al cargar una imagen se abre
   un editor para recortarla, pintar con distintos grosores y borrar con la goma antes de trazarla.
2. Elegí la pieza arriba: Cortador, Imprint, Sello o Cortador + sello.
3. Ajustá los parámetros a la derecha. En "Simple" están el tamaño y los pocos ajustes que más se usan para
   esa pieza; "Avanzado" muestra todo (base, filo, puentes, zonas, perfil de impresora, unidades).
   El umbral y el invertir de una imagen están a la izquierda, junto a la imagen.
4. Para ajustar solo una parte del relieve, agregá una zona en "Modificadores" (Avanzado) y arrastrala en la
   vista 3D: adentro de la zona vale su propio grosor mínimo y afuera el ajuste general.
5. Revisá los avisos en la barra de abajo y exportá a 3MF o STL.

### Biblioteca

- Cada cortante que exportás (o guardás con "Guardar en biblioteca") queda en la pestaña **Biblioteca** con el
  diseño en SVG, la imagen de la que salió (si era una imagen), los parámetros y el STL.
- Se guarda en el navegador (IndexedDB), en esta computadora y este navegador. "Todo (.zip)" descarga una copia.
- Buscador por nombre o categoría y filtros por categoría y por pieza.
- Al tocar un cortante se abren sus versiones (una por tamaño y pieza: 4 cm, 8 cm, 15 cm…). Desde ahí se bajan
  el STL y los parámetros, se abre una versión en Diseñar, o se genera un tamaño nuevo a partir del SVG guardado
  con los parámetros de otra versión. El tamaño es el lado más largo del diseño.
- Guardar otra vez el mismo tamaño y pieza reemplaza esa versión en vez de duplicarla.

Los cortadores se muestran espejados a propósito: se imprimen con la base sobre la cama y, al darlos vuelta
para cortar, el diseño queda al derecho. El sello se imprime con la cara sobre la cama.
En "Cortador + sello" el sello es una placa plana que se imprime adentro del cortador, con el relieve hacia arriba
y una holgura configurable con la pared (0.9 mm por defecto). La holgura agranda el cortador; el sello no se recorta.
Si el diseño tiene formas separadas (por ejemplo laureles o estrellas alrededor de un escudo), el panel de entrada
deja elegir: usar solo la más grande, un contorno alrededor de todo o un set con un cortador y su sello por forma.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # genera dist/index.html (un solo archivo con todo adentro)
npx tsx test/geo.test.ts   # prueba de geometría en Node
node test/e2e-library.mjs  # guarda, genera una versión nueva y la abre (después de build)
```

## Estructura

| Carpeta | Qué hace |
| --- | --- |
| `src/input/` | SVG (SVGLoader), imagen (umbral + Potrace) y texto (opentype.js) a contornos |
| `src/geometry/` | Pipeline geométrico en un Web Worker con Manifold (Clipper2 adentro) |
| `src/model/` | Parámetros, valores por defecto, ajustes principales por pieza y perfiles |
| `src/library/` | Biblioteca: base de datos en el navegador, vista, versiones y generación en segundo plano |
| `src/viewer/` | Escena 3D con three.js |
| `src/export/` | STL binario y 3MF con varias piezas |
| `src/ui/` | Controles y estilos |

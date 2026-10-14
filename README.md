# CookieMaker

Generador local de cortadores de galletas, imprint cutters y sellos con mango cónico, para imprimir en FDM.
Convierte un SVG, una imagen o un texto en STL o 3MF.

## Usarlo

Abrí `CookieMaker.html` con doble clic. Es un solo archivo, sin servidor ni conexión a internet.

1. Elegí la entrada: SVG, imagen o texto (o arrastrá un archivo a la página). Al cargar una imagen se abre
   un editor para recortarla, pintar con distintos grosores y borrar con la goma antes de trazarla.
2. Elegí la pieza arriba: Cortador, Imprint, Sello o Cortador + sello.
3. Ajustá los parámetros a la derecha. Lo menos usado está en "Más opciones".
4. Revisá los avisos en la barra de abajo y exportá a 3MF o STL.

Los cortadores se muestran espejados a propósito: se imprimen con la base sobre la cama y, al darlos vuelta
para cortar, el diseño queda al derecho. El sello se imprime con la cara sobre la cama.
En "Cortador + sello" el sello es una placa plana que se imprime adentro del cortador, con el relieve hacia arriba
y una holgura configurable con la pared (0.5 mm por defecto).

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # genera dist/index.html (un solo archivo con todo adentro)
npx tsx test/geo.test.ts   # prueba de geometría en Node
```

## Estructura

| Carpeta | Qué hace |
| --- | --- |
| `src/input/` | SVG (SVGLoader), imagen (umbral + Potrace) y texto (opentype.js) a contornos |
| `src/geometry/` | Pipeline geométrico en un Web Worker con Manifold (Clipper2 adentro) |
| `src/model/` | Parámetros, valores por defecto y perfiles |
| `src/viewer/` | Escena 3D con three.js |
| `src/export/` | STL binario y 3MF con varias piezas |
| `src/ui/` | Controles y estilos |

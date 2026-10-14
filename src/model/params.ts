// Parameter types, defaults and the metadata the panel is built from.
// Defaults follow the plan ("Parámetros configurables"): CookieCAD values where
// published, our own where marked "propio".

export type Piece = 'cutter' | 'imprint' | 'stamp' | 'set';
export type Units = 'mm' | 'in';
/** What the cutter + stamp set does with separate shapes in the design. */
export type PartsMode = 'largest' | 'outline' | 'set';

export interface ManualBridge {
  angle: number; // 0..179 degrees
  pos: number; // 0..100 % across the design, perpendicular to the bar
  width: number; // mm
}

export interface Params {
  // Size and input
  sizeW: number;
  sizeH: number;
  lockAspect: boolean;
  resolution: number;
  threshold: number;
  invertImage: boolean;
  cutMode: 'outline' | 'holes';
  reliefMode: 'fill' | 'edges';
  lineWidth: number;
  envelope: 'none' | 'rect' | 'circle' | 'hull';
  envelopePad: number;
  mirror: boolean;
  // Cutting blade
  bladeDepth: number;
  bladeThickness: number;
  extraDepth: number;
  extraThickness: number;
  tipWidth: number;
  chamferHeight: number;
  bladeInside: boolean;
  // Grip base
  baseHeight: number;
  baseWidth: number;
  baseShape: 'rect' | 'round' | 'chamfer';
  baseSymmetric: boolean;
  // Imprint
  imprintDepth: number;
  floorWidth: number;
  removeFloor: boolean;
  edgesOnly: boolean;
  invertRelief: boolean;
  eraseBorder: boolean;
  imprintThickness: number;
  // Stamp
  backing: number;
  clearance: number;
  setClearance: number;
  mergeParts: boolean;
  partsMode: PartsMode;
  reliefDepth: number;
  efComp: boolean;
  efAmount: number;
  // Tapered handle
  towerHeight: number;
  capDiameter: number;
  taperAngle: number;
  towerAuto: boolean;
  towerX: number;
  towerY: number;
  filletRadius: number;
  // Bridges
  autoBridges: boolean;
  bridgeWidth: number;
  manualBridges: ManualBridge[];
  solidBridges: boolean;
  // Advanced
  forceMinThickness: boolean;
  minThickness: number;
  simplifyTol: number;
  bedSize: number;
  showEdges: boolean;
}

export const DEFAULTS: Params = {
  sizeW: 70,
  sizeH: 70,
  lockAspect: true,
  resolution: 100,
  threshold: 50,
  invertImage: false,
  cutMode: 'outline',
  reliefMode: 'edges',
  lineWidth: 1.0,
  envelope: 'none',
  envelopePad: 3,
  mirror: false,

  bladeDepth: 12.5,
  bladeThickness: 0.8,
  extraDepth: 10,
  extraThickness: 0,
  tipWidth: 0.4,
  chamferHeight: 2,
  bladeInside: false,

  baseHeight: 3.5,
  baseWidth: 4,
  baseShape: 'rect',
  baseSymmetric: false,

  imprintDepth: 4.5,
  floorWidth: 1.5,
  removeFloor: false,
  edgesOnly: false,
  invertRelief: false,
  eraseBorder: false,
  imprintThickness: 0,

  backing: 5.5,
  clearance: 0.9,
  setClearance: 0.5,
  mergeParts: true,
  partsMode: 'largest',
  reliefDepth: 3,
  efComp: true,
  efAmount: 0.2,

  towerHeight: 25,
  capDiameter: 15,
  taperAngle: 10,
  towerAuto: true,
  towerX: 50,
  towerY: 50,
  filletRadius: 2,

  autoBridges: true,
  bridgeWidth: 1.2,
  manualBridges: [],
  solidBridges: false,

  forceMinThickness: true,
  minThickness: 0.8,
  simplifyTol: 0.05,
  bedSize: 256,
  showEdges: true,
};

/** Keys that describe the design rather than how it is manufactured. */
export const DESIGN_KEYS: (keyof Params)[] = [
  'sizeW', 'sizeH', 'lockAspect', 'threshold', 'invertImage', 'cutMode', 'reliefMode',
  'envelope', 'envelopePad', 'mirror', 'manualBridges', 'towerAuto', 'towerX', 'towerY', 'partsMode',
];

export type Kind = 'len' | 'deg' | 'pct' | 'num' | 'bool' | 'choice';

export interface FieldMeta {
  key: keyof Params;
  label: string;
  kind: Kind;
  min?: number;
  max?: number;
  step?: number;
  choices?: { value: string; label: string }[];
  /** Hidden behind "Más opciones" in its section. */
  adv?: boolean;
  hint?: string;
  /** Only shown when this returns true. */
  when?: (p: Params, ctx: FieldContext) => boolean;
}

export interface FieldContext {
  piece: Piece;
  source: 'svg' | 'image' | 'text';
}

export interface SectionMeta {
  id: string;
  title: string;
  pieces: Piece[];
  fields: FieldMeta[];
}

const ALL: Piece[] = ['cutter', 'imprint', 'stamp', 'set'];
const CUTTERS: Piece[] = ['cutter', 'imprint', 'set'];
const STAMPS: Piece[] = ['stamp', 'set'];

export const SECTIONS: SectionMeta[] = [
  {
    id: 'design',
    title: 'Diseño',
    pieces: ALL,
    fields: [
      { key: 'threshold', label: 'Umbral', kind: 'pct', min: 1, max: 99, step: 1,
        when: (_p, c) => c.source === 'image', hint: 'Qué tan oscuro tiene que ser un píxel para contar como dibujo.' },
      { key: 'invertImage', label: 'Invertir imagen', kind: 'bool', when: (_p, c) => c.source === 'image' },
      { key: 'cutMode', label: 'Qué corta', kind: 'choice',
        choices: [{ value: 'outline', label: 'Contorno' }, { value: 'holes', label: 'Contorno y huecos' }],
        when: (_p, c) => c.piece !== 'stamp' },
      { key: 'reliefMode', label: 'Relieve', kind: 'choice',
        choices: [{ value: 'edges', label: 'Líneas' }, { value: 'fill', label: 'Relleno' }],
        when: (_p, c) => c.piece !== 'cutter', hint: 'Líneas: los bordes internos del dibujo. Relleno: las zonas oscuras.' },
      { key: 'lineWidth', label: 'Ancho de línea', kind: 'len', min: 0.4, max: 5, step: 0.1,
        when: (p, c) => p.reliefMode === 'edges' && c.piece !== 'cutter' },
      { key: 'resolution', label: 'Resolución', kind: 'num', min: 1, max: 200, step: 1, adv: true,
        hint: 'Densidad de muestreo de las curvas.' },
      { key: 'envelope', label: 'Contorno envolvente', kind: 'choice', adv: true,
        choices: [
          { value: 'none', label: 'No' }, { value: 'rect', label: 'Rectángulo' },
          { value: 'circle', label: 'Círculo' }, { value: 'hull', label: 'Casco' },
        ] },
      { key: 'envelopePad', label: 'Margen del envolvente', kind: 'len', min: 0, max: 20, step: 0.5, adv: true,
        when: (p) => p.envelope !== 'none' },
      { key: 'mirror', label: 'Espejar diseño', kind: 'bool', adv: true },
    ],
  },
  {
    id: 'blade',
    title: 'Hoja de corte',
    pieces: CUTTERS,
    fields: [
      { key: 'bladeDepth', label: 'Profundidad', kind: 'len', min: 3, max: 40, step: 0.5 },
      { key: 'bladeThickness', label: 'Grosor', kind: 'len', min: 0.4, max: 4, step: 0.05 },
      { key: 'tipWidth', label: 'Ancho de punta', kind: 'len', min: 0.2, max: 2, step: 0.05 },
      { key: 'chamferHeight', label: 'Altura del filo', kind: 'len', min: 0, max: 10, step: 0.1 },
      { key: 'extraThickness', label: 'Hoja extra · grosor', kind: 'len', min: 0, max: 4, step: 0.1, adv: true,
        hint: '0 = apagada.' },
      { key: 'extraDepth', label: 'Hoja extra · profundidad', kind: 'len', min: 1, max: 40, step: 0.5, adv: true,
        when: (p) => p.extraThickness > 0 },
      { key: 'bladeInside', label: 'Hoja hacia adentro', kind: 'bool', adv: true },
    ],
  },
  {
    id: 'base',
    title: 'Base de agarre',
    pieces: CUTTERS,
    fields: [
      { key: 'baseHeight', label: 'Altura', kind: 'len', min: 1, max: 10, step: 0.1 },
      { key: 'baseWidth', label: 'Ancho', kind: 'len', min: 0, max: 15, step: 0.5 },
      { key: 'baseShape', label: 'Forma', kind: 'choice',
        choices: [{ value: 'rect', label: 'Recta' }, { value: 'round', label: 'Redonda' }, { value: 'chamfer', label: 'Chaflán' }] },
      { key: 'baseSymmetric', label: 'Base simétrica', kind: 'bool', adv: true },
    ],
  },
  {
    id: 'imprint',
    title: 'Imprint',
    pieces: ['imprint'],
    fields: [
      { key: 'imprintDepth', label: 'Distancia al filo', kind: 'len', min: 0, max: 20, step: 0.1,
        hint: '0 = al ras del filo.' },
      { key: 'floorWidth', label: 'Ancho de piso', kind: 'len', min: 0.5, max: 6, step: 0.1 },
      { key: 'removeFloor', label: 'Quitar piso', kind: 'bool', adv: true },
      { key: 'edgesOnly', label: 'Solo bordes', kind: 'bool', adv: true, hint: 'Corta todos los bordes, sin relieve.' },
      { key: 'invertRelief', label: 'Invertir relieve', kind: 'bool', adv: true },
      { key: 'eraseBorder', label: 'Borrar borde exterior', kind: 'bool', adv: true },
      { key: 'imprintThickness', label: 'Grosor de imprint', kind: 'len', min: -1, max: 2, step: 0.05, adv: true },
    ],
  },
  {
    id: 'stamp',
    title: 'Sello',
    pieces: STAMPS,
    fields: [
      { key: 'reliefDepth', label: 'Profundidad de relieve', kind: 'len', min: -5, max: 8, step: 0.1,
        hint: 'Negativa = hundido.' },
      { key: 'backing', label: 'Respaldo', kind: 'len', min: 1, max: 15, step: 0.1, when: (_p, c) => c.piece === 'stamp' },
      { key: 'backing', label: 'Grosor de la placa', kind: 'len', min: 1, max: 15, step: 0.1, when: (_p, c) => c.piece === 'set' },
      { key: 'clearance', label: 'Holgura con el cortador', kind: 'len', min: 0, max: 3, step: 0.05,
        when: (_p, c) => c.piece === 'stamp' },
      { key: 'setClearance', label: 'Holgura con el cortador', kind: 'len', min: 0.2, max: 3, step: 0.05,
        when: (_p, c) => c.piece === 'set', hint: 'Espacio entre el sello y la pared del cortador. Con menos de 0.4 mm pueden pegarse al imprimir.' },
      { key: 'mergeParts', label: 'Placa completa', kind: 'bool', when: (_p, c) => c.piece === 'stamp',
        hint: 'Una sola placa que rodea todo el dibujo; las partes sueltas quedan en relieve sobre ella.' },
      { key: 'invertRelief', label: 'Invertir relieve', kind: 'bool', adv: true },
      { key: 'eraseBorder', label: 'Borrar borde exterior', kind: 'bool', adv: true },
      { key: 'imprintThickness', label: 'Engrosar líneas', kind: 'len', min: -1, max: 2, step: 0.05, adv: true },
      { key: 'efComp', label: 'Compensar pata de elefante', kind: 'bool', adv: true },
      { key: 'efAmount', label: 'Compensación', kind: 'len', min: 0, max: 0.6, step: 0.05, adv: true,
        when: (p) => p.efComp },
    ],
  },
  {
    id: 'handle',
    title: 'Mango cónico',
    pieces: ['stamp'],
    fields: [
      { key: 'towerHeight', label: 'Altura', kind: 'len', min: 5, max: 60, step: 0.5 },
      { key: 'capDiameter', label: 'Diámetro de tapa', kind: 'len', min: 5, max: 40, step: 0.5 },
      { key: 'taperAngle', label: 'Conicidad', kind: 'deg', min: 0, max: 30, step: 0.5 },
      { key: 'filletRadius', label: 'Radio de unión', kind: 'len', min: 0, max: 6, step: 0.1, adv: true },
      { key: 'towerAuto', label: 'Posición automática', kind: 'bool', adv: true },
      { key: 'towerX', label: 'Posición X', kind: 'pct', min: 0, max: 100, step: 1, adv: true, when: (p) => !p.towerAuto },
      { key: 'towerY', label: 'Posición Y', kind: 'pct', min: 0, max: 100, step: 1, adv: true, when: (p) => !p.towerAuto },
    ],
  },
  {
    id: 'bridges',
    title: 'Puentes',
    pieces: CUTTERS,
    fields: [
      { key: 'autoBridges', label: 'Puentes automáticos', kind: 'bool' },
      { key: 'bridgeWidth', label: 'Ancho', kind: 'len', min: 0.6, max: 5, step: 0.1 },
      { key: 'solidBridges', label: 'Puentes sólidos', kind: 'bool', adv: true,
        hint: 'Quita el relieve que cae sobre una barra manual.' },
    ],
  },
  {
    id: 'advanced',
    title: 'Avanzado',
    pieces: ALL,
    fields: [
      { key: 'forceMinThickness', label: 'Forzar grosor mínimo', kind: 'bool' },
      { key: 'minThickness', label: 'Grosor mínimo', kind: 'len', min: 0.4, max: 2, step: 0.05 },
      { key: 'simplifyTol', label: 'Simplificación', kind: 'len', min: 0, max: 0.5, step: 0.01, adv: true },
      { key: 'bedSize', label: 'Cama de la impresora', kind: 'len', min: 100, max: 500, step: 1, adv: true },
      { key: 'showEdges', label: 'Mostrar aristas', kind: 'bool', adv: true },
    ],
  },
];

export const PARTS_MODES: { value: PartsMode; label: string; hint: string }[] = [
  { value: 'largest', label: 'Más grande', hint: 'Usa la forma más grande e ignora el resto.' },
  { value: 'outline', label: 'Contorno', hint: 'Un solo contorno alrededor de todas las formas; el resto queda en relieve.' },
  { value: 'set', label: 'Set', hint: 'Un set: un cortador con su sello para cada forma.' },
];

export const PIECES: { value: Piece; label: string }[] = [
  { value: 'cutter', label: 'Cortador' },
  { value: 'imprint', label: 'Imprint' },
  { value: 'stamp', label: 'Sello' },
  { value: 'set', label: 'Cortador + sello' },
];

export function cloneParams(p: Params): Params {
  return { ...p, manualBridges: p.manualBridges.map((b) => ({ ...b })) };
}

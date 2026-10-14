// Messages between the page and the geometry worker.

import type { Design } from '../input/types';
import type { Params, Piece } from '../model/params';

export interface BuildRequest {
  id: number;
  design: Design;
  params: Params;
  piece: Piece;
}

export interface MeshOut {
  name: string;
  role: 'part' | 'issue';
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Issue {
  level: 'error' | 'warn' | 'info';
  text: string;
}

export interface BuildResult {
  id: number;
  ok: boolean;
  error?: string;
  meshes: MeshOut[];
  issues: Issue[];
  /** Separate shapes found in the design. */
  shapes: number;
  /** Height / width of the design as built. */
  aspect: number;
  /** Bounding box of all parts, in mm. */
  size: [number, number, number];
  ms: number;
}

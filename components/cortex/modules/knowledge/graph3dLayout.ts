// REAL APP: the server may supply layout coordinates for large graphs.

import type { GraphEdge, GraphNode } from '@/lib/types';
import { hashNodeLabel } from './graphLayout';

const BASE_CENTER_X = 380;
const BASE_CENTER_Y = 225;
const X_SCALE = 38;
const Y_SCALE = 25;
const Z_HALF_RANGE = 4;

/**
 * Deterministically maps 2D graph nodes into 3D space (~[-10, 10] on X/Y, ~[-4, 4] on Z).
 */
export function computePositions3D(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, [number, number, number]> {
  void edges;
  const positions = new Map<string, [number, number, number]>();

  for (const node of nodes) {
    const x = Math.round(((node.x - BASE_CENTER_X) / X_SCALE) * 1000) / 1000;
    const y = Math.round(-((node.y - BASE_CENTER_Y) / Y_SCALE) * 1000) / 1000;
    const hash = hashNodeLabel(node.label);
    const zNormalized = (hash % 10001) / 10000;
    const z = Math.round((zNormalized * Z_HALF_RANGE * 2 - Z_HALF_RANGE) * 1000) / 1000;
    positions.set(node.id, [x, y, z]);
  }

  return positions;
}

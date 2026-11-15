export interface NodePosition {
  x: number;
  y: number;
}

export interface SourceNodePlacement extends NodePosition {
  baseAngle: number;
}

/**
 * Deterministic FNV-1a 32-bit hash for a node label.
 */
export function hashNodeLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Computes a deterministic orbit position around the graph center for an ingested document node.
 */
export function computeSourceNodePlacement(label: string): SourceNodePlacement {
  const hash = hashNodeLabel(label);
  const baseAngle = ((hash % 3600) / 3600) * Math.PI * 2;
  const x = Math.round((380 + Math.cos(baseAngle) * 110) * 100) / 100;
  const y = Math.round((210 + Math.sin(baseAngle) * 95) * 100) / 100;
  return { x, y, baseAngle };
}

/**
 * Computes a deterministic satellite position around a source node based on the entity label hash.
 */
export function computeEntityNodePosition(
  sourcePlacement: SourceNodePlacement,
  entityLabel: string,
  index: number
): NodePosition {
  const entHash = hashNodeLabel(entityLabel);
  const angleOffset = ((entHash % 360) / 360) * 0.45;
  const angle = sourcePlacement.baseAngle + (index + 1) * 1.1 + angleOffset;
  const x = Math.max(80, Math.min(680, Math.round((sourcePlacement.x + Math.cos(angle) * 135) * 100) / 100));
  const y = Math.max(60, Math.min(390, Math.round((sourcePlacement.y + Math.sin(angle) * 105) * 100) / 100));
  return { x, y };
}

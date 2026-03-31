/**
 * DAG layout computation for screen state graphs
 */

import type { ScreenState, GraphTransition } from "./types";

export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Compute DAG layout positions for screen states
 */
export function computeDAGLayout(
  stateSubset: ScreenState[],
  transitionSubset: GraphTransition[]
): Map<string, NodePosition> {
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const stateIdSet = new Set(stateSubset.map(s => s.id));

  // Initialize
  for (const state of stateSubset) {
    outEdges.set(state.id, []);
    inDegree.set(state.id, 0);
  }

  // Build edge graph
  for (const t of transitionSubset) {
    if (stateIdSet.has(t.from) && stateIdSet.has(t.to) && t.from !== t.to) {
      outEdges.get(t.from)!.push(t.to);
      inDegree.set(t.to, (inDegree.get(t.to) || 0) + 1);
    }
  }

  // Compute layers via BFS
  const layer = new Map<string, number>();
  const roots = stateSubset.filter(s => (inDegree.get(s.id) || 0) === 0).map(s => s.id);

  // Ensure st_external is first if present
  const externalState = stateSubset.find(s => s.id === 'st_external');
  if (externalState && !roots.includes(externalState.id)) {
    roots.unshift(externalState.id);
  }
  if (roots.length === 0 && stateSubset.length > 0) {
    roots.push(stateSubset[0].id);
  }

  const queue: string[] = [];
  for (const root of roots) {
    layer.set(root, 0);
    queue.push(root);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const depth = layer.get(id) || 0;
    for (const next of (outEdges.get(id) || [])) {
      if (!layer.has(next)) {
        layer.set(next, depth + 1);
        queue.push(next);
      }
    }
  }

  // Assign orphans to layer 0
  for (const state of stateSubset) {
    if (!layer.has(state.id)) {
      layer.set(state.id, 0);
    }
  }

  // Group by layer
  const layerGroups = new Map<number, string[]>();
  for (const state of stateSubset) {
    const l = layer.get(state.id) || 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(state.id);
  }

  // Position nodes
  const nodePositions = new Map<string, NodePosition>();
  const layerSpacing = 320;
  const nodeSpacing = 560;

  for (const [l, nodes] of layerGroups) {
    const x = 80 + l * layerSpacing;
    const mainNodes = nodes.filter(id => !isTransientState(id));
    const transientNodes = nodes.filter(id => isTransientState(id));

    // Position main nodes (top row)
    mainNodes.forEach((nodeId, idx) => {
      nodePositions.set(nodeId, { x, y: 80 + idx * nodeSpacing });
    });

    // Position transient nodes (bottom row)
    const row2Y = 80 + nodeSpacing;
    transientNodes.forEach((nodeId, idx) => {
      nodePositions.set(nodeId, { x, y: row2Y + idx * nodeSpacing });
    });
  }

  return nodePositions;
}

/**
 * Check if a state is a transient state (editing, focused, etc.)
 */
export function isTransientState(id: string): boolean {
  return id.includes('_focused') ||
         id.includes('_editing') ||
         id.includes('_invalid') ||
         id.includes('_updated') ||
         id.includes('_typing');
}

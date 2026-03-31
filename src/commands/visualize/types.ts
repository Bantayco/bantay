/**
 * Type definitions for the visualizer
 */

export interface DesignToken {
  id: string;
  value: string;
}

export interface TokenVar {
  name: string;
  value: string;
}

export interface WireframeMap {
  [compId: string]: string;
}

export interface VisualizeOptions {
  aide?: string;
  output?: string;
}

export interface VisualizeResult {
  outputPath: string;
  bytesWritten: number;
}

export interface AideEntity {
  display?: string;
  parent?: string;
  props?: Record<string, unknown>;
}

export interface AideRelationship {
  from: string;
  to: string;
  type: string;
  cardinality: string;
}

export interface AideTree {
  entities: Record<string, AideEntity>;
  relationships: AideRelationship[];
}

export interface CUJ {
  id: string;
  name: string;
  feature: string;
  area: string;
  scenarios: Scenario[];
}

export interface Scenario {
  id: string;
  name: string;
  given: string;
  when: string;
  then: string;
  screen?: string;
  path?: string;
  invariants: string[];
  componentStates: Record<string, string>;
}

export interface ScreenState {
  id: string;
  screen: string;
  componentStates: Record<string, string>;
}

export interface GraphTransition {
  id: string;
  from: string;
  to: string;
  action: string;
  trigger?: string;
}

export interface Component {
  id: string;
  name: string;
  type?: string;
  variant?: string;
  description?: string;
  wireframeHtml?: string;
}

export interface Screen {
  id: string;
  name: string;
  description?: string;
  inferred: boolean;
  components?: Component[];
  nav?: string;
}

export interface CujGraphData {
  cujId: string;
  stateIds: Set<string>;
  transitionIds: Set<string>;
}

export interface VisualizerData {
  cujs: CUJ[];
  screens: Screen[];
  transitions: GraphTransition[];
  relationships: AideRelationship[];
  screenStates: ScreenState[];
}

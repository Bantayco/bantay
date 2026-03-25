# Tasks

## Invariant Changes

### inv_wireframe_variant_fallback

- [ ] write checker

## Relationship Changes

### sc_visualize_wireframe_variants:inv_wireframe_variant_fallback

- [ ] verify connection

## Phase 3

### cuj_visualize_generate: Developer runs bantay visualize to generate an HTML screen map from any aide

- [ ] Implement Developer runs bantay visualize to generate an HTML screen map from any aide

**Acceptance Criteria:**

- [ ] sc_visualize_wireframe_variants: Visualizer renders component wireframe variants based on scenario state
  - Given: A scenario has component state props (e.g. comp_timer: idle)
  - When: bantay visualize renders the walkthrough step for that scenario
  - Then: Engine looks up wireframes/comp_timer--idle.html. If found, renders it. If not, falls back to wireframes/comp_timer.html

## Phase 4

### cuj_visualize_map: Developer views the full screen map with draggable screens, transition arrows, and zoom/pan controls

- [ ] Implement Developer views the full screen map with draggable screens, transition arrows, and zoom/pan controls

**Acceptance Criteria:**

- [ ] sc_visualize_map_default_variants: Map view uses default wireframe variants
  - Given: Map view renders all screens
  - When: No scenario context is available
  - Then: Map view uses the default wireframe (no variant suffix) for all components

### cuj_visualize_walkthrough: Developer steps through a CUJ scenario by scenario with screen preview and given/when/then details

- [ ] Implement Developer steps through a CUJ scenario by scenario with screen preview and given/when/then details

**Acceptance Criteria:**

- [ ] sc_walk_scenario_list: Walkthrough shows all CUJs and scenarios as navigable list
  - Given: Developer opens walkthrough mode
  - When: Walkthrough renders
  - Then: Left sidebar shows all CUJs grouped by area with scenarios listed under each. Current scenario highlighted. Clicking any scenario jumps to that step.
- [ ] sc_walk_direct_jump: Click any scenario to jump directly to it
  - Given: Developer viewing the scenario list
  - When: Developer clicks a scenario in the sidebar
  - Then: Walkthrough jumps to that CUJ and scenario step, screen preview updates

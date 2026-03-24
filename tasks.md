# Tasks

## Relationship Changes

### cuj_export_css:cuj_aide

- [ ] verify connection

### sc_visualize_injects_tokens:cuj_export_css

- [ ] verify connection

## Phase 2

### cuj_export_css: Bantay exports CSS variables from structured design token entities in the aide

- [ ] Implement Bantay exports CSS variables from structured design token entities in the aide

**Acceptance Criteria:**

- [ ] sc_export_css_from_tokens: Generate CSS variables from design token entities
  - Given: Aide has entities under design_system with typed token props (colors, spacing, typography)
  - When: Developer runs bantay export css
  - Then: CSS file generated with :root variables matching token names and values
- [ ] sc_export_css_idempotent: CSS export is idempotent
  - Given: CSS file already exists
  - When: Developer runs bantay export css again
  - Then: Output is byte-identical if tokens haven't changed

### cuj_visualize_generate: Developer runs bantay visualize to generate an HTML screen map from any aide

- [ ] Implement Developer runs bantay visualize to generate an HTML screen map from any aide

**Acceptance Criteria:**

- [ ] sc_visualize_injects_tokens: Visualizer injects CSS variables into generated HTML
  - Given: Aide has design token entities
  - When: bantay visualize generates the HTML
  - Then: CSS variables from tokens are embedded in a style block so wireframes can reference them
- [ ] sc_visualize_renders_wireframes: Visualizer renders wireframe HTML files inside component boxes
  - Given: wireframes/<comp_id>.html exists for a component
  - When: bantay visualize renders a screen containing that component
  - Then: Wireframe HTML injected into the component box instead of description text
- [ ] sc_visualize_fallback: Visualizer falls back to description when no wireframe file exists
  - Given: No wireframes/<comp_id>.html exists for a component
  - When: bantay visualize renders a screen containing that component
  - Then: Component box shows comp name and description text (current behavior)

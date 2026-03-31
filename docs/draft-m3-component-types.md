# Draft: M3 Component Type Invariant

## Overview

Aide visual components (`comp_*`) should use Material Design 3 component types as their vocabulary. This ensures:
- Consistent terminology across aide files
- Visualizer knows how to render each type
- Portable specs that other tools can interpret

## M3 Component Taxonomy

Source: https://m3.material.io/components

### Actions
| M3 Name | Aide Type | Description |
|---------|-----------|-------------|
| FAB | `fab` | Floating action button |
| Extended FAB | `fab-extended` | FAB with label |
| Icon button | `icon-button` | Clickable icon |
| Common buttons | `button` | Filled, outlined, text, elevated, tonal |
| Segmented button | `segmented-button` | Toggle between options |

### Communication
| M3 Name | Aide Type | Description |
|---------|-----------|-------------|
| Badge | `badge` | Notification indicator |
| Progress indicator | `progress` | Linear or circular |
| Snackbar | `snackbar` | Brief message |
| Tooltips | `tooltip` | Contextual info |

### Containment
| M3 Name | Aide Type | Description |
|---------|-----------|-------------|
| Bottom sheet | `bottom-sheet` | Modal/standard sheet |
| Card | `card` | Content container |
| Carousel | `carousel` | Scrollable content |
| Dialog | `dialog` | Modal dialog |
| Divider | `divider` | Visual separator |
| Lists | `list` | Vertical list container |
| List item | `list-item` | Row in a list |
| Side sheet | `side-sheet` | Side panel |

### Navigation
| M3 Name | Aide Type | Description |
|---------|-----------|-------------|
| Bottom app bar | `bottom-app-bar` | Bottom toolbar |
| Navigation bar | `navigation-bar` | Bottom nav (3-5 destinations) |
| Navigation drawer | `navigation-drawer` | Side navigation |
| Navigation rail | `navigation-rail` | Vertical nav for tablets |
| Search | `search` | Search bar |
| Tabs | `tabs` | Tab bar |
| Top app bar | `top-app-bar` | Top toolbar |

### Selection
| M3 Name | Aide Type | Description |
|---------|-----------|-------------|
| Checkbox | `checkbox` | Multi-select |
| Chips | `chip` | Compact element |
| Date pickers | `date-picker` | Date selection |
| Time pickers | `time-picker` | Time selection |
| Menus | `menu` | Dropdown menu |
| Radio button | `radio` | Single select |
| Slider | `slider` | Range input |
| Switch | `switch` | Toggle |

### Text Inputs
| M3 Name | Aide Type | Description |
|---------|-----------|-------------|
| Text fields | `text-field` | Text input |

### Custom (non-M3)
| Aide Type | Description |
|-----------|-------------|
| `custom` | Escape hatch for app-specific components |

---

## Invariant Definition

```yaml
# In bantay.aide or project's .aide file
inv_m3_component_types:
  parent: invariants
  props:
    text: Visual components must use M3 component type vocabulary
    category: visualize
    rationale: >
      M3 provides a standardized component taxonomy that ensures consistent
      terminology across aide files. The visualizer uses these types to apply
      appropriate rendering and layout behavior (e.g., FABs float, navigation-bar
      renders at bottom).
    checker: built-in/m3-component-types
```

## Checker Implementation

```typescript
// src/checkers/m3-component-types.ts

export const M3_COMPONENT_TYPES = new Set([
  // Actions
  'fab', 'fab-extended', 'icon-button', 'button', 'segmented-button',
  // Communication
  'badge', 'progress', 'snackbar', 'tooltip',
  // Containment
  'bottom-sheet', 'card', 'carousel', 'dialog', 'divider',
  'list', 'list-item', 'side-sheet',
  // Navigation
  'bottom-app-bar', 'navigation-bar', 'navigation-drawer',
  'navigation-rail', 'search', 'tabs', 'top-app-bar',
  // Selection
  'checkbox', 'chip', 'date-picker', 'time-picker',
  'menu', 'radio', 'slider', 'switch',
  // Text inputs
  'text-field',
  // Escape hatch
  'custom',
]);

export const name = 'm3-component-types';
export const description = 'Validates component types against M3 vocabulary';

export interface CheckerConfig {
  aide: {
    entities: Record<string, { props?: Record<string, unknown> }>;
  };
}

export interface Violation {
  file: string;
  line: number;
  message: string;
}

export interface CheckResult {
  pass: boolean;
  violations: Violation[];
}

export function check(config: CheckerConfig): CheckResult {
  const violations: Violation[] = [];
  const entities = config.aide.entities || {};

  for (const [id, entity] of Object.entries(entities)) {
    if (!id.startsWith('comp_')) continue;

    const componentType = entity.props?.type as string | undefined;

    if (!componentType) {
      violations.push({
        file: 'aide',
        line: 0,
        message: `${id} is missing props.type. Add type: <m3-type> (e.g., type: fab, type: text-field)`,
      });
      continue;
    }

    if (!M3_COMPONENT_TYPES.has(componentType)) {
      violations.push({
        file: 'aide',
        line: 0,
        message: `${id} has unknown type "${componentType}". Allowed: ${[...M3_COMPONENT_TYPES].join(', ')}`,
      });
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
```

## Visualizer Integration

The visualizer would use `props.type` to apply layout behavior:

```typescript
// src/commands/visualize/render.ts

const FLOATING_TYPES = new Set(['fab', 'fab-extended']);
const NAV_TYPES = new Set(['navigation-bar', 'bottom-app-bar']);

function renderComponent(comp: Component, state?: Record<string, string>) {
  const type = comp.type || 'custom';

  if (FLOATING_TYPES.has(type)) {
    // Render with absolute positioning
    return renderFloatingComponent(comp);
  }

  if (NAV_TYPES.has(type)) {
    // Render at bottom of screen card
    return renderNavComponent(comp);
  }

  // Default inline rendering
  return renderInlineComponent(comp);
}
```

## Migration for spout.aide

```yaml
# Before
comp_fab:
  props:
    name: New artifact button

# After
comp_fab:
  props:
    name: New artifact button
    type: fab  # <-- M3 type

comp_timer:
  props:
    name: Session timer
    type: custom  # <-- app-specific, use escape hatch

comp_search:
  props:
    name: Search artifacts
    type: search  # <-- M3 type

comp_artifact_row:
  props:
    name: Artifact list item
    type: list-item  # <-- M3 type
```

## Decisions

1. **Strict fail.** Unknown types fail `bantay check`, not just warn.
2. **Handle variants.** Use `type: button` + `variant: outlined`. Variants are type-specific.
3. **Custom requires docs.** If `type: custom`, must have `description` prop.

---

## Variant Definitions

### Button Variants
```yaml
comp_save:
  props:
    type: button
    variant: filled  # filled | outlined | text | elevated | tonal
```

### FAB Variants
```yaml
comp_add:
  props:
    type: fab
    variant: standard  # standard | small | large
```

### Progress Variants
```yaml
comp_loading:
  props:
    type: progress
    variant: circular  # circular | linear
```

### Text Field Variants
```yaml
comp_email:
  props:
    type: text-field
    variant: outlined  # filled | outlined
```

---

## Updated Checker

```typescript
// Variants per type
const TYPE_VARIANTS: Record<string, Set<string>> = {
  'button': new Set(['filled', 'outlined', 'text', 'elevated', 'tonal']),
  'fab': new Set(['standard', 'small', 'large']),
  'fab-extended': new Set(['standard', 'small', 'large']),
  'progress': new Set(['circular', 'linear']),
  'text-field': new Set(['filled', 'outlined']),
  'chip': new Set(['assist', 'filter', 'input', 'suggestion']),
  'card': new Set(['elevated', 'filled', 'outlined']),
  'top-app-bar': new Set(['center-aligned', 'small', 'medium', 'large']),
};

export function check(config: CheckerConfig): CheckResult {
  const violations: Violation[] = [];
  const entities = config.aide.entities || {};

  for (const [id, entity] of Object.entries(entities)) {
    if (!id.startsWith('comp_')) continue;

    const props = entity.props || {};
    const componentType = props.type as string | undefined;
    const variant = props.variant as string | undefined;
    const description = props.description as string | undefined;

    // Must have type
    if (!componentType) {
      violations.push({
        file: 'aide',
        line: 0,
        message: `${id} is missing props.type`,
      });
      continue;
    }

    // Type must be known
    if (!M3_COMPONENT_TYPES.has(componentType)) {
      violations.push({
        file: 'aide',
        line: 0,
        message: `${id} has unknown type "${componentType}"`,
      });
      continue;
    }

    // Custom requires description
    if (componentType === 'custom' && !description) {
      violations.push({
        file: 'aide',
        line: 0,
        message: `${id} has type "custom" but missing props.description`,
      });
    }

    // Validate variant if provided
    if (variant && TYPE_VARIANTS[componentType]) {
      if (!TYPE_VARIANTS[componentType].has(variant)) {
        const allowed = [...TYPE_VARIANTS[componentType]].join(', ');
        violations.push({
          file: 'aide',
          line: 0,
          message: `${id} has invalid variant "${variant}" for type "${componentType}". Allowed: ${allowed}`,
        });
      }
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
```

---

## Example Violations

```
$ bantay check

Checking invariants...

✗ inv_m3_component_types: 3 violations

  comp_timer is missing props.type
  comp_widget has unknown type "widget"
  comp_custom_thing has type "custom" but missing props.description

1 invariant failed
```

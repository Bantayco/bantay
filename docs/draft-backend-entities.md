# Backend Entity Schema Extensions

## Overview

Extend the aide to model full-stack applications, enabling:
- Complete app generation from aide
- Backend validation in autoresearch loop
- API contract enforcement via invariants

---

## New Entity Types

### `model_*` — Data Models

```yaml
model_user:
  parent: models
  props:
    table: users
  fields:
    id: { type: uuid, primary: true }
    email: { type: string, unique: true }
    name: { type: string }
    created_at: { type: timestamp, default: now }

model_aide:
  parent: models
  props:
    table: aides
  fields:
    id: { type: uuid, primary: true }
    title: { type: string }
    content: { type: json }
    published: { type: boolean, default: false }
    slug: { type: string, unique: true, nullable: true }
    owner_id: { type: uuid, references: model_user.id }
```

### `endpoint_*` — API Routes

```yaml
endpoint_get_aide:
  parent: endpoints
  props:
    method: GET
    path: /api/aides/:id
    auth: rule_authenticated
    returns: model_aide
    errors:
      404: Aide not found
      403: Not authorized

endpoint_create_aide:
  parent: endpoints
  props:
    method: POST
    path: /api/aides
    auth: rule_authenticated
    accepts: { title: string, content?: json }
    returns: model_aide
    action: action_create_aide

endpoint_publish_aide:
  parent: endpoints
  props:
    method: POST
    path: /api/aides/:id/publish
    auth: rule_owner_only
    action: action_publish_aide
```

### `action_*` — Mutations / Business Logic

```yaml
action_create_aide:
  parent: actions
  props:
    input: { title: string, content?: json }
    output: model_aide
    steps:
      - Generate unique ID
      - Set owner to current user
      - Save to database
      - Return created aide

action_publish_aide:
  parent: actions
  props:
    input: { aide_id: uuid }
    preconditions:
      - Aide exists
      - User is owner
      - Aide has content
    steps:
      - Generate slug from title
      - Set published = true
      - Return updated aide
    emits: event_aide_published
```

### `rule_*` — Auth / Access Rules

```yaml
rule_authenticated:
  parent: rules
  props:
    type: auth
    check: User has valid session

rule_owner_only:
  parent: rules
  props:
    type: authz
    check: Current user is resource owner
    applies_to: [model_aide]

rule_public_or_owner:
  parent: rules
  props:
    type: authz
    check: Resource is published OR current user is owner
```

### `event_*` — Async Events

```yaml
event_aide_published:
  parent: events
  props:
    payload: { aide_id: uuid, slug: string }
    triggers:
      - job_generate_og_image
      - job_notify_followers

event_user_signed_up:
  parent: events
  props:
    payload: { user_id: uuid, email: string }
    triggers:
      - job_send_welcome_email
```

### `job_*` — Background Jobs

```yaml
job_generate_og_image:
  parent: jobs
  props:
    trigger: event_aide_published
    input: { aide_id: uuid }
    steps:
      - Load aide content
      - Render preview image
      - Upload to CDN
      - Update aide.og_image_url
```

### `service_*` — External Integrations

```yaml
service_stripe:
  parent: services
  props:
    type: payments
    config:
      webhook_path: /api/webhooks/stripe
    events:
      - checkout.session.completed
      - customer.subscription.updated

service_resend:
  parent: services
  props:
    type: email
    used_by: [job_send_welcome_email]
```

---

## Relationships

```yaml
relationships:
  # Screen triggers endpoint
  - from: screen_editor
    to: endpoint_update_aide
    type: calls
    trigger: comp_save_button

  # Endpoint uses action
  - from: endpoint_publish_aide
    to: action_publish_aide
    type: executes

  # Action emits event
  - from: action_publish_aide
    to: event_aide_published
    type: emits

  # Event triggers job
  - from: event_aide_published
    to: job_generate_og_image
    type: triggers

  # Model references model
  - from: model_aide
    to: model_user
    type: belongs_to
    field: owner_id
```

---

## Container Hierarchy

```
aide_root
├── models/
│   ├── model_user
│   ├── model_aide
│   └── model_session
├── endpoints/
│   ├── endpoint_get_aide
│   ├── endpoint_create_aide
│   └── endpoint_publish_aide
├── actions/
│   ├── action_create_aide
│   └── action_publish_aide
├── rules/
│   ├── rule_authenticated
│   └── rule_owner_only
├── events/
│   ├── event_aide_published
│   └── event_user_signed_up
├── jobs/
│   └── job_generate_og_image
├── services/
│   ├── service_stripe
│   └── service_resend
├── screens/
│   └── (existing)
├── components/
│   └── (existing)
└── cujs/
    └── (existing)
```

---

## CUJ Integration

Scenarios now reference backend entities:

```yaml
sc_publish_success:
  parent: cuj_publish
  props:
    name: Publish aide to public URL
    given: User has completed aide
    when: User clicks publish button
    then: Aide is publicly accessible
    path: screen_editor, screen_published
    calls: endpoint_publish_aide
    expects:
      - action_publish_aide executes
      - event_aide_published emits
      - aide.published == true
```

---

## Invariants for Backend

```yaml
inv_endpoints_authenticated:
  parent: invariants
  category: security
  props:
    statement: All non-public endpoints require authentication
    check: endpoint.auth != null unless endpoint.public == true

inv_models_have_timestamps:
  parent: invariants
  category: schema
  props:
    statement: All models have created_at and updated_at
    check: model.fields includes created_at AND updated_at

inv_actions_have_preconditions:
  parent: invariants
  category: correctness
  props:
    statement: Mutating actions define preconditions
    check: action.preconditions.length > 0

inv_events_have_handlers:
  parent: invariants
  category: completeness
  props:
    statement: All events have at least one job or handler
    check: event.triggers.length > 0
```

---

## Code Generation Mapping

| Aide Entity | Generated Code |
|-------------|----------------|
| `model_*` | Prisma/Drizzle schema, TypeScript types |
| `endpoint_*` | API route handlers (Next.js/FastAPI) |
| `action_*` | Service functions |
| `rule_*` | Middleware, guards |
| `event_*` | Event types, emitters |
| `job_*` | Background worker functions |
| `service_*` | SDK wrappers, config |

---

## Next Steps

1. Add container entities to bantay.aide (`models`, `endpoints`, etc.)
2. Extend `bantay aide add` to support new entity types
3. Add validators for backend entity schemas
4. Build `bantay generate` to produce code from these entities
5. Update `bantay reverse` to detect backend patterns

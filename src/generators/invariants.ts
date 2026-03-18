import type { StackDetectionResult } from "../detectors";

export interface Invariant {
  id: string;
  category: string;
  statement: string;
}

interface InvariantTemplate {
  id: string;
  category: string;
  statement: string;
}

/**
 * Generate stack-specific invariants based on detected components.
 * These are project-specific, checkable rules — not generic security posters.
 */
function collectInvariants(stack: StackDetectionResult): InvariantTemplate[] {
  const invariants: InvariantTemplate[] = [];

  // Next.js App Router invariants
  if (stack.framework?.name === "nextjs" && stack.framework.router === "app") {
    const routePattern = stack.framework.routePattern || "app/api/**/route.ts";

    // Auth invariants depend on detected auth library
    if (stack.auth?.name === "clerk") {
      invariants.push({
        id: "inv_route_auth",
        category: "auth",
        statement: `Every ${routePattern} calls auth() from @clerk/nextjs before processing the request`,
      });
      invariants.push({
        id: "inv_server_action_auth",
        category: "auth",
        statement: `Every server action ("use server") calls auth() and checks userId before mutating data`,
      });
    } else if (stack.auth?.name === "authjs") {
      const authFn = stack.auth.sessionFunction || "auth()";
      invariants.push({
        id: "inv_route_auth",
        category: "auth",
        statement: `Every ${routePattern} calls ${authFn} and checks session before processing the request`,
      });
      invariants.push({
        id: "inv_server_action_auth",
        category: "auth",
        statement: `Every server action ("use server") calls ${authFn} and checks session.user before mutating data`,
      });
    } else {
      // No auth detected, use generic but still specific pattern
      invariants.push({
        id: "inv_route_auth",
        category: "auth",
        statement: `Every ${routePattern} verifies authentication before processing the request`,
      });
    }

    // Middleware invariant if auth detected
    if (stack.auth) {
      invariants.push({
        id: "inv_middleware_matcher",
        category: "auth",
        statement: `middleware.ts config.matcher includes all protected routes — unmatched routes bypass auth`,
      });
    }
  }

  // Next.js Pages Router invariants
  if (stack.framework?.name === "nextjs" && stack.framework.router === "pages") {
    const routePattern = stack.framework.routePattern || "pages/api/**/*.ts";

    if (stack.auth?.name === "authjs") {
      invariants.push({
        id: "inv_route_auth",
        category: "auth",
        statement: `Every ${routePattern} calls getServerSession(req, res, authOptions) before processing`,
      });
    } else {
      invariants.push({
        id: "inv_route_auth",
        category: "auth",
        statement: `Every ${routePattern} verifies authentication before processing the request`,
      });
    }
  }

  // Prisma invariants
  if (stack.orm?.name === "prisma") {
    const schemaPath = stack.orm.schemaPath || "prisma/schema.prisma";
    invariants.push({
      id: "inv_model_timestamps",
      category: "schema",
      statement: `Every model in ${schemaPath} has createdAt DateTime @default(now()) and updatedAt DateTime @updatedAt`,
    });
    invariants.push({
      id: "inv_model_soft_delete",
      category: "schema",
      statement: `Every model in ${schemaPath} has deletedAt DateTime? for soft-delete support`,
    });
    invariants.push({
      id: "inv_no_raw_sql",
      category: "schema",
      statement: `No $queryRaw or $executeRaw calls in source files — use Prisma client methods only`,
    });
  }

  // Drizzle invariants
  if (stack.orm?.name === "drizzle") {
    const schemaPath = stack.orm.schemaPath || "src/db/schema.ts";
    invariants.push({
      id: "inv_table_timestamps",
      category: "schema",
      statement: `Every table in ${schemaPath} has createdAt: timestamp().defaultNow() and updatedAt: timestamp().defaultNow().$onUpdate(() => new Date())`,
    });
    invariants.push({
      id: "inv_table_soft_delete",
      category: "schema",
      statement: `Every table in ${schemaPath} has deletedAt: timestamp() for soft-delete support`,
    });
  }

  // Stripe invariants
  if (stack.payments?.name === "stripe") {
    const webhookPattern = stack.payments.webhookPattern || "app/api/webhooks/stripe/route.ts";
    invariants.push({
      id: "inv_stripe_webhook_verify",
      category: "payments",
      statement: `${webhookPattern} calls stripe.webhooks.constructEvent() with STRIPE_WEBHOOK_SECRET before processing any event`,
    });
    invariants.push({
      id: "inv_stripe_secret_server",
      category: "payments",
      statement: `STRIPE_SECRET_KEY is only accessed in server-side code — never imported in files under app/**/page.tsx or components/`,
    });
    invariants.push({
      id: "inv_stripe_idempotency",
      category: "payments",
      statement: `Every stripe.charges.create() and stripe.subscriptions.create() call includes idempotencyKey parameter`,
    });
  }

  // Logging invariants (if any ORM detected, likely has user data)
  if (stack.orm) {
    invariants.push({
      id: "inv_no_pii_logs",
      category: "logging",
      statement: `No console.log, logger.info, or logger.error call includes email, password, ssn, creditCard, or token fields`,
    });
  }

  // Environment invariants
  if (stack.framework?.name === "nextjs") {
    invariants.push({
      id: "inv_env_no_commit",
      category: "security",
      statement: `.env and .env.local are in .gitignore — only .env.example with placeholder values is committed`,
    });
  }

  // If no stack detected, provide minimal but still specific invariants
  if (invariants.length === 0) {
    invariants.push({
      id: "inv_env_no_commit",
      category: "security",
      statement: `.env files are in .gitignore — secrets never committed to version control`,
    });
  }

  return invariants;
}

function groupByCategory(invariants: InvariantTemplate[]): Map<string, InvariantTemplate[]> {
  const grouped = new Map<string, InvariantTemplate[]>();

  for (const inv of invariants) {
    const existing = grouped.get(inv.category) ?? [];
    existing.push(inv);
    grouped.set(inv.category, existing);
  }

  return grouped;
}

function formatCategoryName(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export async function generateInvariants(stack: StackDetectionResult): Promise<string> {
  const invariants = collectInvariants(stack);
  const grouped = groupByCategory(invariants);

  const lines: string[] = [
    "# Project Invariants",
    "",
    "Rules that must hold for this codebase. Checked by `bantay check` on every PR.",
    "",
  ];

  // Add detected stack summary
  const stackParts: string[] = [];
  if (stack.framework) {
    stackParts.push(`${stack.framework.name}${stack.framework.router ? ` (${stack.framework.router} router)` : ""}`);
  }
  if (stack.orm) {
    stackParts.push(stack.orm.name);
  }
  if (stack.auth) {
    stackParts.push(stack.auth.name);
  }
  if (stack.payments) {
    stackParts.push(stack.payments.name);
  }

  if (stackParts.length > 0) {
    lines.push(`**Detected stack:** ${stackParts.join(" + ")}`);
    lines.push("");
  }

  for (const [category, invs] of grouped) {
    lines.push(`## ${formatCategoryName(category)}`);
    lines.push("");

    for (const inv of invs) {
      lines.push(`- [ ] **${inv.id}**: ${inv.statement}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function parseInvariants(markdown: string): Invariant[] {
  const invariants: Invariant[] = [];

  // Pattern 1: Old format - [INV-XXX] category | statement
  const oldRegex = /^-\s*\[([A-Z]+-\d{3})\]\s*(\w+)\s*\|\s*(.+)$/gm;

  // Pattern 2: Aide-generated format - [ ] **inv_id**: statement
  // Category is determined by the preceding ## Header
  const lines = markdown.split("\n");
  let currentCategory = "uncategorized";

  for (const line of lines) {
    // Check for category header (## Category Name)
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      // Convert "Auditability" to "auditability"
      currentCategory = headerMatch[1].trim().toLowerCase().replace(/\s+/g, "_");
      continue;
    }

    // Check for old format
    const oldMatch = line.match(/^-\s*\[([A-Z]+-\d{3})\]\s*(\w+)\s*\|\s*(.+)$/);
    if (oldMatch) {
      invariants.push({
        id: oldMatch[1],
        category: oldMatch[2],
        statement: oldMatch[3].trim(),
      });
      continue;
    }

    // Check for aide-generated format: - [ ] **inv_id**: statement or - [x] **inv_id**: statement
    const aideMatch = line.match(/^-\s*\[[x ]\]\s*\*\*([^*]+)\*\*:\s*(.+)$/);
    if (aideMatch) {
      invariants.push({
        id: aideMatch[1],
        category: currentCategory,
        statement: aideMatch[2].trim(),
      });
    }
  }

  return invariants;
}

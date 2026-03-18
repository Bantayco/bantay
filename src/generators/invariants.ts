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

// Universal invariants that apply to all projects
const universalInvariants: InvariantTemplate[] = [
  {
    id: "INV-001",
    category: "security",
    statement: "No secrets or credentials committed to version control",
  },
  {
    id: "INV-002",
    category: "security",
    statement: "All user input must be validated before processing",
  },
];

// Next.js specific invariants
const nextjsInvariants: InvariantTemplate[] = [
  {
    id: "INV-010",
    category: "auth",
    statement: "All API routes must check authentication before processing requests (auth-on-routes)",
  },
  {
    id: "INV-011",
    category: "auth",
    statement: "Protected pages must redirect unauthenticated users",
  },
];

// Prisma specific invariants
const prismaInvariants: InvariantTemplate[] = [
  {
    id: "INV-020",
    category: "schema",
    statement: "All database tables must have createdAt and updatedAt timestamps (timestamps-on-tables)",
  },
  {
    id: "INV-021",
    category: "schema",
    statement: "All database tables must use soft-delete pattern with deletedAt column (soft-delete)",
  },
  {
    id: "INV-022",
    category: "schema",
    statement: "No raw SQL queries - use Prisma client methods only (no-raw-sql)",
  },
];

function collectInvariants(stack: StackDetectionResult): InvariantTemplate[] {
  const invariants: InvariantTemplate[] = [...universalInvariants];

  if (stack.framework?.name === "nextjs") {
    invariants.push(...nextjsInvariants);
  }

  if (stack.orm?.name === "prisma") {
    invariants.push(...prismaInvariants);
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
    "This file defines the invariants that must hold for this project.",
    "Each invariant is checked by `bantay check` on every PR.",
    "",
  ];

  for (const [category, invs] of grouped) {
    lines.push(`## ${formatCategoryName(category)}`);
    lines.push("");

    for (const inv of invs) {
      lines.push(`- [${inv.id}] ${inv.category} | ${inv.statement}`);
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

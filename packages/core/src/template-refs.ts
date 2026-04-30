import type { WorkflowNode } from "./types.js";

const TEMPLATE_RE = /\{\{\s*@([A-Za-z0-9_-]+)(?::[^.}]+)?\.([A-Za-z0-9_.]+)\s*\}\}/g;

/**
 * Walk every value inside a node's data.config and yield every {{@nodeId(:label)?.field}} reference.
 */
function* iterRefs(value: unknown): Generator<{ sourceId: string; field: string }> {
  if (typeof value === "string") {
    for (const m of value.matchAll(TEMPLATE_RE)) {
      yield { sourceId: m[1]!, field: m[2]! };
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) yield* iterRefs(v);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) yield* iterRefs(v);
  }
}

/**
 * Given a workflow's nodes and the trigger node's id, return the set of input fields
 * that downstream actions reference via {{@triggerId.field}} or the {{@trigger.field}}
 * alias that the KeeperHub UI emits for the trigger node.
 *
 * This is what lets us auto-derive a tool input schema with no extra UI work:
 * the schema *is* the workflow's actual usage of the trigger.
 */
export function extractTriggerInputFields(
  nodes: WorkflowNode[],
  triggerId: string
): string[] {
  const triggerAliases = new Set([triggerId, "trigger"]);
  const fields = new Set<string>();
  for (const node of nodes) {
    if (node.id === triggerId) continue;
    for (const ref of iterRefs(node.data?.config)) {
      if (triggerAliases.has(ref.sourceId)) {
        // The trigger's runtime output is wrapped under `data`, so authors write
        // {{@trigger.data.address}} to read the `address` input. Strip the leading
        // `data.` so the inferred schema field is `address`, not `data`.
        const path = ref.field.replace(/^data\./, "").split(".");
        fields.add(path[0]!);
      }
    }
  }
  return [...fields].sort();
}

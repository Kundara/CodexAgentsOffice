function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function summarizeWebSearchAction(action: Record<string, unknown> | null): string | null {
  if (!action) {
    return null;
  }

  const actionType = asString(action.type);
  if (actionType === "search") {
    const query = asString(action.query);
    if (query) {
      return query;
    }
    const queries = asStringArray(action.queries);
    if (queries.length > 0) {
      return queries.join(", ");
    }
    return null;
  }

  if (actionType === "openPage") {
    return asString(action.url) ?? null;
  }

  if (actionType === "findInPage") {
    const pattern = asString(action.pattern);
    const url = asString(action.url);
    if (pattern && url) {
      return `${pattern} in ${url}`;
    }
    return pattern ?? url ?? null;
  }

  return null;
}

export function summarizeWebSearch(item: Record<string, unknown>): string {
  return (
    asString(item.query)
    ?? summarizeWebSearchAction(asRecord(item.action))
    ?? "Web search"
  );
}

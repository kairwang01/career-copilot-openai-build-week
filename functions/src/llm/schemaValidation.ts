/**
 * Minimal JSON Schema validation for Gemini structured tool responses.
 *
 * Gemini guarantees only the schema sent to the API. This validator keeps the
 * server boundary honest as well, including search-grounded responses and
 * responses returned by non-Gemini fallback providers.
 */

type SchemaRecord = Record<string, unknown>;

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

const KNOWN_TYPES = new Set([
  "ARRAY",
  "BOOLEAN",
  "INTEGER",
  "NULL",
  "NUMBER",
  "OBJECT",
  "STRING",
]);

function asRecord(value: unknown): SchemaRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as SchemaRecord
    : undefined;
}

function normalizedTypes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toUpperCase());
}

function numericConstraint(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Finds malformed schema declarations before they are sent to Gemini. */
export function schemaDefinitionIssues(
  schema: unknown,
  path = "$"
): SchemaValidationIssue[] {
  const node = asRecord(schema);
  if (!node) return [{ path, message: "schema must be an object" }];

  const types = normalizedTypes(node.type);
  const issues: SchemaValidationIssue[] = [];
  if (types.length === 0) {
    issues.push({ path, message: "schema type is required" });
    return issues;
  }
  for (const type of types) {
    if (!KNOWN_TYPES.has(type)) issues.push({ path, message: `unknown schema type ${type}` });
  }

  if (types.includes("OBJECT")) {
    const properties = asRecord(node.properties);
    if (!properties) {
      issues.push({ path, message: "object schema must declare properties" });
    } else {
      for (const [key, child] of Object.entries(properties)) {
        issues.push(...schemaDefinitionIssues(child, `${path}.${key}`));
      }
    }

    if (node.required !== undefined) {
      if (!Array.isArray(node.required) || node.required.some((key) => typeof key !== "string")) {
        issues.push({ path, message: "required must be a string array" });
      } else {
        const required = node.required as string[];
        if (new Set(required).size !== required.length) {
          issues.push({ path, message: "required contains duplicate keys" });
        }
        for (const key of required) {
          if (!properties || !(key in properties)) {
            issues.push({ path, message: `required key ${key} is not declared in properties` });
          }
        }
      }
    }
  }

  if (types.includes("ARRAY")) {
    if (node.items === undefined) {
      issues.push({ path, message: "array schema must declare items" });
    } else {
      issues.push(...schemaDefinitionIssues(node.items, `${path}[]`));
    }
  }

  if (node.enum !== undefined && !Array.isArray(node.enum)) {
    issues.push({ path, message: "enum must be an array" });
  }
  return issues;
}

/** Validates a parsed tool response against the schema subset used here. */
export function validateAgainstSchema(
  value: unknown,
  schema: unknown,
  path = "$"
): SchemaValidationIssue[] {
  const node = asRecord(schema);
  if (!node) return [{ path, message: "invalid schema" }];

  const types = normalizedTypes(node.type);
  if (types.length === 0) return [{ path, message: "schema type is missing" }];
  if (value === null && types.includes("NULL")) return [];

  const actualType = Array.isArray(value)
    ? "ARRAY"
    : value === null
      ? "NULL"
      : typeof value === "number" && Number.isInteger(value)
        ? "INTEGER"
        : typeof value === "number"
          ? "NUMBER"
          : typeof value === "string"
            ? "STRING"
            : typeof value === "boolean"
              ? "BOOLEAN"
              : typeof value === "object"
                ? "OBJECT"
                : typeof value;

  const acceptsNumber = types.includes("NUMBER") && actualType === "INTEGER";
  if (!types.includes(actualType) && !acceptsNumber) {
    return [{ path, message: `expected ${types.join("|")}, received ${actualType}` }];
  }

  const issues: SchemaValidationIssue[] = [];
  if (node.enum !== undefined && Array.isArray(node.enum) && !node.enum.includes(value)) {
    issues.push({ path, message: `value is not one of ${node.enum.join(", ")}` });
  }

  if ((actualType === "NUMBER" || actualType === "INTEGER") && typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum) {
      issues.push({ path, message: `number is below minimum ${node.minimum}` });
    }
    if (typeof node.maximum === "number" && value > node.maximum) {
      issues.push({ path, message: `number is above maximum ${node.maximum}` });
    }
  }

  if (actualType === "ARRAY" && Array.isArray(value)) {
    const minItems = numericConstraint(node.minItems);
    const maxItems = numericConstraint(node.maxItems);
    if (minItems !== undefined && value.length < minItems) {
      issues.push({ path, message: `array has fewer than ${minItems} items` });
    }
    if (maxItems !== undefined && value.length > maxItems) {
      issues.push({ path, message: `array has more than ${maxItems} items` });
    }
    if (node.items !== undefined) {
      value.forEach((item, index) => {
        issues.push(...validateAgainstSchema(item, node.items, `${path}[${index}]`));
      });
    }
  }

  if (actualType === "OBJECT") {
    const record = value as Record<string, unknown>;
    const properties = asRecord(node.properties) ?? {};
    const required = Array.isArray(node.required)
      ? node.required.filter((key): key is string => typeof key === "string")
      : [];
    for (const key of required) {
      if (!(key in record)) issues.push({ path: `${path}.${key}`, message: "required field is missing" });
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in record) {
        issues.push(...validateAgainstSchema(record[key], childSchema, `${path}.${key}`));
      }
    }
  }

  return issues;
}

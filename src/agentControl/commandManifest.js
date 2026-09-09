import source from "./commandManifest.json" with { type: "json" };

const ROOT_FIELDS = new Set(["manifestVersion", "commands"]);
const ENTRY_FIELDS = new Set([
  "id",
  "family",
  "path",
  "usage",
  "summary",
  "execution",
  "operation",
  "wireMethod",
  "featureGate",
  "json",
  "expectedRevision",
  "dryRun",
  "outputFile",
  "positionals",
  "options",
  "wireParams",
]);
const ARGUMENT_FIELDS = new Set(["name", "mapsTo", "required", "value"]);
const SCHEMA_FIELDS = new Set([
  "type",
  "enum",
  "default",
  "minimum",
  "maximum",
  "required",
  "properties",
  "items",
  "additionalProperties",
  "schemaRef",
  "title",
  "description",
  "unit",
]);
const EXECUTIONS = new Set(["offline", "runningApp"]);
const OPERATIONS = new Set(["query", "mutation", "action", "wait"]);
const JSON_POLICIES = new Set(["none", "optional", "required"]);
const REVISION_POLICIES = new Set(["none", "optional", "required"]);
const OUTPUT_POLICIES = new Set(["none", "optional", "required"]);
const SCHEMA_TYPES = new Set(["boolean", "integer", "number", "string", "array", "object"]);

function fail(path, message) {
  throw new TypeError(`Invalid command manifest at ${path}: ${message}`);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, path) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) fail(`${path}.${field}`, "unknown field");
  }
}

function validateSchema(schema, path) {
  if (!plainObject(schema)) fail(path, "must be an object");
  rejectUnknownFields(schema, SCHEMA_FIELDS, path);
  if (schema.type !== undefined && !SCHEMA_TYPES.has(schema.type)) {
    fail(`${path}.type`, "unknown schema type");
  }
  if (
    schema.schemaRef !== undefined &&
    (typeof schema.schemaRef !== "string" || !schema.schemaRef)
  ) {
    fail(`${path}.schemaRef`, "must be a non-empty string");
  }
  if (schema.type === undefined && schema.schemaRef === undefined) {
    fail(path, "must define type or schemaRef");
  }
  if (schema.properties !== undefined) {
    if (!plainObject(schema.properties)) fail(`${path}.properties`, "must be an object");
    for (const [name, child] of Object.entries(schema.properties)) {
      validateSchema(child, `${path}.properties.${name}`);
    }
  }
  if (schema.items !== undefined) validateSchema(schema.items, `${path}.items`);
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    fail(`${path}.required`, "must be an array");
  }
}

function validateArgument(argument, path) {
  if (!plainObject(argument)) fail(path, "must be an object");
  rejectUnknownFields(argument, ARGUMENT_FIELDS, path);
  if (typeof argument.name !== "string" || !argument.name) fail(`${path}.name`, "is required");
  if (argument.mapsTo !== undefined && (typeof argument.mapsTo !== "string" || !argument.mapsTo)) {
    fail(`${path}.mapsTo`, "must be a non-empty string when present");
  }
  if (typeof argument.required !== "boolean") fail(`${path}.required`, "must be boolean");
  validateSchema(argument.value, `${path}.value`);
}

function validateEntry(entry, index) {
  const path = `$.commands[${index}]`;
  if (!plainObject(entry)) fail(path, "must be an object");
  rejectUnknownFields(entry, ENTRY_FIELDS, path);
  for (const field of ["id", "family", "usage", "summary"]) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) {
      fail(`${path}.${field}`, "must be a non-empty string");
    }
  }
  if (!Array.isArray(entry.path) || entry.path.length === 0 || entry.path.some((part) => !part)) {
    fail(`${path}.path`, "must contain non-empty CLI tokens");
  }
  if (entry.family !== entry.path[0]) fail(`${path}.family`, "must equal the first path token");
  if (!EXECUTIONS.has(entry.execution)) fail(`${path}.execution`, "unknown execution class");
  if (!OPERATIONS.has(entry.operation)) fail(`${path}.operation`, "unknown operation class");
  if (!JSON_POLICIES.has(entry.json)) fail(`${path}.json`, "unknown JSON policy");
  if (!REVISION_POLICIES.has(entry.expectedRevision)) {
    fail(`${path}.expectedRevision`, "unknown revision policy");
  }
  if (!OUTPUT_POLICIES.has(entry.outputFile)) fail(`${path}.outputFile`, "unknown output policy");
  if (typeof entry.dryRun !== "boolean") fail(`${path}.dryRun`, "must be boolean");
  if (!Array.isArray(entry.positionals)) fail(`${path}.positionals`, "must be an array");
  if (!Array.isArray(entry.options)) fail(`${path}.options`, "must be an array");
  entry.positionals.forEach((argument, offset) =>
    validateArgument(argument, `${path}.positionals[${offset}]`)
  );
  entry.options.forEach((argument, offset) =>
    validateArgument(argument, `${path}.options[${offset}]`)
  );
  validateSchema(entry.wireParams, `${path}.wireParams`);

  if (entry.execution === "offline") {
    if (entry.wireMethod !== undefined)
      fail(`${path}.wireMethod`, "offline commands have no wire method");
    if (entry.featureGate !== undefined)
      fail(`${path}.featureGate`, "offline commands have no feature gate");
    if (entry.expectedRevision !== "none" || entry.dryRun) {
      fail(path, "offline commands cannot use revision or dry-run policies");
    }
  } else if (typeof entry.wireMethod !== "string" || !entry.wireMethod) {
    fail(`${path}.wireMethod`, "running-app commands require a wire method");
  }
  if (
    entry.expectedRevision === "none" &&
    entry.options.some(({ name }) => name === "--expected-revision")
  ) {
    fail(path, "revision option disagrees with revision policy");
  }
  if (entry.dryRun !== entry.options.some(({ name }) => name === "--dry-run")) {
    fail(path, "dry-run option disagrees with dry-run policy");
  }
  if (entry.outputFile === "none" && entry.options.some(({ name }) => name === "--out")) {
    fail(path, "output option disagrees with output policy");
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function validateCommandManifest(manifest) {
  if (!plainObject(manifest)) fail("$", "must be an object");
  rejectUnknownFields(manifest, ROOT_FIELDS, "$");
  if (manifest.manifestVersion !== 1) fail("$.manifestVersion", "must be 1");
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    fail("$.commands", "must be a non-empty array");
  }

  const ids = new Set();
  const paths = new Set();
  const wireMethods = new Set();
  manifest.commands.forEach((entry, index) => {
    validateEntry(entry, index);
    const cliPath = entry.path.join(" ");
    for (const [value, values, label] of [
      [entry.id, ids, "id"],
      [cliPath, paths, "CLI path"],
      ...(entry.wireMethod ? [[entry.wireMethod, wireMethods, "wire method"]] : []),
    ]) {
      if (values.has(value)) fail(`$.commands[${index}]`, `duplicate ${label}: ${value}`);
      values.add(value);
    }
  });
  return manifest;
}

export const commandManifest = deepFreeze(validateCommandManifest(source));
export const commandEntries = commandManifest.commands;
export const runningAppCommandEntries = Object.freeze(
  commandEntries.filter(({ execution }) => execution === "runningApp")
);
export const runningAppWireMethods = Object.freeze(
  runningAppCommandEntries.map(({ wireMethod }) => wireMethod)
);
export function commandEntriesForFamily(family) {
  return runningAppCommandEntries.filter((entry) => entry.family === family);
}
export function commandEntriesForFeatureGate(featureGate) {
  return runningAppCommandEntries.filter((entry) => entry.featureGate === featureGate);
}
export const commandEntryById = new Map(commandEntries.map((entry) => [entry.id, entry]));

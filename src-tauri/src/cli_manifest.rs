use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

pub const COMMAND_MANIFEST_JSON: &str = include_str!("../../src/agentControl/commandManifest.json");

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommandManifest {
  pub manifest_version: u32,
  pub commands: Vec<CommandEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommandEntry {
  pub id: String,
  pub family: String,
  pub path: Vec<String>,
  pub usage: String,
  pub summary: String,
  pub execution: String,
  pub operation: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub wire_method: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub feature_gate: Option<String>,
  pub json: String,
  pub expected_revision: String,
  pub dry_run: bool,
  pub output_file: String,
  pub positionals: Vec<CommandArgument>,
  pub options: Vec<CommandArgument>,
  pub wire_params: SchemaNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommandArgument {
  pub name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub maps_to: Option<String>,
  pub required: bool,
  pub value: SchemaNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SchemaNode {
  #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
  pub kind: Option<String>,
  #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
  pub enum_values: Option<Vec<Value>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub default: Option<Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub minimum: Option<Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub maximum: Option<Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub required: Option<Vec<String>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub properties: Option<std::collections::BTreeMap<String, SchemaNode>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub items: Option<Box<SchemaNode>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub additional_properties: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub schema_ref: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub title: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub description: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub unit: Option<String>,
}

fn validate_schema(schema: &SchemaNode, path: &str) -> Result<(), String> {
  const TYPES: &[&str] = &["boolean", "integer", "number", "string", "array", "object"];
  if schema.kind.is_none() && schema.schema_ref.is_none() {
    return Err(format!("{path} must define type or schemaRef"));
  }
  if let Some(kind) = schema.kind.as_deref() {
    if !TYPES.contains(&kind) {
      return Err(format!("{path}.type has unknown schema type {kind}"));
    }
  }
  if schema.schema_ref.as_deref().is_some_and(str::is_empty) {
    return Err(format!("{path}.schemaRef must be non-empty"));
  }
  if let Some(properties) = &schema.properties {
    for (name, child) in properties {
      validate_schema(child, &format!("{path}.properties.{name}"))?;
    }
  }
  if let Some(items) = &schema.items {
    validate_schema(items, &format!("{path}.items"))?;
  }
  Ok(())
}

fn validate_argument(argument: &CommandArgument, path: &str) -> Result<(), String> {
  if argument.name.is_empty() {
    return Err(format!("{path}.name must be non-empty"));
  }
  if argument.maps_to.as_deref().is_some_and(str::is_empty) {
    return Err(format!("{path}.mapsTo must be non-empty when present"));
  }
  validate_schema(&argument.value, &format!("{path}.value"))
}

pub fn validate_manifest(manifest: &CommandManifest) -> Result<(), String> {
  if manifest.manifest_version != 1 {
    return Err("$.manifestVersion must be 1".to_string());
  }
  if manifest.commands.is_empty() {
    return Err("$.commands must be non-empty".to_string());
  }

  let mut ids = HashSet::new();
  let mut paths = HashSet::new();
  let mut wire_methods = HashSet::new();
  for (index, entry) in manifest.commands.iter().enumerate() {
    let path = format!("$.commands[{index}]");
    if entry.id.trim().is_empty()
      || entry.family.trim().is_empty()
      || entry.usage.trim().is_empty()
      || entry.summary.trim().is_empty()
    {
      return Err(format!(
        "{path} has an empty identity, family, usage, or summary"
      ));
    }
    if entry.path.is_empty() || entry.path.iter().any(String::is_empty) {
      return Err(format!("{path}.path must contain non-empty CLI tokens"));
    }
    if entry.path.first() != Some(&entry.family) {
      return Err(format!("{path}.family must equal the first path token"));
    }
    if !["offline", "runningApp"].contains(&entry.execution.as_str()) {
      return Err(format!("{path}.execution is unknown"));
    }
    if !["query", "mutation", "action", "wait"].contains(&entry.operation.as_str()) {
      return Err(format!("{path}.operation is unknown"));
    }
    if !["optional", "required"].contains(&entry.json.as_str()) {
      return Err(format!("{path}.json is unknown"));
    }
    if !["none", "optional", "required"].contains(&entry.expected_revision.as_str()) {
      return Err(format!("{path}.expectedRevision is unknown"));
    }
    if !["none", "optional", "required"].contains(&entry.output_file.as_str()) {
      return Err(format!("{path}.outputFile is unknown"));
    }
    entry
      .positionals
      .iter()
      .enumerate()
      .try_for_each(|(offset, argument)| {
        validate_argument(argument, &format!("{path}.positionals[{offset}]"))
      })?;
    entry
      .options
      .iter()
      .enumerate()
      .try_for_each(|(offset, argument)| {
        validate_argument(argument, &format!("{path}.options[{offset}]"))
      })?;
    validate_schema(&entry.wire_params, &format!("{path}.wireParams"))?;

    if entry.execution == "offline" {
      if entry.wire_method.is_some() || entry.feature_gate.is_some() {
        return Err(format!("{path} offline commands cannot have wire metadata"));
      }
      if entry.expected_revision != "none" || entry.dry_run {
        return Err(format!(
          "{path} offline commands cannot use revision or dry-run policies"
        ));
      }
    } else if entry.wire_method.as_deref().is_none_or(str::is_empty) {
      return Err(format!("{path} running-app commands require a wire method"));
    }
    let option_named = |name: &str| entry.options.iter().any(|option| option.name == name);
    if entry.expected_revision == "none" && option_named("--expected-revision") {
      return Err(format!(
        "{path} revision option disagrees with revision policy"
      ));
    }
    if entry.dry_run != option_named("--dry-run") {
      return Err(format!(
        "{path} dry-run option disagrees with dry-run policy"
      ));
    }
    if entry.output_file == "none" && option_named("--out") {
      return Err(format!("{path} output option disagrees with output policy"));
    }

    if !ids.insert(entry.id.as_str()) {
      return Err(format!("{path} has duplicate id {}", entry.id));
    }
    let cli_path = entry.path.join(" ");
    if !paths.insert(cli_path.clone()) {
      return Err(format!("{path} has duplicate CLI path {cli_path}"));
    }
    if let Some(method) = entry.wire_method.as_deref() {
      if !wire_methods.insert(method) {
        return Err(format!("{path} has duplicate wire method {method}"));
      }
    }
  }
  Ok(())
}

pub fn parse_manifest(json: &str) -> Result<CommandManifest, String> {
  let manifest: CommandManifest = serde_json::from_str(json)
    .map_err(|error| format!("invalid command manifest JSON: {error}"))?;
  validate_manifest(&manifest)?;
  Ok(manifest)
}

pub fn command_manifest() -> Result<&'static CommandManifest, &'static str> {
  static MANIFEST: OnceLock<Result<CommandManifest, String>> = OnceLock::new();
  MANIFEST
    .get_or_init(|| parse_manifest(COMMAND_MANIFEST_JSON))
    .as_ref()
    .map_err(String::as_str)
}

pub fn command_by_id(id: &str) -> Option<&'static CommandEntry> {
  command_manifest()
    .ok()?
    .commands
    .iter()
    .find(|command| command.id == id)
}

pub fn command_families(execution: &str) -> Vec<&'static str> {
  let Ok(manifest) = command_manifest() else {
    return Vec::new();
  };
  let mut seen = HashSet::new();
  manifest
    .commands
    .iter()
    .filter(|command| command.execution == execution)
    .filter_map(|command| {
      let family = command.family.as_str();
      seen.insert(family).then_some(family)
    })
    .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSummary<'a> {
  pub id: &'a str,
  pub family: &'a str,
  pub path: &'a [String],
  pub summary: &'a str,
  pub execution: &'a str,
  pub operation: &'a str,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub wire_method: Option<&'a str>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub feature_gate: Option<&'a str>,
}

impl<'a> From<&'a CommandEntry> for CommandSummary<'a> {
  fn from(entry: &'a CommandEntry) -> Self {
    Self {
      id: &entry.id,
      family: &entry.family,
      path: &entry.path,
      summary: &entry.summary,
      execution: &entry.execution,
      operation: &entry.operation,
      wire_method: entry.wire_method.as_deref(),
      feature_gate: entry.feature_gate.as_deref(),
    }
  }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaListResult<'a> {
  pub manifest_version: u32,
  pub commands: Vec<CommandSummary<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaGetResult<'a> {
  pub manifest_version: u32,
  pub command: &'a CommandEntry,
}

pub fn schema_list_result(manifest: &CommandManifest) -> SchemaListResult<'_> {
  SchemaListResult {
    manifest_version: manifest.manifest_version,
    commands: manifest.commands.iter().map(CommandSummary::from).collect(),
  }
}

pub fn schema_get_result<'a>(
  manifest: &'a CommandManifest,
  id: &str,
) -> Option<SchemaGetResult<'a>> {
  manifest
    .commands
    .iter()
    .find(|command| command.id == id)
    .map(|command| SchemaGetResult {
      manifest_version: manifest.manifest_version,
      command,
    })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn embedded_manifest_is_valid_and_complete() {
    let manifest = command_manifest().unwrap();
    assert_eq!(manifest.manifest_version, 1);
    assert_eq!(manifest.commands.len(), 92);
    assert_eq!(
      manifest
        .commands
        .iter()
        .filter(|command| command.execution == "runningApp")
        .count(),
      89
    );
    assert_eq!(
      command_by_id("visual.recording.start")
        .unwrap()
        .feature_gate
        .as_deref(),
      Some("visual.recording")
    );
    assert_eq!(command_by_id("schema.list").unwrap().execution, "offline");
  }

  #[test]
  fn strict_models_reject_unknown_fields() {
    let json = COMMAND_MANIFEST_JSON.replacen(
      "\"manifestVersion\": 1,",
      "\"manifestVersion\": 1, \"typo\": true,",
      1,
    );
    assert!(parse_manifest(&json).unwrap_err().contains("unknown field"));

    let json =
      COMMAND_MANIFEST_JSON.replacen("\"wireParams\": {", "\"wireParams\": { \"typo\": true,", 1);
    assert!(parse_manifest(&json).unwrap_err().contains("unknown field"));
  }

  #[test]
  fn semantic_validation_rejects_duplicate_and_invalid_policies() {
    let mut manifest = parse_manifest(COMMAND_MANIFEST_JSON).unwrap();
    manifest.commands[1].id = manifest.commands[0].id.clone();
    assert!(validate_manifest(&manifest)
      .unwrap_err()
      .contains("duplicate id"));

    let mut manifest = parse_manifest(COMMAND_MANIFEST_JSON).unwrap();
    let doctor = manifest.commands.last_mut().unwrap();
    doctor.wire_method = Some("doctor.run".to_string());
    assert!(validate_manifest(&manifest)
      .unwrap_err()
      .contains("offline commands"));
  }

  #[test]
  fn serde_projection_round_trips_the_exact_catalog() {
    let parsed = parse_manifest(COMMAND_MANIFEST_JSON).unwrap();
    let projected = serde_json::to_value(&parsed).unwrap();
    let source: Value = serde_json::from_str(COMMAND_MANIFEST_JSON).unwrap();
    assert_eq!(projected, source);
  }
}

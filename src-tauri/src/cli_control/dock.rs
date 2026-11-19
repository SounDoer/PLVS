use serde_json::Value;
use std::io::Read;

use super::{is_help, read_json_document, ControlCommand, ControlFailure, MAX_SAFE_REVISION};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DockMutation {
  pub(super) method: String,
  panel_id: Option<String>,
  input: Option<String>,
  edge: Option<String>,
  monitor: Option<String>,
  reserve_space: Option<bool>,
  above_full_screen: Option<bool>,
  height: Option<u64>,
  expected_revision: Option<u64>,
  dry_run: bool,
}

impl DockMutation {
  pub(super) fn params<R: Read>(&self, stdin: &mut R) -> Result<Value, ControlFailure> {
    let Self {
      method,
      panel_id,
      input,
      edge,
      monitor,
      reserve_space,
      above_full_screen,
      height,
      expected_revision,
      dry_run,
    } = self;
    let mut params = serde_json::Map::new();
    if let Some(panel_id) = panel_id {
      params.insert("panelId".to_string(), Value::String(panel_id.clone()));
    }
    if let Some(input) = input {
      let subject = if method == "dock.layout.apply" {
        "Dock layout"
      } else {
        "Dock panel controls"
      };
      let document =
        read_json_document(input, stdin, subject).map_err(ControlFailure::invalid_arguments)?;
      params.insert(
        if method == "dock.layout.apply" {
          "layout"
        } else {
          "patch"
        }
        .to_string(),
        document,
      );
    }
    if let Some(value) = edge {
      params.insert("edge".to_string(), Value::String(value.clone()));
    }
    if let Some(value) = monitor {
      params.insert("monitor".to_string(), Value::String(value.clone()));
    }
    if let Some(value) = reserve_space {
      params.insert("reserveSpace".to_string(), Value::Bool(*value));
    }
    if let Some(value) = above_full_screen {
      params.insert("aboveFullScreen".to_string(), Value::Bool(*value));
    }
    if let Some(value) = height {
      params.insert("height".to_string(), Value::from(*value));
    }
    if method != "dock.panel.describe" {
      params.insert("dryRun".to_string(), Value::Bool(*dry_run));
      if let Some(revision) = expected_revision {
        params.insert("expectedRevision".to_string(), Value::from(*revision));
      }
    }
    Ok(Value::Object(params))
  }
}

pub(super) fn parse_args(args: &[String]) -> Result<ControlCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(ControlCommand::Help);
  }
  if let [action, json] = args {
    if matches!(action.as_str(), "describe" | "inspect") && json == "--json" {
      return Ok(ControlCommand::DockRead {
        method: format!("dock.{action}"),
      });
    }
  }
  let (method, panel_id, input, consumed) = match args {
    [action, ..] if matches!(action.as_str(), "enter" | "exit") => {
      (format!("dock.{action}"), None, None, 1)
    }
    [scope, action, ..] if scope == "layout" && action == "reset" => {
      ("dock.layout.reset".to_string(), None, None, 2)
    }
    [scope, action, value, ..] if scope == "layout" && action == "apply" => {
      ("dock.layout.apply".to_string(), None, Some(value.clone()), 3)
    }
    [scope, action, panel_id, ..]
      if scope == "panel" && matches!(action.as_str(), "describe" | "reset") =>
    {
      (format!("dock.panel.{action}"), Some(panel_id.clone()), None, 3)
    }
    [scope, action, panel_id, input, ..] if scope == "panel" && action == "update" => (
      "dock.panel.update".to_string(),
      Some(panel_id.clone()),
      Some(input.clone()),
      4,
    ),
    _ => return Err("Usage: plvs-cli dock <describe|inspect|enter|exit|layout apply|layout reset|panel describe|panel update|panel reset> ... --json".to_string()),
  };
  let read_panel = method == "dock.panel.describe";
  let enter = method == "dock.enter";
  let mut edge = None;
  let mut monitor = None;
  let mut reserve_space = None;
  let mut above_full_screen = None;
  let mut height = None;
  let mut expected_revision = None;
  let mut dry_run = false;
  let mut json = false;
  let mut index = consumed;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" if !read_panel => {
        dry_run = true;
        index += 1;
      }
      "--edge" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --edge.".to_string())?;
        if !matches!(value.as_str(), "top" | "bottom") {
          return Err("The --edge value must be top or bottom.".to_string());
        }
        edge = Some(value.clone());
        index += 2;
      }
      "--monitor" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --monitor.".to_string())?;
        if value.is_empty() {
          return Err("The --monitor value must be non-empty.".to_string());
        }
        monitor = Some(value.clone());
        index += 2;
      }
      "--reserve-space" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --reserve-space.".to_string())?;
        reserve_space = Some(match value.as_str() {
          "true" => true,
          "false" => false,
          _ => return Err("The --reserve-space value must be true or false.".to_string()),
        });
        index += 2;
      }
      "--above-full-screen" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --above-full-screen.".to_string())?;
        above_full_screen = Some(match value.as_str() {
          "true" => true,
          "false" => false,
          _ => return Err("The --above-full-screen value must be true or false.".to_string()),
        });
        index += 2;
      }
      "--height" if enter => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --height.".to_string())?;
        let parsed = value
          .parse::<u64>()
          .map_err(|_| "The --height value must be an integer from 56 to 4294967295; the display limits the applied height.".to_string())?;
        if !(56..=u64::from(u32::MAX)).contains(&parsed) {
          return Err("The --height value must be an integer from 56 to 4294967295; the display limits the applied height.".to_string());
        }
        height = Some(parsed);
        index += 2;
      }
      "--expected-revision" if !read_panel => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let parsed = value.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if parsed > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(parsed);
        index += 2;
      }
      value => return Err(format!("Unexpected dock argument: {value}")),
    }
  }
  if !json {
    return Err("The dock command requires --json.".to_string());
  }
  if !read_panel && expected_revision.is_none() {
    return Err(format!(
      "The {method} command requires --expected-revision."
    ));
  }
  Ok(ControlCommand::DockCommand(DockMutation {
    method,
    panel_id,
    input,
    edge,
    monitor,
    reserve_space,
    above_full_screen,
    height,
    expected_revision,
    dry_run,
  }))
}

#[cfg(test)]
mod tests {
  use super::super::{help_text, parse_control_args, request_for_command};
  use super::*;
  use std::io::Cursor;

  fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
  }

  #[test]
  fn parses_and_builds_dock_commands() {
    assert!(help_text().contains("plvs-cli dock layout apply"));
    assert_eq!(
      parse_control_args(&args(&["dock", "inspect", "--json"])),
      Ok(ControlCommand::DockRead {
        method: "dock.inspect".to_string(),
      })
    );
    let enter = parse_control_args(&args(&[
      "dock",
      "enter",
      "--edge",
      "top",
      "--monitor",
      "DISPLAY1",
      "--reserve-space",
      "false",
      "--above-full-screen",
      "false",
      "--height",
      "72",
      "--expected-revision",
      "3",
      "--dry-run",
      "--json",
    ]))
    .unwrap();
    let request = request_for_command(&enter, &mut Cursor::new([])).unwrap();
    assert_eq!(request.method, "dock.enter");
    assert_eq!(request.params["edge"], "top");
    assert_eq!(request.params["monitor"], "DISPLAY1");
    assert_eq!(request.params["reserveSpace"], false);
    assert_eq!(request.params["aboveFullScreen"], false);
    assert_eq!(request.params["height"], 72);
    assert_eq!(request.params["expectedRevision"], 3);

    let update = parse_control_args(&args(&[
      "dock",
      "panel",
      "update",
      "level",
      "-",
      "--json",
      "--expected-revision",
      "3",
    ]))
    .unwrap();
    let request = request_for_command(&update, &mut Cursor::new(br#"{"mode":"rms"}"#)).unwrap();
    assert_eq!(request.method, "dock.panel.update");
    assert_eq!(request.params["panelId"], "level");
    assert_eq!(request.params["patch"]["mode"], "rms");

    for invalid in [
      args(&["dock", "describe"]),
      args(&["dock", "enter", "--edge", "left", "--json"]),
      args(&["dock", "enter", "--height", "55", "--json"]),
      args(&["dock", "enter", "--reserve-space", "yes", "--json"]),
      args(&["dock", "enter", "--above-full-screen", "yes", "--json"]),
      args(&["dock", "layout", "apply", "--json"]),
      args(&["dock", "panel", "update", "level", "--json"]),
    ] {
      assert!(
        parse_control_args(&invalid).is_err(),
        "accepted {invalid:?}"
      );
    }
  }
}

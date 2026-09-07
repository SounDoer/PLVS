fn main() {
  let config = if std::env::var_os("CARGO_FEATURE_DEV_IDENTITY").is_some() {
    "tauri.dev.conf.json"
  } else {
    "tauri.conf.json"
  };
  let config_path = std::path::Path::new("..").join(config);
  println!("cargo:rerun-if-changed={}", config_path.display());

  let text = std::fs::read_to_string(&config_path)
    .unwrap_or_else(|err| panic!("failed to read {}: {err}", config_path.display()));
  let value: serde_json::Value = serde_json::from_str(&text)
    .unwrap_or_else(|err| panic!("failed to parse {}: {err}", config_path.display()));
  let identifier = value
    .get("identifier")
    .and_then(serde_json::Value::as_str)
    .unwrap_or_else(|| panic!("{} has no string `identifier`", config_path.display()));

  println!("cargo:rustc-env=PLVS_APP_ID={identifier}");
}

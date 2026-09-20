fn main() {
  let development = std::env::var_os("CARGO_FEATURE_DEV_IDENTITY").is_some();
  let preview = std::env::var_os("CARGO_FEATURE_PREVIEW_IDENTITY").is_some();
  assert!(
    !(development && preview),
    "CLI identities are mutually exclusive"
  );
  let config = match (development, preview) {
    (true, false) => "tauri.dev.conf.json",
    (false, true) => "tauri.preview.conf.json",
    (false, false) => "tauri.conf.json",
    (true, true) => unreachable!(),
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
  let product_name = value
    .get("productName")
    .and_then(serde_json::Value::as_str)
    .unwrap_or_else(|| panic!("{} has no string `productName`", config_path.display()));

  println!("cargo:rustc-env=PLVS_APP_ID={identifier}");
  println!("cargo:rustc-env=PLVS_APP_NAME={product_name}");
}

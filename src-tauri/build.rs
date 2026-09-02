/// Hand `doctor.rs` the app identifier the app itself will run under.
///
/// The identifier lives in the Tauri config, which cargo never reads, and `plvs-cli` is not a
/// Tauri app — it builds `%APPDATA%/<identifier>` by hand. A dev build overrides the identifier
/// via `--config src-tauri/tauri.dev.conf.json` so it does not share settings with an installed
/// PLVS; without this, `plvs-cli doctor` would keep reporting (and write-testing) the installed
/// app's directories. Both halves are switched by the one `dev-identity` feature, so they cannot
/// disagree about which config file is in force.
fn emit_app_id() {
  let config = if std::env::var_os("CARGO_FEATURE_DEV_IDENTITY").is_some() {
    "tauri.dev.conf.json"
  } else {
    "tauri.conf.json"
  };
  println!("cargo:rerun-if-changed={config}");

  let text =
    std::fs::read_to_string(config).unwrap_or_else(|err| panic!("failed to read {config}: {err}"));
  let value: serde_json::Value =
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("failed to parse {config}: {err}"));
  let identifier = value
    .get("identifier")
    .and_then(serde_json::Value::as_str)
    .unwrap_or_else(|| panic!("{config} has no string `identifier`"));

  println!("cargo:rustc-env=PLVS_APP_ID={identifier}");
}

fn main() {
  emit_app_id();

  let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
  if target_os == "macos" {
    println!("cargo:rerun-if-changed=native/macos/tap_bridge.m");
    cc::Build::new()
      .file("native/macos/tap_bridge.m")
      // `cc` may otherwise treat the TU as C99 → CATapDescription / tap APIs "undeclared".
      .flag("-x")
      .flag("objective-c")
      .flag("-fobjc-arc")
      .flag("-fmodules")
      .flag("-mmacosx-version-min=14.2")
      .compile("tap_bridge");
    println!("cargo:rustc-link-lib=framework=CoreAudio");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=AudioToolbox");
  }
  tauri_build::build()
}

/// Hand the runtime the app identity selected by the matching Tauri overlay.
///
/// The identifier lives in the Tauri config, which cargo never reads, and `plvs-cli` is not a
/// Tauri app — it builds `%APPDATA%/<identifier>` by hand. A dev build overrides the identifier
/// via `--config src-tauri/tauri.dev.conf.json` so it does not share settings with an installed
/// PLVS; Preview uses its own overlay for the same reason. The GUI and CLI use matching Cargo
/// features so they cannot disagree about the identity in force.
fn emit_app_identity() {
  let development = std::env::var_os("CARGO_FEATURE_DEV_IDENTITY").is_some();
  let preview = std::env::var_os("CARGO_FEATURE_PREVIEW_IDENTITY").is_some();
  assert!(
    !(development && preview),
    "app identities are mutually exclusive"
  );
  let config = match (development, preview) {
    (true, false) => "tauri.dev.conf.json",
    (false, true) => "tauri.preview.conf.json",
    (false, false) => "tauri.conf.json",
    (true, true) => unreachable!(),
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
  let product_name = value
    .get("productName")
    .and_then(serde_json::Value::as_str)
    .unwrap_or_else(|| panic!("{config} has no string `productName`"));

  println!("cargo:rustc-env=PLVS_APP_ID={identifier}");
  println!("cargo:rustc-env=PLVS_APP_NAME={product_name}");
}

fn main() {
  emit_app_identity();

  const COMMAND_MANIFEST: &str = "../src/agentControl/commandManifest.json";
  println!("cargo:rerun-if-changed={COMMAND_MANIFEST}");
  let manifest = std::fs::read_to_string(COMMAND_MANIFEST)
    .unwrap_or_else(|err| panic!("failed to read {COMMAND_MANIFEST}: {err}"));
  serde_json::from_str::<serde_json::Value>(&manifest)
    .unwrap_or_else(|err| panic!("failed to parse {COMMAND_MANIFEST}: {err}"));

  let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
  if target_os == "macos" {
    println!("cargo:rerun-if-changed=native/macos/tap_bridge.m");
    println!("cargo:rerun-if-changed=native/macos/visual_capture_bridge.m");
    cc::Build::new()
      .file("native/macos/tap_bridge.m")
      .file("native/macos/visual_capture_bridge.m")
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
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=WebKit");
    println!("cargo:rustc-link-lib=framework=ImageIO");
    println!("cargo:rustc-link-lib=framework=CoreGraphics");
    println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=CoreImage");
    println!("cargo:rustc-link-lib=framework=CoreMedia");
    println!("cargo:rustc-link-lib=framework=CoreVideo");
  }
  tauri_build::build()
}

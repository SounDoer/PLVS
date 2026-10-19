fn main() {
  const CONFIG: &str = "../tauri.conf.json";
  println!("cargo:rerun-if-changed={CONFIG}");
  let config: serde_json::Value = serde_json::from_str(
    &std::fs::read_to_string(CONFIG)
      .unwrap_or_else(|error| panic!("failed to read {CONFIG}: {error}")),
  )
  .unwrap_or_else(|error| panic!("failed to parse {CONFIG}: {error}"));
  let public_key = config["plugins"]["updater"]["pubkey"]
    .as_str()
    .unwrap_or_else(|| panic!("{CONFIG} has no updater public key"));
  println!("cargo:rustc-env=PLVS_UPDATE_PUBLIC_KEY={public_key}");
}

fn main() {
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

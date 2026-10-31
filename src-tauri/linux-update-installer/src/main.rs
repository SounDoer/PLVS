//! Minimal privileged installer for signed stable PLVS Debian packages.
//!
//! The GUI and its update worker remain unprivileged. This binary treats both the ticket and the
//! cached package as attacker-controlled, authenticates the exact bytes it copies into a root-only
//! directory, and gives APT no permission to download or remove packages.
#[cfg(target_os = "linux")]
mod installer {
  use base64::{engine::general_purpose::STANDARD, Engine};
  use minisign_verify::{PublicKey, Signature};
  use semver::Version;
  use serde::Deserialize;
  use sha2::{Digest, Sha256};
  use std::{
    ffi::OsString,
    fs,
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    process::{Command, Output},
  };

  const PUBLIC_KEY: &str = env!("PLVS_UPDATE_PUBLIC_KEY");
  const PACKAGE: &str = "plvs";
  const ARCHITECTURE: &str = "amd64";
  const MAX_PACKAGE_BYTES: u64 = 256 * 1024 * 1024;

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase", deny_unknown_fields)]
  struct Ticket {
    package_path: PathBuf,
    package_sha256: String,
    version: String,
    signature: String,
  }

  pub fn run() {
    if unsafe { libc_geteuid() } != 0 {
      fail(2, "The PLVS update installer must be authorized by Polkit.");
    }
    let ticket_path = std::env::args_os().nth(1).unwrap_or_else(|| {
      fail(2, "Usage: plvs-update-installer <ticket.json>");
    });
    if std::env::args_os().nth(2).is_some() {
      fail(2, "The PLVS update installer accepts one ticket.");
    }
    if let Err(error) = install(Path::new(&ticket_path)) {
      fail(10, &error);
    }
  }

  // Avoid pulling a general-purpose libc binding into the privileged helper.
  extern "C" {
    fn geteuid() -> u32;
  }

  unsafe fn libc_geteuid() -> u32 {
    // SAFETY: geteuid has no arguments and no memory safety preconditions.
    unsafe { geteuid() }
  }

  fn fail(code: i32, message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(code)
  }

  fn install(ticket_path: &Path) -> Result<(), String> {
    let ticket: Ticket = serde_json::from_slice(
      &fs::read(ticket_path).map_err(|e| format!("Cannot read the update ticket: {e}"))?,
    )
    .map_err(|e| format!("Invalid update ticket: {e}"))?;
    validate_ticket(&ticket)?;

    // Read once. Everything below authenticates and installs this same in-memory byte sequence.
    let package = read_package(&ticket.package_path)?;
    verify_package(&ticket, &package)?;

    let installed_status = installed_field("Status")?;
    let installed_architecture = installed_field("Architecture")?;
    if installed_status != "install ok installed" || installed_architecture != ARCHITECTURE {
      return Err(format!(
        "The installed PLVS package is not a complete {ARCHITECTURE} installation (status: {installed_status}, architecture: {installed_architecture})."
      ));
    }
    let installed = installed_field("Version")?;
    if installed != env!("CARGO_PKG_VERSION") {
      return Err(format!(
      "The installed PLVS version changed (expected {}, found {installed}). Check for updates again.",
      env!("CARGO_PKG_VERSION")
    ));
    }
    let current =
      Version::parse(&installed).map_err(|e| format!("Invalid installed version: {e}"))?;
    let target =
      Version::parse(&ticket.version).map_err(|e| format!("Invalid update version: {e}"))?;
    if target <= current {
      return Err("The signed package is not newer than the installed PLVS version.".into());
    }

    let root_dir = tempfile::Builder::new()
      .prefix("plvs-update-")
      .tempdir_in("/var/tmp")
      .map_err(|e| format!("Cannot create the protected installer directory: {e}"))?;
    let root_package = root_dir.path().join("plvs.deb");
    let mut output = fs::OpenOptions::new()
      .create_new(true)
      .write(true)
      .mode(0o600)
      .open(&root_package)
      .map_err(|e| format!("Cannot stage the protected package: {e}"))?;
    output
      .write_all(&package)
      .and_then(|_| output.sync_all())
      .map_err(|e| format!("Cannot stage the protected package: {e}"))?;

    validate_deb(&root_package, &ticket.version)?;
    let sources = root_dir.path().join("sources.list");
    let source_parts = root_dir.path().join("sources.list.d");
    fs::write(&sources, b"")
      .and_then(|_| fs::create_dir(&source_parts))
      .map_err(|e| format!("Cannot prepare offline APT: {e}"))?;
    let result = Command::new("/usr/bin/apt-get")
      .args(offline_apt_args(&sources, &source_parts, &root_package))
      .output()
      .map_err(|e| format!("Cannot start APT: {e}"))?;
    require_success("APT could not install the update", result)?;

    let status = installed_field("Status")?;
    let version = installed_field("Version")?;
    if status != "install ok installed" || version != ticket.version {
      return Err(format!(
        "APT returned without a complete PLVS installation (status: {status}, version: {version})."
      ));
    }
    Ok(())
  }

  /// Offline APT: with an empty source list it can resolve dependencies only from installed
  /// packages and has nothing to download. `--no-download` cannot be used for this: apt 2.8
  /// (Ubuntu 24.04) rejects every local deb under it ("Pathname to install is not absolute").
  fn offline_apt_args(sources: &Path, source_parts: &Path, package: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = ["-y", "--no-remove", "--only-upgrade", "--reinstall"]
      .into_iter()
      .map(OsString::from)
      .collect();
    for (key, value) in [
      ("Dir::Etc::SourceList", sources),
      ("Dir::Etc::SourceParts", source_parts),
    ] {
      args.push("-o".into());
      let mut option = OsString::from(format!("{key}="));
      option.push(value);
      args.push(option);
    }
    args.push("install".into());
    args.push(package.into());
    args
  }

  fn validate_ticket(ticket: &Ticket) -> Result<(), String> {
    if ticket.package_sha256.len() != 64
      || !ticket
        .package_sha256
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit())
    {
      return Err("Invalid package digest in the update ticket.".into());
    }
    if ticket.version.len() > 64 {
      return Err("Invalid update version in the update ticket.".into());
    }
    Ok(())
  }

  fn read_package(path: &Path) -> Result<Vec<u8>, String> {
    let file =
      fs::File::open(path).map_err(|e| format!("Cannot open the staged update package: {e}"))?;
    if !file
      .metadata()
      .map_err(|e| format!("Cannot inspect the staged update package: {e}"))?
      .is_file()
    {
      return Err("The staged update package is not a regular file.".into());
    }
    let mut bytes = Vec::new();
    file
      .take(MAX_PACKAGE_BYTES + 1)
      .read_to_end(&mut bytes)
      .map_err(|e| format!("Cannot read the staged update package: {e}"))?;
    if bytes.len() as u64 > MAX_PACKAGE_BYTES {
      return Err("The staged update package is unexpectedly large.".into());
    }
    Ok(bytes)
  }

  fn verify_package(ticket: &Ticket, bytes: &[u8]) -> Result<(), String> {
    verify_package_with_key(ticket, bytes, PUBLIC_KEY)
  }

  fn verify_package_with_key(
    ticket: &Ticket,
    bytes: &[u8],
    encoded_public_key: &str,
  ) -> Result<(), String> {
    let digest = Sha256::digest(bytes)
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect::<String>();
    if !digest.eq_ignore_ascii_case(&ticket.package_sha256) {
      return Err("The staged update package changed after it was downloaded.".into());
    }
    let public_key = decode_text(encoded_public_key)
      .and_then(|value| PublicKey::decode(&value).map_err(|e| e.to_string()))?;
    let signature = decode_text(&ticket.signature)
      .and_then(|value| Signature::decode(&value).map_err(|e| e.to_string()))?;
    public_key
      .verify(bytes, &signature, true)
      .map_err(|e| format!("The update signature is invalid: {e}"))?;
    let signed_version = signature
      .trusted_comment()
      .split('\t')
      .find_map(|field| field.strip_prefix("version:"))
      .ok_or("The update signature does not contain a version.")?;
    let signed = Version::parse(signed_version.trim_start_matches('v'));
    let announced = Version::parse(ticket.version.trim_start_matches('v'));
    let matches = match (signed, announced) {
      (Ok(signed), Ok(announced)) => signed == announced,
      _ => signed_version == ticket.version,
    };
    if !matches {
      return Err("The signed package version does not match the update ticket.".into());
    }
    Ok(())
  }

  fn decode_text(value: &str) -> Result<String, String> {
    let bytes = STANDARD.decode(value).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
  }

  fn validate_deb(path: &Path, version: &str) -> Result<(), String> {
    for (field, expected) in [
      ("Package", PACKAGE),
      ("Architecture", ARCHITECTURE),
      ("Version", version),
    ] {
      let actual = deb_field(path, field)?;
      if actual != expected {
        return Err(format!(
        "The signed Debian package has unexpected {field} metadata (expected {expected}, found {actual})."
      ));
      }
    }
    Ok(())
  }

  fn deb_field(path: &Path, field: &str) -> Result<String, String> {
    command_text(
      Command::new("/usr/bin/dpkg-deb")
        .arg("--field")
        .arg(path)
        .arg(field),
      "Cannot inspect the Debian package",
    )
  }

  fn installed_field(field: &str) -> Result<String, String> {
    command_text(
      Command::new("/usr/bin/dpkg-query")
        .args(["--show", "--showformat"])
        .arg(format!("${{{field}}}"))
        .arg(PACKAGE),
      "Cannot inspect the installed PLVS package",
    )
  }

  fn command_text(command: &mut Command, context: &str) -> Result<String, String> {
    let output = command.output().map_err(|e| format!("{context}: {e}"))?;
    require_success(context, output).map(|bytes| String::from_utf8_lossy(&bytes).trim().to_owned())
  }

  fn require_success(context: &str, output: Output) -> Result<Vec<u8>, String> {
    if output.status.success() {
      return Ok(output.stdout);
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    let detail = detail.trim().chars().take(1000).collect::<String>();
    Err(if detail.is_empty() {
      format!("{context} (exit status {}).", output.status)
    } else {
      format!("{context}: {detail}")
    })
  }

  #[cfg(test)]
  mod tests {
    use super::*;

    #[test]
    fn ticket_rejects_non_digest_ids() {
      let ticket = Ticket {
        package_path: "/tmp/package".into(),
        package_sha256: "../package".into(),
        version: "1.2.3".into(),
        signature: "anything".into(),
      };
      assert!(validate_ticket(&ticket).is_err());
    }

    #[test]
    fn apt_installs_offline_from_an_empty_source_list() {
      let args = offline_apt_args(
        Path::new("/var/tmp/x/sources.list"),
        Path::new("/var/tmp/x/sources.list.d"),
        Path::new("/var/tmp/x/plvs.deb"),
      );
      assert_eq!(
        args,
        [
          "-y",
          "--no-remove",
          "--only-upgrade",
          "--reinstall",
          "-o",
          "Dir::Etc::SourceList=/var/tmp/x/sources.list",
          "-o",
          "Dir::Etc::SourceParts=/var/tmp/x/sources.list.d",
          "install",
          "/var/tmp/x/plvs.deb",
        ]
        .map(OsString::from)
      );
    }

    #[test]
    fn package_reader_rejects_non_files() {
      let directory = tempfile::tempdir().unwrap();
      assert!(read_package(directory.path()).is_err());
    }

    #[test]
    fn authenticated_bytes_are_bound_to_the_announced_version() {
      let bytes =
        include_bytes!("../../vendor/tauri-plugin-updater/tests/fixtures/cached-package.bin");
      let mut ticket = Ticket {
        package_path: "/tmp/package".into(),
        package_sha256: Sha256::digest(bytes)
          .iter()
          .map(|byte| format!("{byte:02x}"))
          .collect(),
        version: "0.22.0".into(),
        signature: include_str!(
          "../../vendor/tauri-plugin-updater/tests/fixtures/cached-package.sig"
        )
        .trim()
        .into(),
      };
      let public_key =
        include_str!("../../vendor/tauri-plugin-updater/tests/fixtures/cached-package.pub").trim();

      verify_package_with_key(&ticket, bytes, public_key).unwrap();
      let mut damaged = bytes.to_vec();
      damaged[0] ^= 1;
      assert!(verify_package_with_key(&ticket, &damaged, public_key).is_err());
      // A download response can replace both the bytes and their advertised digest. The
      // signature must still reject the changed package after the digest check succeeds.
      ticket.package_sha256 = Sha256::digest(&damaged)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
      assert!(verify_package_with_key(&ticket, &damaged, public_key)
        .unwrap_err()
        .starts_with("The update signature is invalid:"));
      ticket.package_sha256 = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
      ticket.version = "0.23.0".into();
      assert!(verify_package_with_key(&ticket, bytes, public_key).is_err());
    }
  }
}

#[cfg(target_os = "linux")]
fn main() {
  installer::run();
}

#[cfg(not(target_os = "linux"))]
fn main() {
  eprintln!("The PLVS update installer is available only on Linux.");
  std::process::exit(2);
}

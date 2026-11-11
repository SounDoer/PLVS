use std::fs::File;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::types::FileSourceVersion;

/// Offline I/O only. No audio callback or Live capture path calls this helper.
/// Reads the whole file, checking `should_stop` between 64 KiB reads so a stop request never
/// waits for a large or slow source to be read to the end. `Ok(None)` means cancelled.
pub fn identify_source_until(
  path: &Path,
  should_stop: impl Fn() -> bool,
) -> Result<Option<FileSourceVersion>, String> {
  let canonical = path
    .canonicalize()
    .map_err(|error| format!("Source file unavailable: {error}"))?;
  let mut file =
    File::open(&canonical).map_err(|error| format!("Source file unavailable: {error}"))?;
  let before = file.metadata().map_err(|error| error.to_string())?;
  let mut hash = Sha256::new();
  let mut buffer = [0_u8; 64 * 1024];
  loop {
    if should_stop() {
      return Ok(None);
    }
    let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
    if count == 0 {
      break;
    }
    hash.update(&buffer[..count]);
  }
  let after = file.metadata().map_err(|error| error.to_string())?;
  if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
    return Err("Source file changed while its identity was being read".into());
  }
  Ok(Some(FileSourceVersion {
    canonical_path: canonical.to_string_lossy().into_owned(),
    byte_length: after.len(),
    sha256: hash
      .finalize()
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect(),
  }))
}

pub fn verify_source(path: &str, expected: Option<&FileSourceVersion>) -> Result<(), String> {
  verify_source_until(path, expected, || false).map(|_| ())
}

/// `Ok(false)` when `should_stop` cancelled the read before the comparison.
pub fn verify_source_until(
  path: &str,
  expected: Option<&FileSourceVersion>,
  should_stop: impl Fn() -> bool,
) -> Result<bool, String> {
  let Some(expected) = expected else {
    return Ok(true);
  };
  match identify_source_until(Path::new(path), should_stop)? {
    None => Ok(false),
    Some(actual) if actual == *expected => Ok(true),
    Some(_) => Err("Source file changed; import the new version to analyze it".into()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn identify_source(path: &Path) -> Result<FileSourceVersion, String> {
    Ok(identify_source_until(path, || false)?.unwrap())
  }
  #[test]
  fn detects_same_length_replacement_with_restored_name() {
    let path = std::env::temp_dir().join(format!("plvs-source-{}.tmp", std::process::id()));
    std::fs::write(&path, b"aaaa").unwrap();
    let old = identify_source(&path).unwrap();
    std::fs::write(&path, b"bbbb").unwrap();
    assert!(verify_source(path.to_str().unwrap(), Some(&old)).is_err());
    std::fs::remove_file(path).unwrap();
  }

  #[test]
  fn a_stop_request_cancels_the_read_instead_of_finishing_it() {
    let path = std::env::temp_dir().join(format!("plvs-source-stop-{}.tmp", std::process::id()));
    // Several read chunks, so a stop observed after the first read ends the loop early.
    std::fs::write(&path, vec![7_u8; 256 * 1024]).unwrap();
    let expected = identify_source(&path).unwrap();
    let reads = std::cell::Cell::new(0);
    let stop_after_first = || {
      reads.set(reads.get() + 1);
      reads.get() > 1
    };
    assert_eq!(
      identify_source_until(&path, stop_after_first).unwrap(),
      None
    );
    assert_eq!(reads.get(), 2);
    assert_eq!(
      verify_source_until(path.to_str().unwrap(), Some(&expected), || true),
      Ok(false)
    );
    assert_eq!(
      verify_source_until(path.to_str().unwrap(), Some(&expected), || false),
      Ok(true)
    );
    std::fs::remove_file(path).unwrap();
  }
}

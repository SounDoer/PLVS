use std::fs::File;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::types::FileSourceVersion;

/// Offline I/O only. No audio callback or Live capture path calls this helper.
pub fn identify_source(path: &Path) -> Result<FileSourceVersion, String> {
  let canonical = path
    .canonicalize()
    .map_err(|error| format!("Source file unavailable: {error}"))?;
  let mut file =
    File::open(&canonical).map_err(|error| format!("Source file unavailable: {error}"))?;
  let before = file.metadata().map_err(|error| error.to_string())?;
  let mut hash = Sha256::new();
  let mut buffer = [0_u8; 64 * 1024];
  loop {
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
  Ok(FileSourceVersion {
    canonical_path: canonical.to_string_lossy().into_owned(),
    byte_length: after.len(),
    sha256: hash
      .finalize()
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect(),
  })
}

pub fn verify_source(path: &str, expected: Option<&FileSourceVersion>) -> Result<(), String> {
  if let Some(expected) = expected {
    if identify_source(Path::new(path))? != *expected {
      return Err("Source file changed; import the new version to analyze it".into());
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn detects_same_length_replacement_with_restored_name() {
    let path = std::env::temp_dir().join(format!("plvs-source-{}.tmp", std::process::id()));
    std::fs::write(&path, b"aaaa").unwrap();
    let old = identify_source(&path).unwrap();
    std::fs::write(&path, b"bbbb").unwrap();
    assert!(verify_source(path.to_str().unwrap(), Some(&old)).is_err());
    std::fs::remove_file(path).unwrap();
  }
}

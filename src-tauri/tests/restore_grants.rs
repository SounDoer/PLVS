use app_lib::coordinator::{DiskRestoreGrantAuthority, RestoreGrantAuthority};

#[test]
fn internal_restore_grants_are_short_lived_workspace_bound_and_single_use() {
  let authority = RestoreGrantAuthority::new();
  let grant = authority
    .issue("workspace-spotify", 1_000)
    .expect("issue restore grant");

  assert!(authority
    .claim("workspace-vlc", grant.nonce(), 1_001)
    .is_err());
  authority
    .claim("workspace-spotify", grant.nonce(), 1_001)
    .expect("claim matching restore grant");
  assert!(authority
    .claim("workspace-spotify", grant.nonce(), 1_002)
    .is_err());

  let expired = authority.issue("workspace-vlc", 2_000).unwrap();
  assert!(authority
    .claim(
      "workspace-vlc",
      expired.nonce(),
      expired.expires_at_unix_ms() + 1
    )
    .is_err());
  assert!(authority.claim("workspace-vlc", "forged", 2_001).is_err());
}

#[test]
fn restore_grants_can_be_issued_and_claimed_across_process_boundaries() {
  let root = std::env::temp_dir().join(format!("plvs-disk-restore-grants-{}", std::process::id()));
  let issuer = DiskRestoreGrantAuthority::open(&root).unwrap();
  let claimant = DiskRestoreGrantAuthority::open(&root).unwrap();
  let grant = issuer.issue("workspace-spotify", 10_000).unwrap();

  claimant
    .claim("workspace-spotify", grant.nonce(), 10_001)
    .unwrap();
  assert!(issuer
    .claim("workspace-spotify", grant.nonce(), 10_002)
    .is_err());

  let _ = std::fs::remove_dir_all(root);
}

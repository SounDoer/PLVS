use app_lib::coordinator::RestoreGrantAuthority;

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

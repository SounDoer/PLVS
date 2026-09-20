/**
 * The file names a release publishes, in one place. `release.yml` produces them, the GitHub Release
 * notes name them, and public documents may show them with `<version>` in place of the version;
 * tests hold all three to this function.
 *
 * @param {string} version Semver without the leading `v`, e.g. `0.16.0`.
 */
export function releaseAssetNames(version) {
  return {
    windowsInstaller: `PLVS_${version}_x64-setup.exe`,
    windowsPortable: `PLVS-v${version}-x64-portable.zip`,
    macosDmg: `PLVS-v${version}-aarch64.dmg`,
    macosUpdater: "PLVS.app.tar.gz",
    updaterManifest: "latest.json",
  };
}

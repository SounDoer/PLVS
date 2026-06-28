# Third-Party Notices

PLVS itself is licensed under the MIT License (see `LICENSE`). It additionally distributes the
following third-party component.

## FFmpeg

PLVS bundles the **FFmpeg** `ffmpeg` and `ffprobe` programs as separate executables (sidecars) to
decode audio tracks from media files in File mode.

- **License:** GNU Lesser General Public License, version 2.1 (LGPL-2.1).
  The bundled binaries are built with `--disable-gpl --disable-nonfree`, so only LGPL-licensed
  components are included. A copy of the LGPL-2.1 license text is available at
  <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>.
- **Source:** Built from the FFmpeg `n7.1` release. Corresponding source is available from the
  FFmpeg project at <https://ffmpeg.org/download.html> and <https://git.ffmpeg.org/ffmpeg.git>
  (tag `n7.1`). The exact `configure` options used are recorded in `docs/ffmpeg-sidecar-build.md`.
- **Replaceability:** FFmpeg is invoked as a standalone executable, not linked into PLVS. Users may
  replace the bundled `ffmpeg`/`ffprobe` binaries with their own compatible builds, satisfying the
  LGPL-2.1 relinking provision.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

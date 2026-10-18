# Agent Control cross-platform completion implementation plan

1. Add an acceptance catalogue covering all 113 public command IDs exactly once, with tests for
   duplicate, missing, invalid, and platform-specific dispositions.
2. Add a layered real-desktop Agent Control acceptance runner that:
   - invokes the existing smoke first;
   - exercises offline schema and completion;
   - checks common running-app query families;
   - performs reversible Settings/View and semantic UI round trips;
   - analyzes and removes a generated bounded WAV fixture;
   - verifies Linux Dock refusal or records the native Dock producer requirement;
   - preserves the shared `agent-control` evidence shape and fails on cleanup errors.
3. Add unit tests for runner argument parsing, command coverage, capability branching, artifact
   verification, and failure/cleanup evidence.
4. Add an authoritative Settings surface control catalogue. Derive Settings Control public fields
   from it, bind rendered Settings controls to catalogue IDs, and fail tests for missing or unknown
   ownership.
5. Update Agent Control implementation and user documentation with the new acceptance workflow and
   explicit platform matrix.
6. Run repository checks, then run the new acceptance workflow against a real visible Linux dev
   window. Do not mark a platform feature passed unless its real artifact or refusal contract was
   observed.
7. Evaluate Linux measured-source recording using the existing shared audio timeline. Implement it
   only if FFmpeg can accept bounded raw video and PCM inputs without weakening process isolation,
   cleanup, or artifact publication. Keep system-pointer capture unsupported under Wayland.

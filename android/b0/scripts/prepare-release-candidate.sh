#!/usr/bin/env bash
set -euo pipefail

# Builds an unsigned candidate only. Does not sign, install, contact Host, or run UI.
android_root="$(cd "$(dirname "$0")/../.." && pwd)"
[[ -z "$(git -C "$android_root" status --porcelain --untracked-files=all)" ]] || {
  echo 'Dirty tracked or untracked source; commit or preserve changes before building a source-bound candidate' >&2
  exit 1
}
source_sha="$(git -C "$android_root" rev-parse HEAD)"
candidate_dir="${JARVIS_B0_CANDIDATE_DIR:?Set a new private candidate output directory}"
[[ ! -e "$candidate_dir" ]] || { echo 'Candidate directory already exists; choose a fresh directory' >&2; exit 1; }
mkdir -m 700 -p "$candidate_dir"
cd "$android_root"
./gradlew --offline --rerun-tasks :b0:assembleRelease :b0:lintRelease > "$candidate_dir/build.log" 2>&1
cp b0/build/outputs/apk/release/b0-release-unsigned.apk "$candidate_dir/b0-v6-shell-candidate-unsigned.apk"
chmod 600 "$candidate_dir/"*
"${ANDROID_HOME:?Set ANDROID_HOME}/build-tools/35.0.0/aapt" dump badging \
  "$candidate_dir/b0-v6-shell-candidate-unsigned.apk" > "$candidate_dir/badging.txt"
sed -n '1p' "$candidate_dir/badging.txt" > "$candidate_dir/package.txt"
printf '%s\n' "$source_sha" > "$candidate_dir/source.txt"
shasum -a 256 "$candidate_dir/b0-v6-shell-candidate-unsigned.apk" > "$candidate_dir/sha256.txt"
printf '%s\n' 'Unsigned shell candidate built; not an installable signed final release.'
cat "$candidate_dir/package.txt" "$candidate_dir/sha256.txt"

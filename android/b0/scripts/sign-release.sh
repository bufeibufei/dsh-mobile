#!/usr/bin/env bash
set -euo pipefail

# Persistent local PKCS#12 material; keep both files outside Git and in a secure backup.
repo_android="$(cd "$(dirname "$0")/../.." && pwd)"
release_dir="${JARVIS_B0_RELEASE_DIR:?Set a private release output directory}"
key="${JARVIS_B0_KEYSTORE:?Set the private keystore path}"
password_file="${JARVIS_B0_PASSWORD_FILE:?Set the private password file path}"
source_apk="$repo_android/b0/build/outputs/apk/release/b0-release-unsigned.apk"
gradle_file="$repo_android/b0/build.gradle.kts"
build_tools="${ANDROID_HOME:?Set ANDROID_HOME}/build-tools/35.0.0"
expected_certificate="${JARVIS_B0_CERT_SHA256:?Set the expected signing certificate SHA-256}"

# The expected identity is the one this checkout builds; each key must appear exactly once.
gradle_value() {
  local matches
  matches="$(sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*$2[[:space:]]*$/\1/p" "$gradle_file")"
  [[ -n "$matches" && "$(printf '%s\n' "$matches" | wc -l | tr -d ' ')" == 1 ]] || {
    echo "Cannot read a single $1 from $gradle_file" >&2; exit 1;
  }
  printf '%s' "$matches"
}
[[ -f "$gradle_file" ]] || { echo "Missing $gradle_file" >&2; exit 1; }
application_id="$(gradle_value applicationId '"([A-Za-z0-9_.]+)"')"
version_code="$(gradle_value versionCode '([0-9]+)')"
version_name="$(gradle_value versionName '"([A-Za-z0-9._-]+)"')"
output_apk="$release_dir/jarvis-b0-$version_name-code$version_code-candidate.apk"

[[ -f "$key" && -f "$password_file" && -f "$source_apk" ]] || { echo 'Missing private key/password or release build' >&2; exit 1; }
package_line="$("$build_tools/aapt" dump badging "$source_apk" | head -n 1)"
[[ "$package_line" == *"name='$application_id'"* && "$package_line" == *"versionCode='$version_code'"* \
  && "$package_line" == *"versionName='$version_name'"* ]] || {
  echo "Unsigned APK is not the expected $application_id code $version_code ($version_name) package; rebuild before signing" >&2; exit 1;
}
[[ ! -e "$output_apk" ]] || { echo 'Candidate output already exists; preserve it and choose a fresh private release directory' >&2; exit 1; }
mkdir -p "$release_dir"
chmod 700 "$release_dir"
aligned="$(mktemp "$release_dir/.aligned.XXXXXX")"
signed="$(mktemp "$release_dir/.signed.XXXXXX")"
trap 'rm -f "$aligned" "$signed"' EXIT
"$build_tools/zipalign" -f -p 4 "$source_apk" "$aligned"
"$build_tools/apksigner" sign --ks "$key" --ks-key-alias "${JARVIS_B0_KEY_ALIAS:?Set the key alias}" \
  --ks-pass "file:$password_file" --out "$signed" "$aligned"
"$build_tools/zipalign" -c -p 4 "$signed"
verification="$("$build_tools/apksigner" verify --verbose --print-certs "$signed")"
[[ "$verification" == *"Verified using v2 scheme (APK Signature Scheme v2): true"* \
  && "$verification" == *"Verified using v3 scheme (APK Signature Scheme v3): true"* \
  && "$verification" == *"Signer #1 certificate SHA-256 digest: $expected_certificate"* ]] || {
  echo 'Signature/certificate verification failed; candidate not published' >&2; exit 1;
}
chmod 600 "$signed"
mv -f "$signed" "$output_apk"
printf '%s\n' "B0 code $version_code ($version_name) candidate package, alignment, v2/v3 signature and existing certificate verified."
shasum -a 256 "$output_apk"

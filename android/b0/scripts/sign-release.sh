#!/usr/bin/env bash
set -euo pipefail

# Persistent local PKCS#12 material; keep both files outside Git and in a secure backup.
repo_android="$(cd "$(dirname "$0")/../.." && pwd)"
release_dir="${JARVIS_B0_RELEASE_DIR:?Set a private release output directory}"
key="${JARVIS_B0_KEYSTORE:?Set the private keystore path}"
password_file="${JARVIS_B0_PASSWORD_FILE:?Set the private password file path}"
source_apk="$repo_android/b0/build/outputs/apk/release/b0-release-unsigned.apk"
output_apk="$release_dir/jarvis-b0-0.10.0-life-candidate.apk"
build_tools="${ANDROID_HOME:?Set ANDROID_HOME}/build-tools/35.0.0"
expected_certificate="${JARVIS_B0_CERT_SHA256:?Set the expected signing certificate SHA-256}"

[[ -f "$key" && -f "$password_file" && -f "$source_apk" ]] || { echo 'Missing private key/password or release build' >&2; exit 1; }
package_line="$("$build_tools/aapt" dump badging "$source_apk" | head -n 1)"
[[ "$package_line" == *"name='com.jarvis.life.b0'"* && "$package_line" == *"versionCode='11'"* && "$package_line" == *"versionName='0.10.0-b0-life'"* ]] || {
  echo 'Unsigned APK is not the expected B0 code11 package; rebuild before signing' >&2; exit 1;
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
printf '%s\n' 'B0 code11 candidate package, alignment, v2/v3 signature and existing certificate verified.'
shasum -a 256 "$output_apk"

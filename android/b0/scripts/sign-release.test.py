"""Version checks of sign-release.sh with fake build tools; does not sign a real APK."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

script = Path(__file__).with_name('sign-release.sh')
real_gradle = Path(__file__).parents[1] / 'build.gradle.kts'
certificate = 'ab' * 32

# Fake aapt reports $TEST_BADGING; zipalign/apksigner copy files and log each signing call.
FAKE_TOOLS = {
    'aapt': '#!/bin/sh\nprintf "%s\\n" "$TEST_BADGING"\n',
    'zipalign': '#!/bin/sh\n[ "$1" = "-c" ] && exit 0\ncp "$4" "$5"\n',
    'apksigner': '''#!/bin/sh
if [ "$1" = sign ]; then
  echo signed >> "$TEST_SIGN_LOG"
  while [ $# -gt 1 ]; do [ "$1" = --out ] && out="$2"; shift; done
  cp "$1" "$out"
else
  printf '%s\\n' 'Verified using v2 scheme (APK Signature Scheme v2): true' \\
    'Verified using v3 scheme (APK Signature Scheme v3): true' \\
    "Signer #1 certificate SHA-256 digest: $TEST_CERT"
fi
''',
}


def badging(code, name, package='com.jarvis.life.b0'):
    return f"package: name='{package}' versionCode='{code}' versionName='{name}' platformBuildVersionName='15'"


def run_case(temp, gradle_text, apk_badging, label):
    root = Path(temp) / label
    scripts = root / 'android/b0/scripts'
    scripts.mkdir(parents=True)
    shutil.copy(script, scripts / script.name)
    (root / 'android/b0/build.gradle.kts').write_text(gradle_text)
    apk = root / 'android/b0/build/outputs/apk/release/b0-release-unsigned.apk'
    apk.parent.mkdir(parents=True)
    apk.write_bytes(b'unsigned fixture')
    tools = root / 'sdk/build-tools/35.0.0'
    tools.mkdir(parents=True)
    for name, body in FAKE_TOOLS.items():
        (tools / name).write_text(body)
        (tools / name).chmod(0o755)
    private = root / 'private'
    private.mkdir()
    (private / 'key.p12').write_bytes(b'fixture key')
    (private / 'password').write_text('fixture password\n')
    release = root / 'release'
    log = root / 'sign.log'
    env = dict(os.environ, ANDROID_HOME=str(root / 'sdk'), JARVIS_B0_RELEASE_DIR=str(release),
               JARVIS_B0_KEYSTORE=str(private / 'key.p12'), JARVIS_B0_PASSWORD_FILE=str(private / 'password'),
               JARVIS_B0_KEY_ALIAS='fixture', JARVIS_B0_CERT_SHA256=certificate,
               TEST_BADGING=apk_badging, TEST_SIGN_LOG=str(log), TEST_CERT=certificate)
    run = subprocess.run(['bash', str(scripts / script.name)], env=env, capture_output=True, text=True)
    outputs = sorted(p.name for p in release.iterdir()) if release.exists() else []
    return run, outputs, log.exists()


current = real_gradle.read_text()
code = next(line.split('=')[1].strip() for line in current.splitlines() if line.strip().startswith('versionCode'))
name = next(line.split('"')[1] for line in current.splitlines() if line.strip().startswith('versionName'))
results = {}
with tempfile.TemporaryDirectory(prefix='jarvis-sign-guard-') as temp:
    run, outputs, signed = run_case(temp, current, badging(code, name), 'matching')
    assert run.returncode == 0, run.stderr
    assert outputs == [f'jarvis-b0-{name}-code{code}-candidate.apk'] and signed
    assert f'B0 code {code} ({name}) candidate' in run.stdout
    results['matching'] = dict(exitCode=run.returncode, output=outputs[0])

    # An APK built from an older checkout must not be signed as this version.
    old = str(int(code) - 1)
    run, outputs, signed = run_case(temp, current, badging(old, name), 'older-apk')
    assert run.returncode == 1 and f'code {code} ({name})' in run.stderr
    assert outputs == [] and not signed
    results['older-apk'] = dict(exitCode=run.returncode, signed=signed)

    run, outputs, signed = run_case(temp, current, badging(code, name, 'com.example.other'), 'other-package')
    assert run.returncode == 1 and not signed and outputs == []
    results['other-package'] = dict(exitCode=run.returncode, signed=signed)

    missing = '\n'.join(line for line in current.splitlines() if 'versionCode' not in line)
    run, outputs, signed = run_case(temp, missing, badging(code, name), 'missing-code')
    assert run.returncode == 1 and 'Cannot read a single versionCode' in run.stderr and not signed
    results['missing-code'] = dict(exitCode=run.returncode, signed=signed)

    doubled = current.replace(f'versionCode = {code}', f'versionCode = {code}\n        versionCode = {old}')
    assert doubled != current
    run, outputs, signed = run_case(temp, doubled, badging(code, name), 'ambiguous-code')
    assert run.returncode == 1 and 'Cannot read a single versionCode' in run.stderr and not signed
    results['ambiguous-code'] = dict(exitCode=run.returncode, signed=signed)
print(json.dumps(dict(layer='fake build tools; real build.gradle.kts parsed', expected=f'{code} / {name}', cases=results)))

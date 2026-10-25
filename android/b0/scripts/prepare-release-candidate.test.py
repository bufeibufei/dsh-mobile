"""Dirty rejection/clean entry only, with fake Gradle; does not build/install APK."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

script = Path(__file__).with_name('prepare-release-candidate.sh')
results = {}
with tempfile.TemporaryDirectory(prefix='jarvis-candidate-guard-') as temp:
    root = Path(temp) / 'repo'
    scripts = root / 'android/b0/scripts'
    scripts.mkdir(parents=True)
    shutil.copy(script, scripts / script.name)
    gradle = root / 'android/gradlew'
    gradle.write_text('#!/bin/sh\ntouch "$TEST_BUILD_MARKER"\nexit 47\n')
    gradle.chmod(0o755)
    for args in [('init',), ('add', '.'), ('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')]:
        subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
    marker = Path(temp) / 'entered-gradle'
    output = Path(temp) / 'candidate'
    env = dict(os.environ, JARVIS_B0_CANDIDATE_DIR=str(output), TEST_BUILD_MARKER=str(marker))
    for case in ['tracked', 'untracked', 'clean']:
        extra = root / 'android/untracked.kt'
        if case == 'tracked':
            gradle.write_text(gradle.read_text() + '# changed\n')
        if case == 'untracked':
            subprocess.run(['git', 'restore', '.'], cwd=root, check=True)
            extra.write_text('// untracked source\n')
        if case == 'clean':
            extra.unlink()
        run = subprocess.run(['bash', str(scripts / script.name)], env=env, capture_output=True, text=True)
        if case == 'clean':
            assert run.returncode == 47 and marker.exists() and output.exists()
        else:
            assert run.returncode == 1 and 'Dirty tracked or untracked source' in run.stderr
            assert not marker.exists() and not output.exists()
        results[case] = dict(exitCode=run.returncode, buildEntered=marker.exists(), outputCreated=output.exists())
print(json.dumps(dict(layer='fake Gradle mechanism only; clean exits47 deliberately', cases=results)))

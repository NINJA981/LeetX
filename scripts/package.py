"""Build store-ready Chrome and Firefox packages into dist/.

Usage:
    python scripts/package.py            # package the current version
    python scripts/package.py patch      # bump patch (or minor / major), then package
    python scripts/package.py --copy-to-downloads
    python scripts/package.py --out some/dir
"""
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'

# Only what the extension needs at runtime ships in the zip.
RUNTIME_DIRS = ['popup', 'styles', 'assets']
RUNTIME_SCRIPTS = ['background.js', 'content.js', 'core.js', 'firebase.js', 'github.js', 'leetcode.js', 'state.js']
EXCLUDED_SUFFIXES = {'.map', '.md', '.py', '.pyc'}


def bump(version: str, part: str) -> str:
    major, minor, patch = (int(p) for p in version.split('.'))
    if part == 'major':
        return f'{major + 1}.0.0'
    if part == 'minor':
        return f'{major}.{minor + 1}.0'
    return f'{major}.{minor}.{patch + 1}'


def runtime_files():
    for name in RUNTIME_SCRIPTS:
        path = ROOT / 'scripts' / name
        if not path.is_file():
            raise SystemExit(f'missing runtime script: {path}')
        yield path
    for folder in RUNTIME_DIRS:
        for path in sorted((ROOT / folder).rglob('*')):
            if path.is_file() and not path.name.startswith('.') and path.suffix not in EXCLUDED_SUFFIXES:
                yield path


def chrome_manifest(manifest: dict) -> dict:
    out = json.loads(json.dumps(manifest))
    out.pop('browser_specific_settings', None)
    out['background'] = {'service_worker': 'scripts/background.js', 'type': 'module'}
    return out


def firefox_manifest(manifest: dict) -> dict:
    out = json.loads(json.dumps(manifest))
    out.pop('minimum_chrome_version', None)
    out['background'] = {'scripts': ['scripts/background.js'], 'type': 'module'}
    return out


def write_zip(path: Path, manifest: dict):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
        for file in runtime_files():
            z.write(file, arcname=file.relative_to(ROOT).as_posix())


def main(argv):
    manifest_path = ROOT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

    part = next((a for a in argv if a in ('patch', 'minor', 'major')), None)
    if part:
        manifest['version'] = bump(manifest['version'], part)
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        package_json = ROOT / 'package.json'
        if package_json.exists():
            pkg = json.loads(package_json.read_text(encoding='utf-8'))
            pkg['version'] = manifest['version']
            package_json.write_text(json.dumps(pkg, indent=2) + '\n', encoding='utf-8')
        print(f"Bumped version to {manifest['version']}")

    version = manifest['version']
    dist = Path(argv[argv.index('--out') + 1]).resolve() if '--out' in argv else DIST
    dist.mkdir(parents=True, exist_ok=True)
    outputs = {
        dist / f'leetx-chrome-v{version}.zip': chrome_manifest(manifest),
        dist / f'leetx-firefox-v{version}.zip': firefox_manifest(manifest),
    }
    for path, mf in outputs.items():
        write_zip(path, mf)
        print(f'Packaged {path} ({path.stat().st_size // 1024} KB)')

    # Stable names so install scripts can use releases/latest/download/<name>.
    shutil.copyfile(dist / f'leetx-chrome-v{version}.zip', dist / 'leetx-chrome.zip')
    shutil.copyfile(dist / f'leetx-firefox-v{version}.zip', dist / 'leetx-firefox.zip')

    if '--copy-to-downloads' in argv and not os.environ.get('CI'):
        downloads = Path.home() / 'Downloads'
        if downloads.is_dir():
            for path in outputs:
                shutil.copy2(path, downloads / path.name)
            print(f'Copied packages to {downloads}')


if __name__ == '__main__':
    main(sys.argv[1:])

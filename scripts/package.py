import json
import zipfile
import shutil
import os
import sys
from pathlib import Path

def package_extension(bump=None):
    root_dir = Path(__file__).resolve().parent.parent
    manifest_file = root_dir / 'manifest.json'

    with open(manifest_file, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    if bump:
        parts = [int(p) for p in manifest.get('version', '1.0.0').split('.')]
        if bump == 'patch':
            parts[-1] += 1
        elif bump == 'minor':
            parts[1] += 1
            parts[2] = 0
        elif bump == 'major':
            parts[0] += 1
            parts[1] = 0
            parts[2] = 0
        manifest['version'] = '.'.join(str(p) for p in parts)
        with open(manifest_file, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2)
        print(f"Bumped version to {manifest['version']}")

    version = manifest.get('version', '1.1.2')
    dist_dir = root_dir / 'dist'
    dist_dir.mkdir(parents=True, exist_ok=True)

    items = ['manifest.json', 'popup', 'scripts', 'styles', 'assets', 'README.md', 'firebase.json', 'firestore.rules', '.firebaserc']
    downloads = Path(os.environ.get('USERPROFILE', 'C:/Users/saich')) / 'Downloads'

    # 1. Package Chrome / Standard MV3 Distribution
    chrome_zip_path = dist_dir / f'leetx-v{version}.zip'
    with zipfile.ZipFile(chrome_zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for item in items:
            p = root_dir / item
            if p.is_file():
                z.write(p, arcname=item)
            elif p.is_dir():
                for f in p.rglob('*'):
                    if f.is_file() and not f.name.startswith('.'):
                        z.write(f, arcname=str(f.relative_to(root_dir)))

    if downloads.exists():
        target_chrome = downloads / f'leetx-v{version}.zip'
        shutil.copy2(chrome_zip_path, target_chrome)
        shutil.copy2(chrome_zip_path, downloads / 'leetx.zip')
        # Also copy legacy name for compatibility
        shutil.copy2(chrome_zip_path, downloads / f'leetsync-squads-v{version}.zip')
        print(f"Copied Chrome package to {target_chrome}")

    # 2. Package Firefox AMO MV3 Distribution (with background.scripts fallback)
    firefox_manifest = dict(manifest)
    firefox_manifest['background'] = {
        'service_worker': 'scripts/background.js',
        'scripts': ['scripts/background.js'],
        'type': 'module'
    }
    firefox_zip_path = dist_dir / f'leetx-firefox-v{version}.zip'
    with zipfile.ZipFile(firefox_zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(firefox_manifest, indent=2))
        for item in items:
            if item == 'manifest.json':
                continue
            p = root_dir / item
            if p.is_file():
                z.write(p, arcname=item)
            elif p.is_dir():
                for f in p.rglob('*'):
                    if f.is_file() and not f.name.startswith('.'):
                        z.write(f, arcname=str(f.relative_to(root_dir)))

    if downloads.exists():
        target_ff = downloads / f'leetx-firefox-v{version}.zip'
        shutil.copy2(firefox_zip_path, target_ff)
        print(f"Copied Firefox package to {target_ff}")

    print(f"Successfully packaged Chrome -> {chrome_zip_path}")
    print(f"Successfully packaged Firefox -> {firefox_zip_path}")
    return chrome_zip_path

if __name__ == '__main__':
    bump_type = sys.argv[1] if len(sys.argv) > 1 else None
    package_extension(bump_type)

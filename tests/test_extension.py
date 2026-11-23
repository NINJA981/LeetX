"""Static checks on the extension package: manifest, datasets, packaging."""
import json
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_json(rel):
    with open(ROOT / rel, encoding="utf-8") as f:
        return json.load(f)


class TestManifest(unittest.TestCase):
    def setUp(self):
        self.manifest = load_json("manifest.json")

    def test_mv3_basics(self):
        m = self.manifest
        self.assertEqual(m["manifest_version"], 3)
        self.assertRegex(m["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(m["background"]["service_worker"], "scripts/background.js")
        self.assertEqual(m["background"]["type"], "module")

    def test_least_privilege(self):
        perms = set(self.manifest["permissions"])
        self.assertEqual(perms, {"storage", "alarms", "notifications", "cookies", "identity"})
        hosts = self.manifest["host_permissions"]
        self.assertNotIn("<all_urls>", hosts)
        self.assertTrue(all(h.startswith("https://") for h in hosts))
        self.assertIn("https://firestore.googleapis.com/*", hosts)

    def test_only_overlay_css_is_web_accessible(self):
        resources = [r for entry in self.manifest["web_accessible_resources"] for r in entry["resources"]]
        self.assertEqual(resources, ["styles/content.css"])

    def test_icons_exist(self):
        for rel in self.manifest["icons"].values():
            self.assertTrue((ROOT / rel).is_file(), rel)

    def test_firefox_id_is_stable(self):
        gecko = self.manifest["browser_specific_settings"]["gecko"]
        self.assertEqual(gecko["id"], "leetx-squads@ninja981.github.io")
        self.assertNotIn("none", gecko["data_collection_permissions"]["required"])


class TestDatasets(unittest.TestCase):
    def check(self, rel, minimum):
        data = load_json(rel)
        self.assertGreaterEqual(len(data), minimum)
        slugs = [p["slug"] for p in data]
        self.assertEqual(len(slugs), len(set(slugs)), "duplicate slugs")
        for p in data:
            self.assertTrue({"id", "title", "slug", "difficulty", "category"} <= p.keys())
            self.assertIn(p["difficulty"], {"Easy", "Medium", "Hard"})
            self.assertRegex(p["slug"], r"^[a-z0-9-]+$")

    def test_blind75(self):
        self.check("assets/data/blind75.json", 75)

    def test_neetcode150(self):
        self.check("assets/data/neetcode150.json", 150)


class TestSourceHygiene(unittest.TestCase):
    """Remote data must never be rendered as HTML."""

    UI_FILES = ["scripts/content.js", "popup/app.js", "popup/ui.js"] + [
        str(p.relative_to(ROOT)) for p in (ROOT / "popup/views").glob("*.js")
    ]

    def test_no_html_sinks(self):
        sink = re.compile(r"\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(")
        for rel in self.UI_FILES:
            text = (ROOT / rel).read_text(encoding="utf-8")
            self.assertIsNone(sink.search(text), f"HTML sink in {rel}")

    def test_no_inline_scripts_in_popup(self):
        html = (ROOT / "popup/index.html").read_text(encoding="utf-8")
        self.assertNotRegex(html, r"<script(?![^>]*\bsrc=)")
        self.assertNotRegex(html, r"\son[a-z]+=")


class TestPackaging(unittest.TestCase):
    def test_package_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_dist = Path(tmp)
            subprocess.run([sys.executable, str(ROOT / "scripts/package.py"), "--out", str(env_dist)], check=True, capture_output=True)
            version = load_json("manifest.json")["version"]

            with zipfile.ZipFile(env_dist / f"leetx-chrome-v{version}.zip") as z:
                names = set(z.namelist())
                chrome = json.loads(z.read("manifest.json"))
            self.assertNotIn("browser_specific_settings", chrome)
            self.assertNotIn("scripts", chrome["background"])
            for required in ["popup/index.html", "popup/app.js", "popup/views/today.js", "scripts/core.js", "styles/content.css", "assets/data/blind75.json"]:
                self.assertIn(required, names)
            for forbidden in ["scripts/package.py", "firestore.rules", ".firebaserc", "README.md", "package.json"]:
                self.assertNotIn(forbidden, names)

            with zipfile.ZipFile(env_dist / f"leetx-firefox-v{version}.zip") as z:
                firefox = json.loads(z.read("manifest.json"))
            self.assertEqual(firefox["background"], {"scripts": ["scripts/background.js"], "type": "module"})
            self.assertIn("gecko", firefox["browser_specific_settings"])


if __name__ == "__main__":
    unittest.main()

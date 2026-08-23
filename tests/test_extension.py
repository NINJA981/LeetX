import json
import unittest
from pathlib import Path


class TestExtensionStructure(unittest.TestCase):
    def setUp(self):
        self.ext_dir = Path(".")

    def test_manifest_validity(self):
        manifest_path = self.ext_dir / "manifest.json"
        self.assertTrue(manifest_path.is_file(), "manifest.json must exist")

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        self.assertEqual(manifest.get("manifest_version"), 3)
        self.assertIn("storage", manifest.get("permissions", []))
        self.assertIn("identity", manifest.get("permissions", []))
        self.assertIn("alarms", manifest.get("permissions", []))
        self.assertTrue(manifest.get("background", {}).get("service_worker"))

        # Verify icons exist
        icons = manifest.get("icons", {})
        for size, rel_path in icons.items():
            icon_file = self.ext_dir / rel_path
            self.assertTrue(icon_file.is_file(), f"Icon {rel_path} must exist")

    def test_blind75_dataset(self):
        dataset_path = self.ext_dir / "assets" / "data" / "blind75.json"
        self.assertTrue(dataset_path.is_file())

        with open(dataset_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertGreaterEqual(len(data), 60)
        for item in data:
            self.assertIn("id", item)
            self.assertIn("title", item)
            self.assertIn("slug", item)
            self.assertIn("difficulty", item)
            self.assertIn("category", item)

    def test_popup_and_scripts_exist(self):
        required_files = [
            "popup/index.html",
            "popup/style.css",
            "popup/app.js",
            "scripts/background.js",
            "scripts/content.js",
            "scripts/github.js",
            "scripts/leetcode.js",
            "scripts/firebase.js",
            "styles/content.css",
            "README.md",
        ]
        for rel in required_files:
            file_path = self.ext_dir / rel
            self.assertTrue(file_path.is_file(), f"{rel} must exist")


if __name__ == "__main__":
    unittest.main()

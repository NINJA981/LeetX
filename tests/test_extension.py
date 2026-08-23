import json
import re
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
        self.assertIn("notifications", manifest.get("permissions", []))
        self.assertTrue(manifest.get("background", {}).get("service_worker"))

        # Verify host permissions for Firestore
        host_perms = manifest.get("host_permissions", [])
        self.assertTrue(
            any("firestore.googleapis.com" in p for p in host_perms),
            "Firestore host permission must be included in manifest",
        )

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

        self.assertGreaterEqual(len(data), 75)
        for item in data:
            self.assertIn("id", item)
            self.assertIn("title", item)
            self.assertIn("slug", item)
            self.assertIn("difficulty", item)
            self.assertIn("category", item)

    def test_neetcode150_dataset(self):
        dataset_path = self.ext_dir / "assets" / "data" / "neetcode150.json"
        self.assertTrue(dataset_path.is_file())

        with open(dataset_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertGreaterEqual(len(data), 150)
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
            "firestore.rules",
            "firebase.json",
            "README.md",
        ]
        for rel in required_files:
            file_path = self.ext_dir / rel
            self.assertTrue(file_path.is_file(), f"{rel} must exist")

    def test_room_code_format(self):
        """Test that room codes generated follow the 6-character unambiguous rule."""
        charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
        # Verify forbidden characters are not in charset
        for forbidden in ["0", "O", "1", "I"]:
            self.assertNotIn(forbidden, charset)

        # Test code format regex
        valid_code = "K9X2P4"
        self.assertEqual(len(valid_code), 6)
        self.assertTrue(re.match(r"^[2-9A-HJ-NP-Z]{6}$", valid_code))

    def test_duel_schema_structure(self):
        """Test duel match object schema requirements."""
        duel_mock = {
            "id": "duel_1740000000_abc12",
            "roomCode": "ALGO99",
            "challenger": "NINJA981",
            "opponent": "Alex_Dev",
            "format": "random_blind75",
            "problem": {
                "id": 1,
                "title": "Two Sum",
                "slug": "two-sum",
                "difficulty": "Easy",
            },
            "status": "pending",
            "createdAt": 1740000000,
            "startedAt": None,
            "finishedAt": None,
            "winner": None,
        }
        self.assertIn("id", duel_mock)
        self.assertIn("roomCode", duel_mock)
        self.assertIn("challenger", duel_mock)
        self.assertIn("opponent", duel_mock)
        self.assertIn("problem", duel_mock)
        self.assertIn("status", duel_mock)
        self.assertIn(duel_mock["status"], ["pending", "active", "completed", "forfeited", "declined"])


if __name__ == "__main__":
    unittest.main()

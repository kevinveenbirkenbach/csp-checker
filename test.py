#!/usr/bin/env python3
import unittest
from unittest.mock import patch
import importlib.util
import os

# Load main.py dynamically
here = os.path.abspath(os.path.dirname(__file__))
main_path = os.path.join(here, "main.py")
spec = importlib.util.spec_from_file_location("main", main_path)
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)


class TestMainPy(unittest.TestCase):
    @patch("subprocess.check_call")
    def test_start_container_with_domains_short_and_ignore(self, mock_call):
        """
        Expect: docker run --rm test-image --short --ignore-network-blocks-from pxscdn.com cdn.example.org example.org
        (Order: image first, then flags, then domains)
        """
        main.start_container(
            "test-image",
            ["example.org"],
            True,
            ["pxscdn.com", "cdn.example.org"]
        )
        mock_call.assert_called_once()
        args, kwargs = mock_call.call_args
        cmd = args[0]

        # basic structure
        self.assertGreaterEqual(len(cmd), 4)
        self.assertEqual(cmd[0], "docker")
        self.assertEqual(cmd[1], "run")
        self.assertIn("--rm", cmd)
        self.assertIn("test-image", cmd)

        # flags & values
        self.assertIn("--short", cmd)
        self.assertIn("--ignore-network-blocks-from", cmd)
        # ensure both ignore domains are present
        self.assertIn("pxscdn.com", cmd)
        self.assertIn("cdn.example.org", cmd)

        # target domains should be passed
        self.assertIn("example.org", cmd)

        # sanity: image should come before flags/domains in our builder
        image_index = cmd.index("test-image")
        self.assertLess(image_index, cmd.index("--short"))
        self.assertLess(image_index, cmd.index("--ignore-network-blocks-from"))

    @patch("subprocess.check_call")
    def test_start_container_without_domains(self, mock_call):
        """
        Expect: docker run --rm test-image
        (no --short, no ignore flag, and image should be the last token)
        """
        main.start_container("test-image", [], False, [])
        mock_call.assert_called_once()
        args, kwargs = mock_call.call_args
        cmd = args[0]

        self.assertEqual(cmd[0], "docker")
        self.assertEqual(cmd[1], "run")
        self.assertIn("--rm", cmd)
        self.assertIn("test-image", cmd)

        # No flags expected
        self.assertNotIn("--short", cmd)
        self.assertNotIn("--ignore-network-blocks-from", cmd)

        # With no domains, image remains the last token
        self.assertEqual(cmd[-1], "test-image")

    @patch("subprocess.check_call")
    def test_start_container_with_flag_but_empty_ignore_list(self, mock_call):
        """
        Simulate argparse passing an empty ignore list:
        Expect: behaves as if flag not provided (no --ignore-network-blocks-from in cmd)
        """
        main.start_container("test-image", ["blog.infinito.nexus"], False, [])
        mock_call.assert_called_once()
        args, kwargs = mock_call.call_args
        cmd = args[0]

        self.assertEqual(cmd[0], "docker")
        self.assertEqual(cmd[1], "run")
        self.assertIn("--rm", cmd)
        self.assertIn("test-image", cmd)
        self.assertIn("blog.infinito.nexus", cmd)

        # Flag should not appear if list is empty
        self.assertNotIn("--ignore-network-blocks-from", cmd)


if __name__ == "__main__":
    unittest.main()

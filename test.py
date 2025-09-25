#!/usr/bin/env python3
import unittest
from unittest.mock import patch, call
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
    def test_start_container_with_domains_and_short(self, mock_call):
        main.start_container("test-image", ["example.org"], True)
        mock_call.assert_called_once()
        args, kwargs = mock_call.call_args
        cmd = args[0]
        self.assertIn("docker", cmd[0])
        self.assertIn("run", cmd[1])
        self.assertIn("test-image", cmd)
        self.assertIn("--short", cmd)
        self.assertIn("example.org", cmd)

    @patch("subprocess.check_call")
    def test_start_container_without_domains(self, mock_call):
        main.start_container("test-image", [], False)
        mock_call.assert_called_once()
        args, kwargs = mock_call.call_args
        cmd = args[0]
        self.assertIn("docker", cmd[0])
        self.assertIn("run", cmd[1])
        self.assertIn("test-image", cmd)
        # No --short, no domains
        self.assertNotIn("--short", cmd)
        self.assertEqual(cmd[-1], "test-image")


if __name__ == "__main__":
    unittest.main()

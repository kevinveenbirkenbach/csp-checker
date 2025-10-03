#!/usr/bin/env python3
import os
import subprocess
import argparse

# Always find the real directory of this script (resolving symlinks)
SCRIPT_PATH = os.path.realpath(__file__)
BASE_DIR = os.path.dirname(SCRIPT_PATH)

def start_container(tag, domains, short_mode, ignore_network_blocks_from):
    """
    Run the container (always from this script’s folder).
    Supports:
      --short  (limits output inside the container)
      --ignore-network-blocks-from <domain...> (suppress network block reports from these domains)
    """
    cmd = ["docker", "run", "--rm", tag]

    if short_mode:
        cmd.append("--short")

    if ignore_network_blocks_from:
        cmd.append("--ignore-network-blocks-from")
        cmd.extend(ignore_network_blocks_from)
        cmd.append("--")

    if domains:
        cmd.extend(domains)
    else:
        print("⚠️  No domains provided; container may error if it expects args.")

    subprocess.check_call(cmd, cwd=BASE_DIR)


def main():
    parser = argparse.ArgumentParser(
        description="Run the csp-checker container from its own repo dir"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # Start command (build is handled by Makefile)
    s = sub.add_parser("start", help="Run the CSP checker against domains")
    s.add_argument(
        "--tag", default="csp-checker:latest",
        help="Image tag to run"
    )
    s.add_argument(
        "--short", action="store_true",
        help="Only show one example per type/policy inside the checker"
    )
    s.add_argument(
        "--ignore-network-blocks-from", nargs="*", default=[],
        help="Optional: one or more domains whose network block failures should be ignored"
    )
    s.add_argument(
        "domains", nargs="*",
        help="Domains to check (required)"
    )

    args = parser.parse_args()
    if args.command == "start":
        start_container(
            args.tag,
            args.domains,
            args.short,
            args.ignore_network_blocks_from
        )

if __name__ == "__main__":
    main()

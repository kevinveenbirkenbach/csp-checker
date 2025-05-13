#!/usr/bin/env python3
import os
import subprocess
import argparse
import sys

# Ensure all Docker commands run from this script’s directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def build_image(tag):
    """Build the Docker image with the given tag from this script’s folder."""
    print(f"Building image {tag}…")
    subprocess.check_call(
        ["docker", "build", "-t", tag, "."],
        cwd=BASE_DIR
    )

def ensure_image(tag):
    """Make sure the image exists; if not, build it."""
    try:
        subprocess.check_call(
            ["docker", "image", "inspect", tag],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=BASE_DIR
        )
    except subprocess.CalledProcessError:
        build_image(tag)

def start_container(tag, domains):
    """Run the container (from this script’s folder), building it first if needed."""
    ensure_image(tag)

    cmd = ["docker", "run", "--rm"]
    if domains:
        cmd.append(tag)
        cmd.extend(domains)
    elif os.path.exists(os.path.join(BASE_DIR, ".env")):
        cmd.extend(["--env-file", ".env", tag])
    else:
        print("⚠️  No domains provided; container may error if it expects args.")
        cmd.append(tag)

    subprocess.check_call(
        cmd,
        cwd=BASE_DIR
    )

def main():
    parser = argparse.ArgumentParser(
        description="Build or run the csp-checker container"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    b = sub.add_parser("build", help="Build the Docker image")
    b.add_argument(
        "--tag", default="csp-checker:latest",
        help="Image tag to build"
    )

    s = sub.add_parser("start", help="Run the CSP checker against domains")
    s.add_argument(
        "--tag", default="csp-checker:latest",
        help="Image tag to run"
    )
    s.add_argument(
        "domains", nargs="*",
        help="Domains to check (overrides .env)"
    )

    args = parser.parse_args()
    if args.command == "build":
        build_image(args.tag)
    else:
        start_container(args.tag, args.domains)

if __name__ == "__main__":
    main()

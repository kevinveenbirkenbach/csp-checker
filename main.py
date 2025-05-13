#!/usr/bin/env python3
import os
import subprocess
import argparse
import sys

def build_image(tag):
    """Build the Docker image with the given tag."""
    print(f"Building image {tag}…")
    subprocess.check_call(["docker", "build", "-t", tag, "."])

def ensure_image(tag):
    """Make sure the image exists; if not, build it."""
    try:
        subprocess.check_call(
            ["docker", "image", "inspect", tag],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except subprocess.CalledProcessError:
        build_image(tag)

def start_container(tag, domains):
    """Run the container, building it first if needed."""
    ensure_image(tag)

    cmd = ["docker", "run", "--rm"]
    if domains:
        cmd.append(tag)
        cmd.extend(domains)
    elif os.path.exists(".env"):
        cmd.extend(["--env-file", ".env", tag])
    else:
        print("⚠️  No domains provided; container will error if it expects arguments.")
        cmd.append(tag)

    subprocess.check_call(cmd)

def main():
    parser = argparse.ArgumentParser(
        description="Build or run the csp-checker container"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="Build the Docker image")
    build.add_argument("--tag", default="csp-checker:latest",
                       help="Image tag to build")

    start = subparsers.add_parser("start", help="Run the container to check domains")
    start.add_argument("--tag", default="csp-checker:latest",
                       help="Image tag to run")
    start.add_argument("domains", nargs="*",
                       help="Domains to check (overrides .env)")

    args = parser.parse_args()
    if args.command == "build":
        build_image(args.tag)
    else:
        start_container(args.tag, args.domains)

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
import os
import sys
import subprocess
import random
import re
import string
from urllib.parse import urlparse

REPLACEX = re.compile(r"[^-_a-zA-Z0-9]")

TIME_LIMIT = 300.0  # seconds (5 minutes, per seed-crawl)


def main(argv):
    if len(sys.argv) == 1:
        print(f"usage: {argv[0]} [URL1 [URL2 [...]]]")
        exit(2)

    for url in sys.argv[1:]:
        hostname = urlparse(url).hostname
        munged_url = REPLACEX.sub("_", url)[:64]
        random_tag = "".join(random.sample(string.ascii_letters + string.digits, 8))
        collection_dir = os.path.join(hostname, f"{munged_url}.{random_tag}")

        os.makedirs(collection_dir, exist_ok=False)
        log_filename = os.path.join(collection_dir, "crawl.log")
        json_filename = os.path.abspath(
            os.path.join(collection_dir, "navigations.json")
        )
        print(f"Crawling '{url}' (dir={collection_dir})...", flush=True)

        cmd_argv = [
            "node",
            "./main.js",
            url,
            json_filename,
        ]
        with open(log_filename, "wt", encoding="utf-8") as log:
            cmd_options = {
                "cwd": "/home/jjuecks/brave/random-walk-bot",
                "stdout": log,
                "stderr": subprocess.STDOUT,
                "check": True,
                "timeout": TIME_LIMIT,
            }
            try:
                subprocess.run(cmd_argv, **cmd_options)
            except subprocess.TimeoutExpired:
                print("TIMEOUT", flush=True, file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv)

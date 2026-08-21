"""FastPPT persistent worker command."""

from __future__ import annotations

import argparse
import json
import logging

from .worker import Worker


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="claim at most one job and exit")
    parser.add_argument("--poll-seconds", type=float, default=1.0)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}')
    worker = Worker.create()
    if args.once:
        print(json.dumps({"claimed": worker.run_once(), "worker_id": worker.worker_id}))
    else:
        worker.run_forever(max(0.1, args.poll_seconds))


if __name__ == "__main__":
    main()

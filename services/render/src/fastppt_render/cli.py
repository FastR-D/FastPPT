"""FastPPT PowerPoint Render Worker command."""

from __future__ import annotations

import argparse
import json

from .worker import RenderWorker


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    args = parser.parse_args()
    worker = RenderWorker.create()
    if args.once:
        print(json.dumps({"claimed": worker.run_once(), "worker_id": worker.worker_id}))
    else:
        worker.run_forever(max(0.2, args.poll_seconds))


if __name__ == "__main__":
    main()

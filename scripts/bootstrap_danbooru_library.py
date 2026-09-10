"""Resume a Danbooru metadata library bootstrap outside the ComfyUI UI.

This utility is intentionally single-threaded. It uses the same SQLite
transactions, cursor checks, pacing, long rests and Retry-After handling as the
node. It never downloads images or bypasses access controls.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import signal
import sys
import threading


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_library_module():
    path = ROOT / "eagle_suite" / "danbooru_library.py"
    spec = importlib.util.spec_from_file_location("eagle_danbooru_library_cli", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def parser():
    result = argparse.ArgumentParser(description="Build/resume the Eagle Danbooru metadata library")
    result.add_argument("--db", required=True, help="Target tags.sqlite3")
    result.add_argument("--seed", help="Optional bundled tags CSV")
    result.add_argument("--encoding", default="utf-8-sig")
    result.add_argument("--base-url", default="https://danbooru.donmai.us")
    result.add_argument("--interval", type=float, default=3.0)
    result.add_argument("--jitter", type=float, default=1.0)
    result.add_argument("--pause-every", type=int, default=25)
    result.add_argument("--pause-seconds", type=float, default=15.0)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    module = load_library_module()
    stop = threading.Event()

    def request_stop(_signum, _frame):
        stop.set()
        print("\nStop requested; the last committed page and cursor are preserved.", flush=True)

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)

    import requests
    library = module.Library(args.db)
    seen_pages = {"tags": 0, "groups": 0}

    def progress(value):
        stage = value.get("stage", "")
        if value.get("pages_this_run"):
            seen_pages[stage] = int(value["pages_this_run"])
        # Keep logs compact while still proving forward progress.
        if value.get("complete") or value.get("starting") or value.get("pages_this_run", 0) % 10 == 0:
            print(json.dumps(value, ensure_ascii=False, sort_keys=True), flush=True)

    try:
        with requests.Session() as session:
            client = module.PoliteClient(
                session, stop, interval=args.interval, jitter=args.jitter,
                pause_every=args.pause_every, pause_seconds=args.pause_seconds,
                base_url=args.base_url,
            )
            states = module.bootstrap(
                library, client, args.seed, progress, args.encoding,
            )
        print(json.dumps({"complete": True, "states": states, "status": library.status()}, ensure_ascii=False), flush=True)
        return 0
    except InterruptedError as error:
        print(json.dumps({"complete": False, "stopped": True, "message": str(error), "status": library.status()}, ensure_ascii=False), flush=True)
        return 2
    except Exception as error:
        print(json.dumps({"complete": False, "error": f"{type(error).__name__}: {error}", "status": library.status()}, ensure_ascii=False), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())

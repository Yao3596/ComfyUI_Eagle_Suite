# -*- coding: utf-8 -*-
"""In-process review rendezvous shared by the H3 node and HTTP route."""

import asyncio
from copy import deepcopy
import hashlib
import re
import secrets
import time


_PENDING_REVIEWS = {}


def _terminal_node_id(node_id):
    raw_id = str(node_id or "").strip()
    if not raw_id:
        return ""
    parts = [part for part in re.split(r"[.:/]", raw_id) if part]
    return parts[-1] if parts else raw_id


def review_decision_filename(token):
    """Map an opaque token to a path-safe, non-reversible file name."""
    raw_token = str(token or "")
    if not raw_token:
        raise ValueError("review token is required")
    digest = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return f"review_decision_{digest}.json"


def open_review(node_id=None, run_name=None):
    token = f"{node_id or 'review'}-{secrets.token_urlsafe(18)}"
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    _PENDING_REVIEWS[token] = {
        "loop": loop,
        "future": future,
        "token": token,
        "run_name": str(run_name or "").strip(),
        "node_id": str(node_id or "").strip(),
        "display_node_id": _terminal_node_id(node_id),
        "created_at": time.time(),
        "payload": None,
    }
    return token, future


def publish_review(token, payload):
    """Attach the public review payload to a pending rendezvous.

    The run and node identities recorded by ``open_review`` are authoritative.
    Refusing conflicting payloads keeps a browser refresh from recovering a
    token belonging to a different recursive execution or run.
    """
    pending = _PENDING_REVIEWS.get(str(token or ""))
    if pending is None or pending["future"].done():
        return False

    value = dict(payload or {})
    payload_run = str(value.get("run_name") or "").strip()
    payload_node = str(value.get("node_id") or "").strip()
    if pending["run_name"] and payload_run != pending["run_name"]:
        return False
    if pending["node_id"] and payload_node != pending["node_id"]:
        return False

    value["token"] = pending["token"]
    value["run_name"] = pending["run_name"] or payload_run
    value["node_id"] = pending["node_id"] or payload_node
    pending["payload"] = deepcopy(value)
    return True


def lookup_pending_review(run_name, node_id):
    """Return ``(status, payload)`` for an exact run + display-node lookup.

    Status is one of ``ok``, ``not_found``, ``not_ready`` or ``ambiguous``.
    Ambiguous matches are deliberately not guessed: two active recursive
    executions may share the same visible ComfyUI node id.
    """
    wanted_run = str(run_name or "").strip()
    wanted_node = str(node_id or "").strip()
    if not wanted_run or not wanted_node:
        return "not_found", None

    matches = []
    for pending in tuple(_PENDING_REVIEWS.values()):
        if pending["future"].done():
            continue
        if pending["run_name"] != wanted_run:
            continue
        if pending["display_node_id"] != wanted_node:
            continue
        matches.append(pending)

    if not matches:
        return "not_found", None
    if len(matches) != 1:
        return "ambiguous", None
    if matches[0]["payload"] is None:
        return "not_ready", None
    return "ok", deepcopy(matches[0]["payload"])


def resolve_review(token, payload):
    pending = _PENDING_REVIEWS.get(str(token or ""))
    if pending is None:
        return False
    loop, future = pending["loop"], pending["future"]
    if future.done():
        return False
    value = dict(payload or {})
    payload_run = str(value.get("run_name") or "").strip()
    if pending["run_name"] and payload_run != pending["run_name"]:
        return False

    def finish():
        if not future.done():
            future.set_result(value)

    try:
        current = asyncio.get_running_loop()
    except RuntimeError:
        current = None
    if current is loop:
        finish()
    else:
        loop.call_soon_threadsafe(finish)
    return True


def close_review(token):
    pending = _PENDING_REVIEWS.pop(str(token or ""), None)
    if pending is None:
        return
    loop, future = pending["loop"], pending["future"]
    if future.done():
        return
    try:
        current = asyncio.get_running_loop()
    except RuntimeError:
        current = None
    if current is loop:
        future.cancel()
    else:
        loop.call_soon_threadsafe(future.cancel)


def pending_count():
    return len(_PENDING_REVIEWS)


__all__ = [
    "open_review",
    "review_decision_filename",
    "publish_review",
    "lookup_pending_review",
    "resolve_review",
    "close_review",
    "pending_count",
]

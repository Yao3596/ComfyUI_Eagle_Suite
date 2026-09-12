# -*- coding: utf-8 -*-
"""In-process review rendezvous shared by the H3 node and HTTP route."""

import asyncio
import secrets


_PENDING_REVIEWS = {}


def open_review(node_id=None):
    token = f"{node_id or 'review'}-{secrets.token_urlsafe(18)}"
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    _PENDING_REVIEWS[token] = (loop, future)
    return token, future


def resolve_review(token, payload):
    pending = _PENDING_REVIEWS.get(str(token or ""))
    if pending is None:
        return False
    loop, future = pending
    if future.done():
        return False

    def finish():
        if not future.done():
            future.set_result(dict(payload or {}))

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
    loop, future = pending
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


__all__ = ["open_review", "resolve_review", "close_review", "pending_count"]

# -*- coding: utf-8 -*-
"""Eagle Suite routes registered once a PromptServer is fully initialized."""

import functools
import logging
import threading

_route_handlers = []
_route_keys = set()
_registered_keys = set()
_ready_hook_lock = threading.RLock()
_READY_CALLBACKS_ATTR = "_eagle_suite_route_ready_callbacks"


def route(method: str, path: str):
    """延迟路由装饰器。用法替换原来的 @PromptServer.instance.routes.get/post(...)。

    示例：
        @route("GET", "/eagle_gallery/settings")
        async def get_settings(request): ...
    """
    def decorator(handler):
        key = (method.upper(), path)
        if key not in _route_keys:
            _route_keys.add(key)
            _route_handlers.append((key[0], key[1], handler))
        return handler
    return decorator


def register_all_routes(server) -> bool:
    """Register pending routes; return whether the server route table is ready."""
    routes = getattr(server, "routes", None)
    if routes is None:
        return False
    for method, path, handler in _route_handlers:
        key = (id(server), method, path)
        if key in _registered_keys:
            continue
        try:
            getattr(routes, method.lower())(path)(handler)
            _registered_keys.add(key)
        except Exception as e:
            logging.warning(f"[EagleRouteRegistry] 注册路由 {method} {path} 失败: {e}")
    return True


def register_when_ready(prompt_server_cls, callback, callback_key="eagle_suite") -> bool:
    """Run callback now or after the next PromptServer constructor completes.

    ComfyUI sets ``PromptServer.instance`` near the start of ``__init__``, before
    ``routes`` exists. Wrapping the constructor lets us register on the same
    startup thread after the route table is available, without polling or
    touching aiohttp from a background thread. A callback key replaces stale
    callbacks on hot reload rather than stacking constructor wrappers.
    """
    server = getattr(prompt_server_cls, "instance", None)
    if getattr(server, "routes", None) is not None:
        callback(server)
        return True

    with _ready_hook_lock:
        callbacks = getattr(prompt_server_cls, _READY_CALLBACKS_ATTR, None)
        if callbacks is None:
            callbacks = {}
            setattr(prompt_server_cls, _READY_CALLBACKS_ATTR, callbacks)
            original_init = prompt_server_cls.__init__

            @functools.wraps(original_init)
            def _init_and_register(self, *args, **kwargs):
                original_init(self, *args, **kwargs)
                for ready_callback in tuple(
                    getattr(prompt_server_cls, _READY_CALLBACKS_ATTR).values()
                ):
                    try:
                        ready_callback(self)
                    except Exception:
                        logging.exception("[EagleRouteRegistry] PromptServer 就绪后注册失败")

            prompt_server_cls.__init__ = _init_and_register
        callbacks[callback_key] = callback

    # The server could have completed construction while the hook was installed.
    server = getattr(prompt_server_cls, "instance", None)
    if getattr(server, "routes", None) is not None:
        callback(server)
        return True
    return False


def clear_routes() -> None:
    """清空已登记的路由（主要用于测试或热重载场景）。"""
    _route_handlers.clear()
    _route_keys.clear()
    _registered_keys.clear()


__all__ = ["route", "register_all_routes", "register_when_ready", "clear_routes"]

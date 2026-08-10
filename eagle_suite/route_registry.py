# -*- coding: utf-8 -*-
"""
Eagle Suite - 延迟路由注册表

解决 ComfyUI 在导入 custom_nodes 时 PromptServer.instance 尚未就绪的问题。
所有画廊节点模块使用本模块提供的 @route 装饰器登记路由处理函数，
由 eagle_suite/__init__.py 在 PromptServer.instance 可用后统一注册。
"""

_route_handlers = []


def route(method: str, path: str):
    """延迟路由装饰器。用法替换原来的 @PromptServer.instance.routes.get/post(...)。

    示例：
        @route("GET", "/eagle_gallery/settings")
        async def get_settings(request): ...
    """
    def decorator(handler):
        _route_handlers.append((method.upper(), path, handler))
        return handler
    return decorator


def register_all_routes(server) -> None:
    """在 PromptServer 实例可用后，将登记的所有路由注册到 server.routes。"""
    if not server:
        return
    routes = server.routes
    for method, path, handler in _route_handlers:
        try:
            getattr(routes, method.lower())(path)(handler)
        except Exception as e:
            import logging
            logging.warning(f"[EagleRouteRegistry] 注册路由 {method} {path} 失败: {e}")


def clear_routes() -> None:
    """清空已登记的路由（主要用于测试或热重载场景）。"""
    _route_handlers.clear()


__all__ = ["route", "register_all_routes", "clear_routes"]

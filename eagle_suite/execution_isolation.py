"""Keep unused Eagle nodes out of a submitted execution, before validation.

The saved workflow is untouched. Missing data inputs deactivate just their
branch; disconnected Eagle providers do not load files or models on global Run.
Explicit node tasks remain executable, including non-output director nodes.
"""

import json
from collections import deque
from copy import deepcopy
from functools import lru_cache


ANCHOR_CLASS_TYPE = "EagleExecutionAnchor"
_HANDLER_ATTR = "_eagle_execution_isolation_handler"
_WIDGET_TYPES = {"STRING", "INT", "FLOAT", "BOOLEAN", "COMBO"}


class _ReviewPrompt(dict):
    """Keep review metadata off the serialized runnable prompt."""

    def __init__(self, prompt, *, source=None, approval=None, conflicting_approvals=False):
        super().__init__(prompt)
        self.review_source_prompt = source
        self.review_approval_metadata = approval
        self.conflicting_review_approvals = conflicting_approvals


class _AnyType(str):
    def __ne__(self, _other):
        return False


class EagleExecutionAnchor:
    """Internal terminal for an empty run or a node-local task."""

    DEPRECATED = True
    CATEGORY = "_EagleInternal"
    RETURN_TYPES = ()
    FUNCTION = "finish"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {"value": (_AnyType("*"), {"forceInput": True})}}

    def finish(self, value=None):
        if value is None:
            return {"ui": {"eagle_inactive_execution": [True]}, "result": ()}
        return ()


def _link(value):
    return (isinstance(value, list) and len(value) == 2
            and isinstance(value[0], (str, int)) and isinstance(value[1], int))


def _upstream_scope(prompt, roots):
    scope = set()
    pending = list(roots)
    while pending:
        key = pending.pop()
        if key in scope or key not in prompt:
            continue
        scope.add(key)
        pending.extend(value[0] for value in prompt[key].get("inputs", {}).values() if _link(value))
    return scope


def _has_editor_request(entry):
    if entry.get("class_type") != "EagleImageMaskEditor":
        return False
    value = entry.get("inputs", {}).get("editor_request")
    if not isinstance(value, str) or not value:
        return False
    try:
        request = json.loads(value)
    except (ValueError, RecursionError):
        return False
    return (isinstance(request, dict) and isinstance(request.get("id"), str)
            and bool(request["id"].strip()) and request.get("action") in ("preview", "segment"))


def make_prompt_filter(eagle_nodes, all_nodes=None):
    registry = all_nodes if all_nodes is not None else eagle_nodes

    def node_class(entry):
        kind = entry.get("class_type")
        return eagle_nodes.get(kind) or registry.get(kind)

    @lru_cache(maxsize=None)
    def required_ports(kind):
        # INPUT_TYPES can scan model directories. Read it once per class and
        # never read it for an entirely isolated node that is already skipped.
        definition = eagle_nodes[kind].INPUT_TYPES()
        ports = []
        for name, spec in definition.get("required", {}).items():
            value_type = spec[0]
            options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            if options.get("forceInput") or (
                isinstance(value_type, str) and value_type not in _WIDGET_TYPES
            ):
                ports.append(name)
        return tuple(ports)

    def filter_prompt(payload):
        prompt = payload.get("prompt")
        if not isinstance(prompt, dict) or not prompt:
            return payload
        requested = payload.get("partial_execution_targets")
        editor_ids = [key for key, entry in prompt.items() if _has_editor_request(entry)] \
            if "EagleImageMaskEditor" in eagle_nodes else []
        director_ids = [
            key for key, entry in prompt.items()
            if entry.get("class_type") == "EagleH3DirectorNode"
            and "EagleH3DirectorNode" in eagle_nodes
            and isinstance(request := entry.get("inputs", {}).get("skill_request"), str)
            and request.strip()
        ]
        tool_ids = editor_ids or director_ids
        if tool_ids:
            # Keep node tools isolated even when a frontend drops partial targets.
            requested = [key for key in tool_ids if key in (requested or [])] or tool_ids
            scope = _upstream_scope(prompt, requested)
            prompt = {key: entry for key, entry in prompt.items() if key in scope}
        resume_ids = set()
        if not tool_ids and "EagleReviewGateResume" in eagle_nodes:
            gate_types = {"EagleReviewGate", "EagleReviewGateEager", "EagleReviewGateResume"}
            resume_ids = {key for key, entry in prompt.items()
                          if entry.get("class_type") in gate_types
                          and entry.get("inputs", {}).get("需要确认", True)
                          and entry.get("inputs", {}).get("确认令牌")}
        if resume_ids:
            # Some frontend queue wrappers discard partial-execution options.
            # Derive approval scope on the server, so an upstream PreviewImage
            # cannot become a second output root and rerun the sampler.
            followers = {key: set() for key in prompt}
            for key, entry in prompt.items():
                for value in entry.get("inputs", {}).values():
                    if _link(value) and value[0] in followers:
                        followers[value[0]].add(key)
            downstream = set()
            pending = list(resume_ids)
            while pending:
                key = pending.pop()
                if key in downstream:
                    continue
                downstream.add(key)
                pending.extend(followers[key])
            allowed = [key for key, entry in prompt.items()
                       if key in downstream and getattr(node_class(entry), "OUTPUT_NODE", False)]
            if requested is not None:
                allowed = [key for key in allowed if key in requested]
            requested = allowed or list(resume_ids)
            prompt = dict(prompt)
            for key in resume_ids:
                entry = prompt[key]
                inputs = {name: value for name, value in entry.get("inputs", {}).items()
                          if name not in {"value", "对比图像"}}
                prompt[key] = {**entry, "class_type": "EagleReviewGateResume", "inputs": inputs}
        omitted_reference = False
        if "EagleReviewGate" in eagle_nodes and "EagleImageMaskEditor" in registry:
            for key, entry in tuple(prompt.items()):
                if entry.get("class_type") != "EagleReviewGate":
                    continue
                inputs = entry.get("inputs", {})
                reference = inputs.get("对比图像")
                if not _link(reference):
                    continue
                source = prompt.get(reference[0], {})
                source_inputs = source.get("inputs", {})
                if (source.get("class_type") == "EagleImageMaskEditor"
                        and not (source_inputs.get("image") or _link(source_inputs.get("image_input")))):
                    # An empty editor blocks its own consumers. The reference
                    # is optional, so let the main result reach the gate alone.
                    if not omitted_reference:
                        prompt = dict(prompt)
                        omitted_reference = True
                    trimmed = dict(inputs)
                    trimmed.pop("对比图像")
                    prompt[key] = {**entry, "inputs": trimmed}
        eagle_ids = {key for key, entry in prompt.items()
                     if entry.get("class_type") in eagle_nodes
                     and entry.get("class_type") != ANCHOR_CLASS_TYPE}
        if not eagle_ids:
            return payload
        explicit = set(requested or [])
        parents = {key: set() for key in prompt}
        children = {key: set() for key in prompt}
        for key, entry in prompt.items():
            for value in entry.get("inputs", {}).values():
                if _link(value) and value[0] in prompt:
                    parents[key].add(value[0])
                    children[value[0]].add(key)

        pending = deque()
        for key in eagle_ids:
            if not parents[key] and not children[key] and key not in explicit:
                pending.append(key)
                continue
            entry = prompt[key]
            inputs = entry.get("inputs", {})
            for name in required_ports(entry["class_type"]):
                value = inputs.get(name)
                if value is None or (_link(value) and value[0] not in prompt):
                    pending.append(key)
                    break

        skipped = set()
        while pending:
            key = pending.popleft()
            if key in skipped:
                continue
            skipped.add(key)
            # A consumer must never run using a missing or placeholder result.
            pending.extend(children[key])
            for parent in parents[key]:
                children[parent].discard(key)
                parent_is_output = getattr(node_class(prompt[parent]), "OUTPUT_NODE", False)
                if (not children[parent] and parent not in explicit
                        and (parent in eagle_ids or not parent_is_output)):
                    pending.append(parent)

        remaining = {key: entry for key, entry in prompt.items() if key not in skipped}
        eager_gate_count = 0
        if "EagleReviewGateEager" in eagle_nodes:
            for key, entry in tuple(remaining.items()):
                if (entry.get("class_type") == "EagleReviewGate"
                        and not entry.get("inputs", {}).get("确认令牌")):
                    # A lazy gate gets an early "executing" event while its
                    # upstream sampler is still running. Only approval needs
                    # lazy input; an initial run must wait for actual input.
                    remaining[key] = {**entry, "class_type": "EagleReviewGateEager"}
                    eager_gate_count += 1
        targets = [key for key in (requested or []) if key in remaining]
        anchor_count = 0

        def add_anchor(value=None):
            nonlocal anchor_count
            while True:
                anchor = f"__eagle_execution_{anchor_count}"
                anchor_count += 1
                if anchor not in prompt and anchor not in remaining:
                    break
            remaining[anchor] = {"class_type": ANCHOR_CLASS_TYPE,
                                 "inputs": {} if value is None else {"value": value}}
            return anchor

        # ComfyUI accepts partial targets only when they are OUTPUT_NODEs.
        # Attach an internal terminal to a director/processor rather than
        # queueing the user's whole workflow to run a node-local tool.
        for index, key in enumerate(targets):
            entry = remaining[key]
            cls = node_class(entry)
            if key in eagle_ids and not getattr(cls, "OUTPUT_NODE", False):
                targets[index] = add_anchor([key, 0])

        if requested is not None:
            if not targets and skipped:
                targets = [add_anchor()]
        elif skipped and not any(getattr(node_class(entry), "OUTPUT_NODE", False)
                                 for entry in remaining.values()):
            add_anchor()

        if resume_ids:
            # Keep downstream dependencies such as an upscaler's own model
            # loaders, and exclude every unrelated/upstream execution root.
            scope = _upstream_scope(remaining, targets)
            remaining = {key: entry for key, entry in remaining.items() if key in scope}

        if not (skipped or anchor_count or eager_gate_count or resume_ids or tool_ids or omitted_reference):
            return payload
        result = {**payload, "prompt": remaining}
        if resume_ids:
            lookup = getattr(eagle_nodes["EagleReviewGateResume"], "pending_metadata", None)
            if lookup is not None:
                approvals = [metadata for key in resume_ids
                             if (metadata := lookup(key, prompt[key]["inputs"]["确认令牌"])) is not None]
                if approvals:
                    metadata = approvals[0]
                    if any(candidate != metadata for candidate in approvals[1:]):
                        # ComfyUI uses one hidden metadata context for the job.
                        result["prompt"] = _ReviewPrompt(remaining, conflicting_approvals=True)
                    else:
                        result["prompt"] = _ReviewPrompt(remaining, approval=metadata)
                        result["extra_data"] = {**(payload.get("extra_data") or {}),
                                                "extra_pnginfo": deepcopy(metadata[1])}
        elif eager_gate_count or isinstance(payload["prompt"], _ReviewPrompt):
            # The execution filter can remove nodes and replace the gate type;
            # retain the submitted graph separately for the candidate's export.
            original = payload["prompt"]
            source = getattr(original, "review_source_prompt", None) or original
            result["prompt"] = _ReviewPrompt(remaining, source=deepcopy(dict(source)))
        if requested is not None:
            result["partial_execution_targets"] = targets
        return result

    return filter_prompt


def register_prompt_filter(server, eagle_nodes, all_nodes=None):
    if not callable(getattr(server, "add_on_prompt_handler", None)):
        return False
    previous = getattr(server, _HANDLER_ATTR, None)
    handlers = getattr(server, "on_prompt_handlers", [])
    if previous in handlers:
        handlers.remove(previous)
    run_filter = make_prompt_filter(eagle_nodes, all_nodes)

    def handler(payload):
        result = run_filter(payload)
        prompt = result.get("prompt", {})
        gates = {key for key, entry in prompt.items() if entry.get("class_type") == "EagleReviewGateEager"}
        if gates and callable(getattr(server, "send_sync", None)):
            registry = all_nodes if all_nodes is not None else eagle_nodes
            roots = result.get("partial_execution_targets")
            if roots is None:
                roots = [key for key, entry in prompt.items()
                         if getattr(eagle_nodes.get(entry.get("class_type")) or registry.get(entry.get("class_type")),
                                    "OUTPUT_NODE", False)]
            scope = _upstream_scope(prompt, roots)
            waiting = gates.intersection(scope)
            client_id = payload.get("client_id") or payload.get("extra_data", {}).get("client_id")
            if waiting and client_id:
                server.send_sync("eagle_preview_waiting", {"node_ids": sorted(waiting)}, client_id)
        return result

    server.add_on_prompt_handler(handler)
    setattr(server, _HANDLER_ATTR, handler)
    return True

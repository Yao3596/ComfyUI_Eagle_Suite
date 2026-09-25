import { app } from "../../../scripts/app.js";
import { refreshEagleVueTheme } from "./eagle_vue_theme.js";
//#region node_modules/svelte/src/internal/shared/utils.js
var is_array = Array.isArray;
var index_of = Array.prototype.indexOf;
var includes = Array.prototype.includes;
var array_from = Array.from;
var define_property = Object.defineProperty;
var get_descriptor = Object.getOwnPropertyDescriptor;
var get_descriptors = Object.getOwnPropertyDescriptors;
var object_prototype = Object.prototype;
var array_prototype = Array.prototype;
var get_prototype_of = Object.getPrototypeOf;
var is_extensible = Object.isExtensible;
var noop = () => {};
/** @param {Function} fn */
function run(fn) {
	return fn();
}
/** @param {Array<() => void>} arr */
function run_all(arr) {
	for (var i = 0; i < arr.length; i++) arr[i]();
}
/**
* TODO replace with Promise.withResolvers once supported widely enough
* @template [T=void]
*/
function deferred() {
	/** @type {(value: T) => void} */
	var resolve;
	/** @type {(reason: any) => void} */
	var reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve,
		reject
	};
}
/**
* When encountering a situation like `let [a, b, c] = $derived(blah())`,
* we need to stash an intermediate value that `a`, `b`, and `c` derive
* from, in case it's an iterable
* @template T
* @param {ArrayLike<T> | Iterable<T>} value
* @param {number} [n]
* @returns {Array<T>}
*/
function to_array(value, n) {
	if (Array.isArray(value)) return value;
	if (n === void 0 || !(Symbol.iterator in value)) return Array.from(value);
	/** @type {T[]} */
	const array = [];
	for (const element of value) {
		array.push(element);
		if (array.length === n) break;
	}
	return array;
}
var CLEAN = 1024;
var DIRTY = 2048;
var MAYBE_DIRTY = 4096;
var INERT = 8192;
var DESTROYED = 16384;
/** Set once a reaction has run for the first time */
var REACTION_RAN = 32768;
/** Effect is in the process of getting destroyed. Can be observed in child teardown functions */
var DESTROYING = 1 << 25;
/**
* 'Transparent' effects do not create a transition boundary.
* This is on a block effect 99% of the time but may also be on a branch effect if its parent block effect was pruned
*/
var EFFECT_TRANSPARENT = 65536;
var EFFECT_PRESERVED = 1 << 19;
var USER_EFFECT = 1 << 20;
var EFFECT_OFFSCREEN = 1 << 25;
/**
* Tells that we marked this derived and its reactions as visited during the "mark as (maybe) dirty"-phase.
* Will be lifted during execution of the derived and during checking its dirty state (both are necessary
* because a derived might be checked but not executed). This is a pure performance optimization flag and
* should not be used for any other purpose!
*/
var WAS_MARKED = 65536;
var REACTION_IS_UPDATING = 1 << 21;
var ASYNC = 1 << 22;
var ERROR_VALUE = 1 << 23;
var STATE_SYMBOL = Symbol("$state");
/** Marks component export objects, so that `proxy(...)` leaves them untouched */
var COMPONENT_SYMBOL = Symbol("component");
var LEGACY_PROPS = Symbol("legacy props");
var LOADING_ATTR_SYMBOL = Symbol("");
var ATTRIBUTES_CACHE = Symbol("attributes");
var CLASS_CACHE = Symbol("class");
var STYLE_CACHE = Symbol("style");
var TEXT_CACHE = Symbol("text");
var FORM_RESET_HANDLER = Symbol("form reset");
/** allow users to ignore aborted signal errors if `reason.name === 'StaleReactionError` */
var STALE_REACTION = new class StaleReactionError extends Error {
	name = "StaleReactionError";
	message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}();
var IS_XHTML = !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml");
//#endregion
//#region node_modules/svelte/src/constants.js
var HYDRATION_ERROR = {};
var UNINITIALIZED = Symbol("uninitialized");
var NAMESPACE_HTML = "http://www.w3.org/1999/xhtml";
/**
* Reading a derived belonging to a now-destroyed effect may result in stale values
*/
function derived_inert() {
	console.warn(`https://svelte.dev/e/derived_inert`);
}
/**
* Hydration failed because the initial UI does not match what was rendered on the server. The error occurred near %location%
* @param {string | undefined | null} [location]
*/
function hydration_mismatch(location) {
	console.warn(`https://svelte.dev/e/hydration_mismatch`);
}
/**
* The `value` property of a `<select multiple>` element should be an array, but it received a non-array value. The selection will be kept as is.
*/
function select_multiple_invalid_value() {
	console.warn(`https://svelte.dev/e/select_multiple_invalid_value`);
}
/**
* A `<svelte:boundary>` `reset` function only resets the boundary the first time it is called
*/
function svelte_boundary_reset_noop() {
	console.warn(`https://svelte.dev/e/svelte_boundary_reset_noop`);
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/hydration.js
/** @import { TemplateNode } from '#client' */
/**
* Use this variable to guard everything related to hydration code so it can be treeshaken out
* if the user doesn't use the `hydrate` method and these code paths are therefore not needed.
*/
var hydrating = false;
/** @param {boolean} value */
function set_hydrating(value) {
	hydrating = value;
}
/**
* The node that is currently being hydrated. This starts out as the first node inside the opening
* <!--[--> comment, and updates each time a component calls `$.child(...)` or `$.sibling(...)`.
* When entering a block (e.g. `{#if ...}`), `hydrate_node` is the block opening comment; by the
* time we leave the block it is the closing comment, which serves as the block's anchor.
* @type {TemplateNode}
*/
var hydrate_node;
/** @param {TemplateNode | null} node */
function set_hydrate_node(node) {
	if (node === null) {
		hydration_mismatch();
		throw HYDRATION_ERROR;
	}
	return hydrate_node = node;
}
function hydrate_next() {
	return set_hydrate_node(/* @__PURE__ */ get_next_sibling(hydrate_node));
}
/** @param {TemplateNode} node */
function reset(node) {
	if (!hydrating) return;
	if (/* @__PURE__ */ get_next_sibling(hydrate_node) !== null) {
		hydration_mismatch();
		throw HYDRATION_ERROR;
	}
	hydrate_node = node;
}
function next(count = 1) {
	if (hydrating) {
		var i = count;
		var node = hydrate_node;
		while (i--) node = /* @__PURE__ */ get_next_sibling(node);
		hydrate_node = node;
	}
}
/**
* Skips or removes (depending on {@link remove}) all nodes starting at `hydrate_node` up until the next hydration end comment
* @param {boolean} remove
*/
function skip_nodes(remove = true) {
	var depth = 0;
	var node = hydrate_node;
	while (true) {
		if (node.nodeType === 8) {
			var data = node.data;
			if (data === "]") {
				if (depth === 0) return node;
				depth -= 1;
			} else if (data === "[" || data === "[!" || data[0] === "[" && !isNaN(Number(data.slice(1)))) depth += 1;
		}
		var next = /* @__PURE__ */ get_next_sibling(node);
		if (remove) node.remove();
		node = next;
	}
}
/**
*
* @param {TemplateNode} node
*/
function read_hydration_instruction(node) {
	if (!node || node.nodeType !== 8) {
		hydration_mismatch();
		throw HYDRATION_ERROR;
	}
	return node.data;
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/equality.js
/** @import { Equals } from '#client' */
/** @type {Equals} */
function equals(value) {
	return value === this.v;
}
/**
* @param {unknown} a
* @param {unknown} b
* @returns {boolean}
*/
function safe_not_equal(a, b) {
	return a != a ? b == b : a !== b || a !== null && typeof a === "object" || typeof a === "function";
}
/** @type {Equals} */
function safe_equals(value) {
	return !safe_not_equal(value, this.v);
}
//#endregion
//#region node_modules/svelte/src/internal/client/errors.js
/**
* Cannot create a `$derived(...)` with an `await` expression outside of an effect tree
* @returns {never}
*/
function async_derived_orphan() {
	throw new Error(`https://svelte.dev/e/async_derived_orphan`);
}
/**
* Keyed each block has duplicate key `%value%` at indexes %a% and %b%
* @param {string} a
* @param {string} b
* @param {string | undefined | null} [value]
* @returns {never}
*/
function each_key_duplicate(a, b, value) {
	throw new Error(`https://svelte.dev/e/each_key_duplicate`);
}
/**
* `%rune%` cannot be used inside an effect cleanup function
* @param {string} rune
* @returns {never}
*/
function effect_in_teardown(rune) {
	throw new Error(`https://svelte.dev/e/effect_in_teardown`);
}
/**
* Effect cannot be created inside a `$derived` value that was not itself created inside an effect
* @returns {never}
*/
function effect_in_unowned_derived() {
	throw new Error(`https://svelte.dev/e/effect_in_unowned_derived`);
}
/**
* `%rune%` can only be used inside an effect (e.g. during component initialisation)
* @param {string} rune
* @returns {never}
*/
function effect_orphan(rune) {
	throw new Error(`https://svelte.dev/e/effect_orphan`);
}
/**
* Maximum update depth exceeded. This typically indicates that an effect reads and writes the same piece of state
* @returns {never}
*/
function effect_update_depth_exceeded() {
	throw new Error(`https://svelte.dev/e/effect_update_depth_exceeded`);
}
/**
* Cannot do `bind:%key%={undefined}` when `%key%` has a fallback value
* @param {string} key
* @returns {never}
*/
function props_invalid_value(key) {
	throw new Error(`https://svelte.dev/e/props_invalid_value`);
}
/**
* Property descriptors defined on `$state` objects must contain `value` and always be `enumerable`, `configurable` and `writable`.
* @returns {never}
*/
function state_descriptors_fixed() {
	throw new Error(`https://svelte.dev/e/state_descriptors_fixed`);
}
/**
* Cannot set prototype of `$state` object
* @returns {never}
*/
function state_prototype_fixed() {
	throw new Error(`https://svelte.dev/e/state_prototype_fixed`);
}
/**
* Updating state inside `$derived(...)`, `$inspect(...)` or a template expression is forbidden. If the value should not be reactive, declare it without `$state`
* @returns {never}
*/
function state_unsafe_mutation() {
	throw new Error(`https://svelte.dev/e/state_unsafe_mutation`);
}
/**
* A `<svelte:boundary>` `reset` function cannot be called while an error is still being handled
* @returns {never}
*/
function svelte_boundary_reset_onerror() {
	throw new Error(`https://svelte.dev/e/svelte_boundary_reset_onerror`);
}
//#endregion
//#region node_modules/svelte/src/internal/flags/index.js
/** True if experimental.async=true */
var async_mode_flag = false;
/** True if we're not certain that we only have Svelte 5 code in the compilation */
var legacy_mode_flag = false;
function enable_legacy_mode_flag() {
	legacy_mode_flag = true;
}
//#endregion
//#region node_modules/svelte/src/internal/client/context.js
/** @import { ComponentContext, DevStackEntry, Effect } from '#client' */
/** @type {ComponentContext | null} */
var component_context = null;
/** @param {ComponentContext | null} context */
function set_component_context(context) {
	component_context = context;
}
/**
* @param {Record<string, unknown>} props
* @param {any} runes
* @param {Function} [fn]
* @returns {void}
*/
function push(props, runes = false, fn) {
	component_context = {
		p: component_context,
		i: false,
		c: null,
		e: null,
		s: props,
		x: null,
		r: active_effect,
		l: legacy_mode_flag && !runes ? {
			s: null,
			u: null,
			$: []
		} : null
	};
}
/**
* @template {Record<string, any>} T
* @param {T} [component]
* @returns {T}
*/
function pop(component) {
	var context = component_context;
	var effects = context.e;
	if (effects !== null) {
		context.e = null;
		for (var fn of effects) create_user_effect(fn);
	}
	if (component !== void 0) context.x = component;
	context.i = true;
	component_context = context.p;
	return mark_as_component(component);
}
/**
* Add a symbol to the object (or create one if undefined) to mark it as a component so it isn't proxified.
* @param {any} component
*/
function mark_as_component(component = {}) {
	define_property(component, COMPONENT_SYMBOL, { value: true });
	return component;
}
/** @returns {boolean} */
function is_runes() {
	return !legacy_mode_flag || component_context !== null && component_context.l === null;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/task.js
/** @type {Array<() => void>} */
var micro_tasks = [];
function run_micro_tasks() {
	var tasks = micro_tasks;
	micro_tasks = [];
	run_all(tasks);
}
/**
* @param {() => void} fn
*/
function queue_micro_task(fn) {
	if (micro_tasks.length === 0 && !is_flushing_sync) {
		var tasks = micro_tasks;
		queueMicrotask(() => {
			if (tasks === micro_tasks) run_micro_tasks();
		});
	}
	micro_tasks.push(fn);
}
/**
* Synchronously run any queued tasks.
*/
function flush_tasks() {
	while (micro_tasks.length > 0) run_micro_tasks();
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/status.js
/** @import { Derived, Signal } from '#client' */
var STATUS_MASK = ~(DIRTY | MAYBE_DIRTY | CLEAN);
/**
* @param {Signal} signal
* @param {number} status
*/
function set_signal_status(signal, status) {
	signal.f = signal.f & STATUS_MASK | status;
}
/**
* Set a derived's status to CLEAN or MAYBE_DIRTY based on its connection state.
* @param {Derived} derived
*/
function update_derived_status(derived) {
	if ((derived.f & 512) !== 0 || derived.deps === null) set_signal_status(derived, CLEAN);
	else set_signal_status(derived, MAYBE_DIRTY);
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/utils.js
/** @import { Derived, Effect, Value } from '#client' */
/**
* @param {Value[] | null} deps
*/
function clear_marked(deps) {
	if (deps === null) return;
	for (const dep of deps) {
		if ((dep.f & 2) === 0 || (dep.f & 65536) === 0) continue;
		dep.f ^= WAS_MARKED;
		clear_marked(
			/** @type {Derived} */
			dep.deps
		);
	}
}
/**
* @param {Effect} effect
* @param {Set<Effect>} dirty_effects
* @param {Set<Effect>} maybe_dirty_effects
*/
function defer_effect(effect, dirty_effects, maybe_dirty_effects) {
	if ((effect.f & 2048) !== 0) dirty_effects.add(effect);
	else if ((effect.f & 4096) !== 0) maybe_dirty_effects.add(effect);
	clear_marked(effect.deps);
	set_signal_status(effect, CLEAN);
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/store.js
/**
* We set this to `true` when updating a store so that we correctly
* schedule effects if the update takes place inside a `$:` effect
*/
var legacy_is_updating_store = false;
/**
* Whether or not the prop currently being read is a store binding, as in
* `<Child bind:x={$y} />`. If it is, we treat the prop as mutable even in
* runes mode, and skip `binding_property_non_reactive` validation
*/
var is_store_binding = false;
/**
* Returns a tuple that indicates whether `fn()` reads a prop that is a store binding.
* Used to prevent `binding_property_non_reactive` validation false positives and
* ensure that these props are treated as mutable even in runes mode
* @template T
* @param {() => T} fn
* @returns {[T, boolean]}
*/
function capture_store_binding(fn) {
	var previous_is_store_binding = is_store_binding;
	try {
		is_store_binding = false;
		return [fn(), is_store_binding];
	} finally {
		is_store_binding = previous_is_store_binding;
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/misc.js
/**
* The child of a textarea actually corresponds to the defaultValue property, so we need
* to remove it upon hydration to avoid a bug when someone resets the form value.
* @param {HTMLTextAreaElement} dom
* @returns {void}
*/
function remove_textarea_child(dom) {
	if (hydrating && /* @__PURE__ */ get_first_child(dom) !== null) clear_text_content(dom);
}
var listening_to_form_reset = false;
function add_form_reset_listener() {
	if (!listening_to_form_reset) {
		listening_to_form_reset = true;
		document.addEventListener("reset", (evt) => {
			Promise.resolve().then(() => {
				if (!evt.defaultPrevented) for (const e of evt.target.elements)
 /** @type {any} */ e[FORM_RESET_HANDLER]?.();
			});
		}, { capture: true });
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/bindings/shared.js
/**
* @template T
* @param {() => T} fn
*/
function without_reactive_context(fn) {
	var previous_reaction = active_reaction;
	var previous_effect = active_effect;
	set_active_reaction(null);
	set_active_effect(null);
	try {
		return fn();
	} finally {
		set_active_reaction(previous_reaction);
		set_active_effect(previous_effect);
	}
}
/**
* Listen to the given event, and then instantiate a global form reset listener if not already done,
* to notify all bindings when the form is reset
* @param {HTMLElement} element
* @param {string} event
* @param {(is_reset?: true) => void} handler
* @param {(is_reset?: true) => void} [on_reset]
*/
function listen_to_event_and_reset_event(element, event, handler, on_reset = handler) {
	element.addEventListener(event, () => without_reactive_context(handler));
	const prev = element[FORM_RESET_HANDLER];
	if (prev)
 /** @type {any} */ element[FORM_RESET_HANDLER] = () => {
		prev();
		on_reset(true);
	};
	else
 /** @type {any} */ element[FORM_RESET_HANDLER] = () => on_reset(true);
	add_form_reset_listener();
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/async.js
/** @import { Blocker, Effect, Source, Value } from '#client' */
/**
* @param {Blocker[]} blockers
* @param {Array<() => any>} sync
* @param {Array<() => Promise<any>>} async
* @param {(values: Value[]) => any} fn
*/
function flatten(blockers, sync, async, fn) {
	const d = is_runes() ? derived : derived_safe_equal;
	var pending = blockers.filter((b) => !b.settled);
	var deriveds = sync.map(d);
	if (async.length === 0 && pending.length === 0) {
		fn(deriveds);
		return;
	}
	var parent = active_effect;
	var restore = capture();
	var blocker_promise = pending.length === 1 ? pending[0].promise : pending.length > 1 ? Promise.all(pending.map((b) => b.promise)) : null;
	/**
	* @param {Source[]} async
	*/
	function finish(async) {
		if ((parent.f & 16384) !== 0) return;
		restore();
		try {
			fn([...deriveds, ...async]);
		} catch (error) {
			invoke_error_boundary(error, parent);
		}
		unset_context();
	}
	var decrement_pending = increment_pending();
	if (async.length === 0) {
		/** @type {Promise<any>} */ blocker_promise.then(() => finish([])).finally(decrement_pending);
		return;
	}
	function run() {
		Promise.all(async.map((expression) => /* @__PURE__ */ async_derived(expression))).then(finish).catch((error) => invoke_error_boundary(error, parent)).finally(decrement_pending);
	}
	if (blocker_promise) blocker_promise.then(() => {
		restore();
		run();
		unset_context();
	});
	else run();
}
/**
* Captures the current effect context so that we can restore it after
* some asynchronous work has happened (so that e.g. `await a + b`
* causes `b` to be registered as a dependency).
*/
function capture() {
	var previous_effect = active_effect;
	var previous_reaction = active_reaction;
	var previous_component_context = component_context;
	var previous_batch = current_batch;
	return function restore(activate_batch = true) {
		set_active_effect(previous_effect);
		set_active_reaction(previous_reaction);
		set_component_context(previous_component_context);
		if (activate_batch && (previous_effect.f & 16384) === 0) {
			previous_batch?.activate();
			previous_batch?.apply();
		}
	};
}
function unset_context(deactivate_batch = true) {
	set_active_effect(null);
	set_active_reaction(null);
	set_component_context(null);
	if (deactivate_batch) current_batch?.deactivate();
}
/**
* @returns {(skip?: boolean) => void}
*/
function increment_pending() {
	var effect = active_effect;
	var boundary = effect.b;
	var batch = current_batch;
	var blocking = !!boundary?.is_rendered();
	boundary?.update_pending_count(1, batch);
	batch.increment(blocking, effect);
	return () => {
		boundary?.update_pending_count(-1, batch);
		batch.decrement(blocking, effect);
	};
}
/**
* @template V
* @param {() => V} fn
* @returns {Derived<V>}
*/
/*#__NO_SIDE_EFFECTS__*/
function derived(fn) {
	var flags = 2 | DIRTY;
	if (active_effect !== null) active_effect.f |= EFFECT_PRESERVED;
	return {
		ctx: component_context,
		deps: null,
		effects: null,
		equals,
		f: flags,
		fn,
		reactions: null,
		rv: 0,
		v: UNINITIALIZED,
		wv: 0,
		parent: active_effect,
		ac: null
	};
}
var OBSOLETE = Symbol("obsolete");
/**
* @template V
* @param {() => V | Promise<V>} fn
* @param {string} [label]
* @param {string} [location] If provided, print a warning if the value is not read immediately after update
* @returns {Promise<Source<V>>}
*/
/*#__NO_SIDE_EFFECTS__*/
function async_derived(fn, label, location) {
	let parent = active_effect;
	if (parent === null) async_derived_orphan();
	var promise = void 0;
	var signal = source(UNINITIALIZED);
	var should_suspend = !active_reaction;
	/** @type {Set<ReturnType<typeof deferred<V>>>} */
	var deferreds = /* @__PURE__ */ new Set();
	async_effect(() => {
		var effect = active_effect;
		/** @type {ReturnType<typeof deferred<V>>} */
		var d = deferred();
		promise = d.promise;
		try {
			Promise.resolve(fn()).then(d.resolve, (e) => {
				if (e !== STALE_REACTION) d.reject(e);
			}).finally(unset_context);
		} catch (error) {
			d.reject(error);
			unset_context();
		}
		var batch = current_batch;
		if (should_suspend) {
			if ((effect.f & 32768) !== 0) var decrement_pending = increment_pending();
			if (parent.b?.is_rendered()) batch.async_deriveds.get(effect)?.reject(OBSOLETE);
			else for (const d of deferreds.values()) d.reject(OBSOLETE);
			deferreds.add(d);
			batch.async_deriveds.set(effect, d);
		}
		/**
		* @param {any} value
		* @param {unknown} error
		*/
		const handler = (value, error = void 0) => {
			decrement_pending?.();
			deferreds.delete(d);
			if (error === OBSOLETE) return;
			batch.activate();
			if (error) {
				signal.f |= ERROR_VALUE;
				internal_set(signal, error);
			} else {
				if ((signal.f & 8388608) !== 0) signal.f ^= ERROR_VALUE;
				internal_set(signal, value);
			}
			batch.deactivate();
		};
		d.promise.then(handler, (e) => handler(null, e || "unknown"));
	});
	teardown(() => {
		for (const d of deferreds) d.reject(OBSOLETE);
	});
	return new Promise((fulfil) => {
		/** @param {Promise<V>} p */
		function next(p) {
			function go() {
				if (p === promise) fulfil(signal);
				else next(promise);
			}
			p.then(go, go);
		}
		next(promise);
	});
}
/**
* @template V
* @param {() => V} fn
* @returns {Derived<V>}
*/
/*#__NO_SIDE_EFFECTS__*/
function user_derived(fn) {
	const d = /* @__PURE__ */ derived(fn);
	if (!async_mode_flag) push_reaction_value(d);
	return d;
}
/**
* @template V
* @param {() => V} fn
* @returns {Derived<V>}
*/
/*#__NO_SIDE_EFFECTS__*/
function derived_safe_equal(fn) {
	const signal = /* @__PURE__ */ derived(fn);
	signal.equals = safe_equals;
	return signal;
}
/**
* @param {Derived} derived
* @returns {void}
*/
function destroy_derived_effects(derived) {
	var effects = derived.effects;
	if (effects !== null) {
		derived.effects = null;
		for (var i = 0; i < effects.length; i += 1) destroy_effect(effects[i]);
	}
}
/**
* @template T
* @param {Derived} derived
* @returns {T}
*/
function execute_derived(derived) {
	var value;
	var prev_active_effect = active_effect;
	var parent = derived.parent;
	if (!is_destroying_effect && parent !== null && derived.v !== UNINITIALIZED && (parent.f & 24576) !== 0) {
		derived_inert();
		return derived.v;
	}
	set_active_effect(parent);
	try {
		derived.f &= ~WAS_MARKED;
		destroy_derived_effects(derived);
		value = update_reaction(derived);
	} finally {
		set_active_effect(prev_active_effect);
	}
	return value;
}
/**
* @param {Derived} derived
* @returns {void}
*/
function update_derived(derived) {
	var value = execute_derived(derived);
	if (!derived.equals(value)) {
		derived.wv = increment_write_version();
		if (!current_batch?.is_fork || derived.deps === null) {
			if (current_batch !== null) {
				current_batch.capture(derived, value, true);
				previous_batch?.capture(derived, value, true);
			} else derived.v = value;
			if (derived.deps === null) {
				set_signal_status(derived, CLEAN);
				return;
			}
		}
	}
	if (is_destroying_effect) return;
	if (batch_values !== null) {
		if (effect_tracking() || current_batch?.is_fork) batch_values.set(derived, value);
	} else update_derived_status(derived);
}
/**
* @param {Derived} derived
*/
function freeze_derived_effects(derived) {
	if (derived.effects === null) return;
	for (const e of derived.effects) if (e.teardown || e.ac) {
		e.teardown?.();
		if (e.ac !== null) without_reactive_context(() => {
			/** @type {AbortController} */ e.ac.abort(STALE_REACTION);
			e.ac = null;
		});
		if (e.fn !== null) e.teardown = noop;
		remove_reactions(e, 0);
		destroy_effect_children(e);
	}
}
/**
* @param {Derived} derived
*/
function unfreeze_derived_effects(derived) {
	if (derived.effects === null) return;
	for (const e of derived.effects) if (e.teardown && e.fn !== null) update_effect(e);
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/batch.js
/** @import { Fork } from 'svelte' */
/** @import { Derived, Effect, Reaction, Source, Value } from '#client' */
/** @type {Batch | null} */
var first_batch = null;
/** @type {Batch | null} */
var last_batch = null;
/** @type {Batch | null} */
var current_batch = null;
/**
* This is needed to avoid overwriting inputs
* @type {Batch | null}
*/
var previous_batch = null;
/**
* When time travelling (i.e. working in one batch, while other batches
* still have ongoing work), we ignore the real values of affected
* signals in favour of their values within the batch
* @type {Map<Value, any> | null}
*/
var batch_values = null;
/** @type {Effect | null} */
var last_scheduled_effect = null;
var is_flushing_sync = false;
var is_processing = false;
/**
* During traversal, this is an array. Newly created effects are (if not immediately
* executed) pushed to this array, rather than going through the scheduling
* rigamarole that would cause another turn of the flush loop.
* @type {Effect[] | null}
*/
var collected_effects = null;
/**
* An array of effects that are marked during traversal as a result of a `set`
* (not `internal_set`) call. These will be added to the next batch and
* trigger another `batch.process()`
* @type {Effect[] | null}
* @deprecated when we get rid of legacy mode and stores, we can get rid of this
*/
var legacy_updates = null;
var flush_count = 0;
var uid = 1;
var Batch = class Batch {
	id = uid++;
	/** True as soon as `#process` was called */
	#started = false;
	linked = true;
	/** @type {Batch | null} */
	#prev = null;
	/** @type {Batch | null} */
	#next = null;
	/** @type {Map<Effect, ReturnType<typeof deferred<any>>>} */
	async_deriveds = /* @__PURE__ */ new Map();
	/**
	* The current values of any signals that are updated in this batch.
	* Tuple format: [value, is_derived] (note: is_derived is false for deriveds, too, if they were overridden via assignment)
	* They keys of this map are identical to `this.#previous`
	* @type {Map<Value, [any, boolean]>}
	*/
	current = /* @__PURE__ */ new Map();
	/**
	* The values of any signals (sources and deriveds) that are updated in this batch _before_ those updates took place.
	* They keys of this map are identical to `this.#current`
	* @type {Map<Value, any>}
	*/
	previous = /* @__PURE__ */ new Map();
	/**
	* When the batch is committed (and the DOM is updated), we need to remove old branches
	* and append new ones by calling the functions added inside (if/each/key/etc) blocks
	* @type {Set<(batch: Batch) => void>}
	*/
	#commit_callbacks = /* @__PURE__ */ new Set();
	/**
	* If a fork is discarded, we need to destroy any effects that are no longer needed
	* @type {Set<(batch: Batch) => void>}
	*/
	#discard_callbacks = /* @__PURE__ */ new Set();
	/**
	* The number of async effects that are currently in flight
	*/
	#pending = 0;
	/**
	* Async effects that are currently in flight, _not_ inside a pending boundary
	* @type {Map<Effect, number>}
	*/
	#blocking_pending = /* @__PURE__ */ new Map();
	/**
	* A deferred that resolves when the batch is committed, used with `settled()`
	* TODO replace with Promise.withResolvers once supported widely enough
	* @type {{ promise: Promise<void>, resolve: (value?: any) => void, reject: (reason: unknown) => void } | null}
	*/
	#deferred = null;
	/**
	* The root effects that need to be flushed
	* @type {Effect[]}
	*/
	#roots = [];
	/**
	* Effects created while this batch was active.
	* @type {Effect[]}
	*/
	#new_effects = [];
	/**
	* Deferred effects (which run after async work has completed) that are DIRTY
	* @type {Set<Effect>}
	*/
	#dirty_effects = /* @__PURE__ */ new Set();
	/**
	* Deferred effects that are MAYBE_DIRTY
	* @type {Set<Effect>}
	*/
	#maybe_dirty_effects = /* @__PURE__ */ new Set();
	/**
	* A map of branches that still exist, but will be destroyed when this batch
	* is committed — we skip over these during `process`.
	* The value contains child effects that were dirty/maybe_dirty before being reset,
	* so they can be rescheduled if the branch survives.
	* @type {Map<Effect, { d: Effect[], m: Effect[] }>}
	*/
	#skipped_branches = /* @__PURE__ */ new Map();
	/**
	* Inverse of #skipped_branches which we need to tell prior batches to unskip them when committing
	* @type {Set<Effect>}
	*/
	#unskipped_branches = /* @__PURE__ */ new Set();
	is_fork = false;
	#decrement_queued = false;
	constructor() {
		if (last_batch === null) first_batch = last_batch = this;
		else {
			last_batch.#next = this;
			this.#prev = last_batch;
		}
		last_batch = this;
	}
	#is_deferred() {
		if (this.is_fork) return true;
		for (const effect of this.#blocking_pending.keys()) {
			var e = effect;
			var skipped = false;
			while (e.parent !== null) {
				if (this.#skipped_branches.has(e)) {
					skipped = true;
					break;
				}
				e = e.parent;
			}
			if (!skipped) return true;
		}
		return false;
	}
	/**
	* Add an effect to the #skipped_branches map and reset its children
	* @param {Effect} effect
	*/
	skip_effect(effect) {
		if (!this.#skipped_branches.has(effect)) this.#skipped_branches.set(effect, {
			d: [],
			m: []
		});
		this.#unskipped_branches.delete(effect);
	}
	/**
	* Remove an effect from the #skipped_branches map and reschedule
	* any tracked dirty/maybe_dirty child effects
	* @param {Effect} effect
	* @param {(e: Effect) => void} callback
	*/
	unskip_effect(effect, callback = (e) => this.schedule(e)) {
		var tracked = this.#skipped_branches.get(effect);
		if (tracked) {
			this.#skipped_branches.delete(effect);
			for (var e of tracked.d) {
				set_signal_status(e, DIRTY);
				callback(e);
			}
			for (e of tracked.m) {
				set_signal_status(e, MAYBE_DIRTY);
				callback(e);
			}
		}
		this.#unskipped_branches.add(effect);
	}
	#process() {
		this.#started = true;
		if (flush_count++ > 1e3) {
			this.#unlink();
			infinite_loop_guard();
		}
		for (const e of this.#dirty_effects) {
			this.#maybe_dirty_effects.delete(e);
			set_signal_status(e, DIRTY);
			this.schedule(e);
		}
		for (const e of this.#maybe_dirty_effects) {
			set_signal_status(e, MAYBE_DIRTY);
			this.schedule(e);
		}
		const roots = this.#roots;
		this.#roots = [];
		this.apply();
		/** @type {Effect[]} */
		var effects = collected_effects = [];
		/** @type {Effect[]} */
		var render_effects = [];
		/**
		* @type {Effect[]}
		* @deprecated when we get rid of legacy mode and stores, we can get rid of this
		*/
		var updates = legacy_updates = [];
		for (const root of roots) try {
			this.#traverse(root, effects, render_effects);
		} catch (e) {
			reset_all(root);
			if (!this.#is_deferred()) this.discard();
			throw e;
		}
		current_batch = null;
		if (updates.length > 0) {
			var batch = Batch.ensure();
			for (const e of updates) batch.schedule(e);
		}
		collected_effects = null;
		legacy_updates = null;
		if (this.#is_deferred()) {
			this.#defer_effects(render_effects);
			this.#defer_effects(effects);
			for (const [e, t] of this.#skipped_branches) reset_branch(e, t);
			if (updates.length > 0)
 /** @type {Batch} */ current_batch.#process();
			return;
		}
		const earlier_batch = this.#find_earlier_batch();
		if (earlier_batch) {
			this.#defer_effects(render_effects);
			this.#defer_effects(effects);
			earlier_batch.#merge(this);
			return;
		}
		this.#dirty_effects.clear();
		this.#maybe_dirty_effects.clear();
		for (const fn of this.#commit_callbacks) fn(this);
		this.#commit_callbacks.clear();
		previous_batch = this;
		flush_queued_effects(render_effects);
		flush_queued_effects(effects);
		previous_batch = null;
		this.#deferred?.resolve();
		var next_batch = current_batch;
		if (this.#pending === 0 && (this.#roots.length === 0 || next_batch !== null)) {
			this.#unlink();
			if (async_mode_flag) {
				this.#commit();
				current_batch = next_batch;
			}
		}
		if (this.#roots.length > 0) {
			if (next_batch !== null) {
				const batch = next_batch;
				batch.#roots.push(...this.#roots.filter((r) => !batch.#roots.includes(r)));
			} else next_batch = this;
		}
		if (next_batch !== null) {
			old_values.clear();
			next_batch.#process();
		}
	}
	/**
	* Traverse the effect tree, executing effects or stashing
	* them for later execution as appropriate
	* @param {Effect} root
	* @param {Effect[]} effects
	* @param {Effect[]} render_effects
	*/
	#traverse(root, effects, render_effects) {
		root.f ^= CLEAN;
		var effect = root.first;
		while (effect !== null) {
			var flags = effect.f;
			var is_branch = (flags & 96) !== 0;
			if (!(is_branch && (flags & 1024) !== 0 || (flags & 8192) !== 0 || this.#skipped_branches.has(effect)) && effect.fn !== null) {
				if (is_branch) effect.f ^= CLEAN;
				else if ((flags & 4) !== 0) effects.push(effect);
				else if (async_mode_flag && (flags & 16777224) !== 0) render_effects.push(effect);
				else if (is_dirty(effect)) {
					if ((flags & 16) !== 0) this.#maybe_dirty_effects.add(effect);
					update_effect(effect);
				}
				var child = effect.first;
				if (child !== null) {
					effect = child;
					continue;
				}
			}
			while (effect !== null) {
				var next = effect.next;
				if (next !== null) {
					effect = next;
					break;
				}
				effect = effect.parent;
			}
		}
	}
	#find_earlier_batch() {
		var batch = this.#prev;
		while (batch !== null) {
			if (!batch.is_fork) {
				for (const [value, [, is_derived]] of this.current) if (batch.current.has(value) && !is_derived) return batch;
			}
			batch = batch.#prev;
		}
		return null;
	}
	/**
	* @param {Batch} batch
	*/
	#merge(batch) {
		for (const [source, value] of batch.current) {
			if (!this.previous.has(source) && batch.previous.has(source)) this.previous.set(source, batch.previous.get(source));
			this.current.set(source, value);
		}
		for (const [effect, deferred] of batch.async_deriveds) {
			const d = this.async_deriveds.get(effect);
			if (d) deferred.promise.then(d.resolve).catch(d.reject);
		}
		batch.async_deriveds.clear();
		this.transfer_effects(batch.#dirty_effects, batch.#maybe_dirty_effects);
		/**
		* mark all effects that depend on `batch.current`, except the
		* async effects that we just resolved (TODO unless they depend
		* on values in this batch that are NOT in the later batch?).
		* Through this we also will populate the correct #skipped_branches,
		* oncommit callbacks etc, so we don't need to merge them separately.
		* @param {Value} value
		*/
		const mark = (value) => {
			var reactions = value.reactions;
			if (reactions === null) return;
			if ((value.f & 2) !== 0 && (value.f & 6144) === 0) return;
			for (const reaction of reactions) {
				var flags = reaction.f;
				if ((flags & 2) !== 0) mark(reaction);
				else {
					var effect = reaction;
					if (flags & 4194320 && !this.async_deriveds.has(effect)) {
						this.#maybe_dirty_effects.delete(effect);
						set_signal_status(effect, DIRTY);
						this.schedule(effect);
					}
				}
			}
		};
		for (const source of this.current.keys()) mark(source);
		this.oncommit(() => batch.discard());
		batch.#unlink();
		current_batch = this;
		this.#process();
	}
	/**
	* @param {Effect[]} effects
	*/
	#defer_effects(effects) {
		for (var i = 0; i < effects.length; i += 1) defer_effect(effects[i], this.#dirty_effects, this.#maybe_dirty_effects);
	}
	/**
	* Associate a change to a given source with the current
	* batch, noting its previous and current values
	* @param {Value} source
	* @param {any} value
	* @param {boolean} [is_derived]
	*/
	capture(source, value, is_derived = false) {
		if (source.v !== UNINITIALIZED && !this.previous.has(source)) this.previous.set(source, source.v);
		if ((source.f & 8388608) === 0) {
			this.current.set(source, [value, is_derived]);
			batch_values?.set(source, value);
		}
		if (!this.is_fork) source.v = value;
	}
	activate() {
		current_batch = this;
	}
	deactivate() {
		current_batch = null;
		batch_values = null;
	}
	flush() {
		try {
			is_processing = true;
			current_batch = this;
			this.#process();
		} finally {
			flush_count = 0;
			last_scheduled_effect = null;
			collected_effects = null;
			legacy_updates = null;
			is_processing = false;
			current_batch = null;
			batch_values = null;
			old_values.clear();
		}
	}
	discard() {
		for (const fn of this.#discard_callbacks) fn(this);
		this.#discard_callbacks.clear();
		for (const deferred of this.async_deriveds.values()) deferred.reject(OBSOLETE);
		this.#unlink();
		this.#deferred?.resolve();
	}
	/**
	* @param {Effect} effect
	*/
	register_created_effect(effect) {
		this.#new_effects.push(effect);
	}
	#commit() {
		for (let batch = first_batch; batch !== null; batch = batch.#next) {
			var is_earlier = batch.id < this.id;
			/** @type {Source[]} */
			var sources = [];
			for (const [source, [value, is_derived]] of this.current) {
				if (batch.current.has(source)) {
					var batch_value = batch.current.get(source)[0];
					if (is_earlier && value !== batch_value) batch.current.set(source, [value, is_derived]);
					else continue;
				}
				sources.push(source);
			}
			if (is_earlier) for (const [effect, deferred] of this.async_deriveds) {
				const d = batch.async_deriveds.get(effect);
				if (d) deferred.promise.then(d.resolve).catch(d.reject);
			}
			var current = [...batch.current.keys()].filter((source) => !batch.current.get(source)[1]);
			if (!batch.#started || current.length === 0) continue;
			var others = current.filter((source) => !this.current.has(source));
			if (others.length === 0) {
				if (is_earlier) batch.discard();
			} else if (sources.length > 0) {
				if (is_earlier) for (const unskipped of this.#unskipped_branches) batch.unskip_effect(unskipped, (e) => {
					if ((e.f & 4194320) !== 0) batch.schedule(e);
					else batch.#defer_effects([e]);
				});
				batch.activate();
				/** @type {Set<Value>} */
				var marked = /* @__PURE__ */ new Set();
				/** @type {Map<Reaction, boolean>} */
				var checked = /* @__PURE__ */ new Map();
				for (var source of sources) mark_effects(source, others, marked, checked);
				checked = /* @__PURE__ */ new Map();
				var current_unequal = [...batch.current].filter(([c, v1]) => {
					const v2 = this.current.get(c);
					if (!v2) return true;
					return v2[0] !== v1[0] || v2[1] !== v1[1];
				}).map(([c]) => c);
				if (current_unequal.length > 0) {
					for (const effect of this.#new_effects) if ((effect.f & 155648) === 0 && depends_on(effect, current_unequal, checked)) {
						if ((effect.f & 4194320) !== 0) {
							set_signal_status(effect, DIRTY);
							batch.schedule(effect);
						} else batch.#dirty_effects.add(effect);
					}
				}
				if (batch.#roots.length > 0 && !batch.#decrement_queued) {
					batch.apply();
					for (var root of batch.#roots) batch.#traverse(root, [], []);
					batch.#roots = [];
				}
				batch.deactivate();
			}
		}
	}
	/**
	* @param {boolean} blocking
	* @param {Effect} effect
	*/
	increment(blocking, effect) {
		this.#pending += 1;
		if (blocking) {
			let blocking_pending_count = this.#blocking_pending.get(effect) ?? 0;
			this.#blocking_pending.set(effect, blocking_pending_count + 1);
		}
	}
	/**
	* @param {boolean} blocking
	* @param {Effect} effect
	*/
	decrement(blocking, effect) {
		this.#pending -= 1;
		if (blocking) {
			let blocking_pending_count = this.#blocking_pending.get(effect) ?? 0;
			if (blocking_pending_count === 1) this.#blocking_pending.delete(effect);
			else this.#blocking_pending.set(effect, blocking_pending_count - 1);
		}
		if (this.#decrement_queued) return;
		this.#decrement_queued = true;
		queue_micro_task(() => {
			this.#decrement_queued = false;
			if (this.linked) this.flush();
		});
	}
	/**
	* @param {Set<Effect>} dirty_effects
	* @param {Set<Effect>} maybe_dirty_effects
	*/
	transfer_effects(dirty_effects, maybe_dirty_effects) {
		for (const e of dirty_effects) this.#dirty_effects.add(e);
		for (const e of maybe_dirty_effects) this.#maybe_dirty_effects.add(e);
		dirty_effects.clear();
		maybe_dirty_effects.clear();
	}
	/** @param {(batch: Batch) => void} fn */
	oncommit(fn) {
		this.#commit_callbacks.add(fn);
	}
	/** @param {(batch: Batch) => void} fn */
	ondiscard(fn) {
		this.#discard_callbacks.add(fn);
	}
	settled() {
		return (this.#deferred ??= deferred()).promise;
	}
	static ensure() {
		if (current_batch === null) {
			const batch = current_batch = new Batch();
			if (!is_processing && !is_flushing_sync) queue_micro_task(() => {
				if (!batch.#started) batch.flush();
			});
		}
		return current_batch;
	}
	apply() {
		if (!async_mode_flag || !this.is_fork && this.#prev === null && this.#next === null) {
			batch_values = null;
			return;
		}
		batch_values = /* @__PURE__ */ new Map();
		for (const [source, [value]] of this.current) batch_values.set(source, value);
		for (let batch = first_batch; batch !== null; batch = batch.#next) {
			if (batch === this || batch.is_fork) continue;
			var intersects = false;
			if (batch.id < this.id) for (const [source, [, is_derived]] of batch.current) {
				if (is_derived) continue;
				if (this.current.has(source)) {
					intersects = true;
					break;
				}
			}
			if (!intersects) {
				for (const [source, previous] of batch.previous) if (!batch_values.has(source)) batch_values.set(source, previous);
			}
		}
	}
	/**
	*
	* @param {Effect} effect
	*/
	schedule(effect) {
		last_scheduled_effect = effect;
		if (effect.b?.is_pending && (effect.f & 16777228) !== 0 && (effect.f & 32768) === 0) {
			effect.b.defer_effect(effect);
			return;
		}
		var e = effect;
		while (e.parent !== null) {
			e = e.parent;
			var flags = e.f;
			if (collected_effects !== null && e === active_effect) {
				if (async_mode_flag) return;
				if ((active_reaction === null || (active_reaction.f & 2) === 0) && !legacy_is_updating_store) return;
			}
			if ((flags & 96) !== 0) {
				if ((flags & 1024) === 0) return;
				e.f ^= CLEAN;
			}
		}
		this.#roots.push(e);
	}
	#unlink() {
		if (!this.linked) return;
		var prev = this.#prev;
		var next = this.#next;
		if (prev === null) first_batch = next;
		else prev.#next = next;
		if (next === null) last_batch = prev;
		else next.#prev = prev;
		this.linked = false;
	}
};
/**
* Synchronously flush any pending updates.
* Returns void if no callback is provided, otherwise returns the result of calling the callback.
* @template [T=void]
* @param {(() => T) | undefined} [fn]
* @returns {T}
*/
function flushSync(fn) {
	var was_flushing_sync = is_flushing_sync;
	is_flushing_sync = true;
	try {
		var result;
		if (fn) {
			if (current_batch !== null && !current_batch.is_fork) current_batch.flush();
			result = fn();
		}
		while (true) {
			flush_tasks();
			if (current_batch === null) return result;
			current_batch.flush();
		}
	} finally {
		is_flushing_sync = was_flushing_sync;
	}
}
function infinite_loop_guard() {
	try {
		effect_update_depth_exceeded();
	} catch (error) {
		invoke_error_boundary(error, last_scheduled_effect);
	}
}
/** @type {Set<Effect> | null} */
var eager_block_effects = null;
/**
* @param {Array<Effect>} effects
* @returns {void}
*/
function flush_queued_effects(effects) {
	var length = effects.length;
	if (length === 0) return;
	var i = 0;
	while (i < length) {
		var effect = effects[i++];
		if ((effect.f & 24576) === 0 && is_dirty(effect)) {
			eager_block_effects = /* @__PURE__ */ new Set();
			update_effect(effect);
			if (effect.deps === null && effect.first === null && effect.nodes === null && effect.teardown === null && effect.ac === null) unlink_effect(effect);
			if (eager_block_effects?.size > 0) {
				old_values.clear();
				for (const e of eager_block_effects) {
					if ((e.f & 24576) !== 0) continue;
					/** @type {Effect[]} */
					const ordered_effects = [e];
					let ancestor = e.parent;
					while (ancestor !== null) {
						if (eager_block_effects.has(ancestor)) {
							eager_block_effects.delete(ancestor);
							ordered_effects.push(ancestor);
						}
						ancestor = ancestor.parent;
					}
					for (let j = ordered_effects.length - 1; j >= 0; j--) {
						const e = ordered_effects[j];
						if ((e.f & 24576) !== 0) continue;
						update_effect(e);
					}
				}
				eager_block_effects.clear();
			}
		}
	}
	eager_block_effects = null;
}
/**
* This is similar to `mark_reactions`, but it only marks async/block effects
* depending on `value` and at least one of the other `sources`, so that
* these effects can re-run after another batch has been committed
* @param {Value} value
* @param {Source[]} sources
* @param {Set<Value>} marked
* @param {Map<Reaction, boolean>} checked
*/
function mark_effects(value, sources, marked, checked) {
	if (marked.has(value)) return;
	marked.add(value);
	if (value.reactions !== null) for (const reaction of value.reactions) {
		const flags = reaction.f;
		if ((flags & 2) !== 0) mark_effects(reaction, sources, marked, checked);
		else if ((flags & 4194320) !== 0 && (flags & 2048) === 0 && depends_on(reaction, sources, checked)) {
			set_signal_status(reaction, DIRTY);
			schedule_effect(reaction);
		}
	}
}
/**
* @param {Reaction} reaction
* @param {Source[]} sources
* @param {Map<Reaction, boolean>} checked
*/
function depends_on(reaction, sources, checked) {
	const depends = checked.get(reaction);
	if (depends !== void 0) return depends;
	if (reaction.deps !== null) for (const dep of reaction.deps) {
		if (includes.call(sources, dep)) return true;
		if ((dep.f & 2) !== 0 && depends_on(dep, sources, checked)) {
			checked.set(dep, true);
			return true;
		}
	}
	checked.set(reaction, false);
	return false;
}
/**
* @param {Effect} effect
* @returns {void}
*/
function schedule_effect(effect) {
	/** @type {Batch} */ current_batch.schedule(effect);
}
/**
* Mark all the effects inside a skipped branch CLEAN, so that
* they can be correctly rescheduled later. Tracks dirty and maybe_dirty
* effects so they can be rescheduled if the branch survives.
* @param {Effect} effect
* @param {{ d: Effect[], m: Effect[] }} tracked
*/
function reset_branch(effect, tracked) {
	if ((effect.f & 32) !== 0 && (effect.f & 1024) !== 0) return;
	if ((effect.f & 2048) !== 0) tracked.d.push(effect);
	else if ((effect.f & 4096) !== 0) tracked.m.push(effect);
	set_signal_status(effect, CLEAN);
	var e = effect.first;
	while (e !== null) {
		reset_branch(e, tracked);
		e = e.next;
	}
}
/**
* Mark an entire effect tree clean following an error
* @param {Effect} effect
*/
function reset_all(effect) {
	set_signal_status(effect, CLEAN);
	var e = effect.first;
	while (e !== null) {
		reset_all(e);
		e = e.next;
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/sources.js
/** @import { Derived, Effect, Source, Value } from '#client' */
/** @type {Set<Effect>} */
var eager_effects = /* @__PURE__ */ new Set();
/** @type {Map<Source, any>} */
var old_values = /* @__PURE__ */ new Map();
var eager_effects_deferred = false;
/**
* @template V
* @param {V} v
* @param {Error | null} [stack]
* @returns {Source<V>}
*/
function source(v, stack) {
	return {
		f: 0,
		v,
		reactions: null,
		equals,
		rv: 0,
		wv: 0
	};
}
/**
* @template V
* @param {V} v
* @param {Error | null} [stack]
*/
/*#__NO_SIDE_EFFECTS__*/
function state(v, stack) {
	const s = source(v, stack);
	push_reaction_value(s);
	return s;
}
/**
* @template V
* @param {V} initial_value
* @param {boolean} [immutable]
* @returns {Source<V>}
*/
/*#__NO_SIDE_EFFECTS__*/
function mutable_source(initial_value, immutable = false, trackable = true) {
	const s = source(initial_value);
	if (!immutable) s.equals = safe_equals;
	if (legacy_mode_flag && trackable && component_context !== null && component_context.l !== null) (component_context.l.s ??= []).push(s);
	return s;
}
/**
* @template V
* @param {Value<V>} source
* @param {V} value
*/
function mutate(source, value) {
	set(source, untrack(() => get(source)));
	return value;
}
/**
* @template V
* @param {Source<V>} source
* @param {V} value
* @param {boolean} [should_proxy]
* @returns {V}
*/
function set(source, value, should_proxy = false) {
	if (active_reaction !== null && (!untracking || (active_reaction.f & 131072) !== 0) && is_runes() && (active_reaction.f & 4325394) !== 0 && (current_sources === null || !current_sources.has(source))) state_unsafe_mutation();
	return internal_set(source, should_proxy ? proxy(value) : value, legacy_updates);
}
/**
* @template V
* @param {Source<V>} source
* @param {V} value
* @param {Effect[] | null} [updated_during_traversal]
* @returns {V}
*/
function internal_set(source, value, updated_during_traversal = null) {
	if (!source.equals(value)) {
		if (is_destroying_effect) old_values.set(source, value);
		else if (!old_values.has(source)) old_values.set(source, source.v);
		var batch = Batch.ensure();
		batch.capture(source, value);
		if ((source.f & 2) !== 0) {
			const derived = source;
			if ((source.f & 2048) !== 0) execute_derived(derived);
			if (batch_values === null) update_derived_status(derived);
		}
		source.wv = increment_write_version();
		mark_reactions(source, DIRTY, updated_during_traversal);
		if (is_runes() && active_effect !== null && (active_effect.f & 1024) !== 0 && (active_effect.f & 96) === 0) {
			if (untracked_writes === null) set_untracked_writes([source]);
			else untracked_writes.push(source);
		}
		if (!batch.is_fork && eager_effects.size > 0 && !eager_effects_deferred) flush_eager_effects();
	}
	return value;
}
function flush_eager_effects() {
	eager_effects_deferred = false;
	for (const effect of eager_effects) {
		if ((effect.f & 1024) !== 0) set_signal_status(effect, MAYBE_DIRTY);
		let dirty;
		try {
			dirty = is_dirty(effect);
		} catch {
			dirty = true;
		}
		if (dirty) update_effect(effect);
	}
	eager_effects.clear();
}
/**
* Silently (without using `get`) increment a source
* @param {Source<number>} source
*/
function increment(source) {
	set(source, source.v + 1);
}
/**
* @param {Value} signal
* @param {number} status should be DIRTY or MAYBE_DIRTY
* @param {Effect[] | null} updated_during_traversal
* @returns {void}
*/
function mark_reactions(signal, status, updated_during_traversal) {
	var reactions = signal.reactions;
	if (reactions === null) return;
	var runes = is_runes();
	var length = reactions.length;
	for (var i = 0; i < length; i++) {
		var reaction = reactions[i];
		var flags = reaction.f;
		if (!runes && reaction === active_effect) continue;
		var not_dirty = (flags & DIRTY) === 0;
		if (not_dirty) set_signal_status(reaction, status);
		if ((flags & 131072) !== 0) eager_effects.add(reaction);
		else if ((flags & 2) !== 0) {
			var derived = reaction;
			batch_values?.delete(derived);
			if ((flags & 65536) === 0) {
				if (flags & 512 && (active_effect === null || (active_effect.f & 2097152) === 0)) reaction.f |= WAS_MARKED;
				mark_reactions(derived, MAYBE_DIRTY, updated_during_traversal);
			}
		} else if (not_dirty) {
			var effect = reaction;
			if ((flags & 16) !== 0 && eager_block_effects !== null) eager_block_effects.add(effect);
			if (updated_during_traversal !== null) updated_during_traversal.push(effect);
			else schedule_effect(effect);
		}
	}
}
/**
* @template T
* @param {T} value
* @returns {T}
*/
function proxy(value) {
	if (typeof value !== "object" || value === null || STATE_SYMBOL in value || COMPONENT_SYMBOL in value) return value;
	const prototype = get_prototype_of(value);
	if (prototype !== object_prototype && prototype !== array_prototype) return value;
	/** @type {Map<any, Source<any>>} */
	var sources = /* @__PURE__ */ new Map();
	var is_proxied_array = is_array(value);
	var version = /* @__PURE__ */ state(0);
	var stack = null;
	var parent_version = update_version;
	/**
	* Executes the proxy in the context of the reaction it was originally created in, if any
	* @template T
	* @param {() => T} fn
	*/
	var with_parent = (fn) => {
		if (update_version === parent_version) return fn();
		var reaction = active_reaction;
		var version = update_version;
		set_active_reaction(null);
		set_update_version(parent_version);
		var result = fn();
		set_active_reaction(reaction);
		set_update_version(version);
		return result;
	};
	if (is_proxied_array) sources.set("length", /* @__PURE__ */ state(
		/** @type {any[]} */
		value.length,
		stack
	));
	return new Proxy(value, {
		defineProperty(_, prop, descriptor) {
			if (!("value" in descriptor) || descriptor.configurable === false || descriptor.enumerable === false || descriptor.writable === false) state_descriptors_fixed();
			var s = sources.get(prop);
			if (s === void 0) with_parent(() => {
				var s = /* @__PURE__ */ state(descriptor.value, stack);
				sources.set(prop, s);
				return s;
			});
			else set(s, descriptor.value, true);
			return true;
		},
		deleteProperty(target, prop) {
			var s = sources.get(prop);
			if (s === void 0) {
				if (prop in target) {
					const s = with_parent(() => /* @__PURE__ */ state(UNINITIALIZED, stack));
					sources.set(prop, s);
					increment(version);
				}
			} else {
				set(s, UNINITIALIZED);
				increment(version);
			}
			return true;
		},
		get(target, prop, receiver) {
			if (prop === STATE_SYMBOL) return value;
			var s = sources.get(prop);
			var exists = prop in target;
			if (s === void 0 && (!exists || get_descriptor(target, prop)?.writable)) {
				s = with_parent(() => {
					return /* @__PURE__ */ state(proxy(exists ? target[prop] : UNINITIALIZED), stack);
				});
				sources.set(prop, s);
			}
			if (s !== void 0) {
				var v = get(s);
				return v === UNINITIALIZED ? void 0 : v;
			}
			return Reflect.get(target, prop, receiver);
		},
		getOwnPropertyDescriptor(target, prop) {
			var descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
			if (descriptor && "value" in descriptor) {
				var s = sources.get(prop);
				if (s) descriptor.value = get(s);
			} else if (descriptor === void 0) {
				var source = sources.get(prop);
				var value = source?.v;
				if (source !== void 0 && value !== UNINITIALIZED) return {
					enumerable: true,
					configurable: true,
					value,
					writable: true
				};
			}
			return descriptor;
		},
		has(target, prop) {
			if (prop === STATE_SYMBOL) return true;
			var s = sources.get(prop);
			var has = s !== void 0 && s.v !== UNINITIALIZED || Reflect.has(target, prop);
			if (s !== void 0 || active_effect !== null && (!has || get_descriptor(target, prop)?.writable)) {
				if (s === void 0) {
					s = with_parent(() => {
						return /* @__PURE__ */ state(has ? proxy(target[prop]) : UNINITIALIZED, stack);
					});
					sources.set(prop, s);
				}
				if (get(s) === UNINITIALIZED) return false;
			}
			return has;
		},
		set(target, prop, value, receiver) {
			var s = sources.get(prop);
			var has = prop in target;
			if (is_proxied_array && prop === "length") for (var i = value; i < s.v; i += 1) {
				var other_s = sources.get(i + "");
				if (other_s !== void 0) set(other_s, UNINITIALIZED);
				else if (i in target) {
					other_s = with_parent(() => /* @__PURE__ */ state(UNINITIALIZED, stack));
					sources.set(i + "", other_s);
				}
			}
			if (s === void 0) {
				if (!has || get_descriptor(target, prop)?.writable) {
					s = with_parent(() => /* @__PURE__ */ state(void 0, stack));
					set(s, proxy(value));
					sources.set(prop, s);
				}
			} else {
				has = s.v !== UNINITIALIZED;
				var p = with_parent(() => proxy(value));
				set(s, p);
			}
			var descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
			if (descriptor?.set) descriptor.set.call(receiver, value);
			if (!has) {
				if (is_proxied_array && typeof prop === "string") {
					var ls = sources.get("length");
					var n = Number(prop);
					if (Number.isInteger(n) && n >= ls.v) set(ls, n + 1);
				}
				increment(version);
			}
			return true;
		},
		ownKeys(target) {
			get(version);
			var own_keys = Reflect.ownKeys(target).filter((key) => {
				var source = sources.get(key);
				return source === void 0 || source.v !== UNINITIALIZED;
			});
			for (var [key, source] of sources) if (source.v !== UNINITIALIZED && !(key in target)) own_keys.push(key);
			return own_keys;
		},
		setPrototypeOf() {
			state_prototype_fixed();
		}
	});
}
/**
* @param {any} value
*/
function get_proxied_value(value) {
	try {
		if (value !== null && typeof value === "object" && STATE_SYMBOL in value) return value[STATE_SYMBOL];
	} catch {}
	return value;
}
/**
* @param {any} a
* @param {any} b
*/
function is(a, b) {
	return Object.is(get_proxied_value(a), get_proxied_value(b));
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/operations.js
/** @import { Effect, TemplateNode } from '#client' */
/** @type {Window} */
var $window;
/** @type {boolean} */
var is_firefox;
/** @type {() => Node | null} */
var first_child_getter;
/** @type {() => Node | null} */
var next_sibling_getter;
/**
* Initialize these lazily to avoid issues when using the runtime in a server context
* where these globals are not available while avoiding a separate server entry point
*/
function init_operations() {
	if ($window !== void 0) return;
	$window = window;
	is_firefox = /Firefox/.test(navigator.userAgent);
	var element_prototype = Element.prototype;
	var node_prototype = Node.prototype;
	var text_prototype = Text.prototype;
	first_child_getter = get_descriptor(node_prototype, "firstChild").get;
	next_sibling_getter = get_descriptor(node_prototype, "nextSibling").get;
	if (is_extensible(element_prototype)) {
		/** @type {any} */ element_prototype[CLASS_CACHE] = void 0;
		/** @type {any} */ element_prototype[ATTRIBUTES_CACHE] = null;
		/** @type {any} */ element_prototype[STYLE_CACHE] = void 0;
		element_prototype.__e = void 0;
	}
	if (is_extensible(text_prototype))
 /** @type {any} */ text_prototype[TEXT_CACHE] = void 0;
}
/**
* @param {string} value
* @returns {Text}
*/
function create_text(value = "") {
	return document.createTextNode(value);
}
/**
* @template {Node} N
* @param {N} node
*/
/*@__NO_SIDE_EFFECTS__*/
function get_first_child(node) {
	return first_child_getter.call(node);
}
/**
* @template {Node} N
* @param {N} node
*/
/*@__NO_SIDE_EFFECTS__*/
function get_next_sibling(node) {
	return next_sibling_getter.call(node);
}
/**
* Don't mark this as side-effect-free, hydration needs to walk all nodes
* @template {Node} N
* @param {N} node
* @param {boolean} is_text
* @returns {TemplateNode | null}
*/
function child(node, is_text) {
	if (!hydrating) return /* @__PURE__ */ get_first_child(node);
	var child = /* @__PURE__ */ get_first_child(hydrate_node);
	if (child === null) child = hydrate_node.appendChild(create_text());
	else if (is_text && child.nodeType !== 3) {
		var text = create_text();
		child?.before(text);
		set_hydrate_node(text);
		return text;
	}
	if (is_text) merge_text_nodes(child);
	set_hydrate_node(child);
	return child;
}
/**
* Don't mark this as side-effect-free, hydration needs to walk all nodes
* @param {TemplateNode} node
* @param {boolean} [is_text]
* @returns {TemplateNode | null}
*/
function first_child(node, is_text = false) {
	if (!hydrating) {
		var first = /* @__PURE__ */ get_first_child(node);
		if (first instanceof Comment && first.data === "") return /* @__PURE__ */ get_next_sibling(first);
		return first;
	}
	if (is_text) {
		if (hydrate_node?.nodeType !== 3) {
			var text = create_text();
			hydrate_node?.before(text);
			set_hydrate_node(text);
			return text;
		}
		merge_text_nodes(hydrate_node);
	}
	return hydrate_node;
}
/**
* `child`, for the very common case of an element with exactly one child. Resetting the
* hydration cursor is part of the same step, so the compiler doesn't have to emit a
* separate `reset` call for every `<p>{text}</p>` in an app.
* Don't mark this as side-effect-free, hydration needs to walk all nodes
* @param {TemplateNode} node
* @param {boolean} [is_text]
* @returns {TemplateNode | null}
*/
function only_child(node, is_text = false) {
	if (!hydrating) return /* @__PURE__ */ get_first_child(node);
	var first = child(node, is_text);
	reset(node);
	return first;
}
/**
* Don't mark this as side-effect-free, hydration needs to walk all nodes
* @param {TemplateNode} node
* @param {number} count
* @param {boolean} is_text
* @returns {TemplateNode | null}
*/
function sibling(node, count = 1, is_text = false) {
	let next_sibling = hydrating ? hydrate_node : node;
	var last_sibling;
	while (count--) {
		last_sibling = next_sibling;
		next_sibling = /* @__PURE__ */ get_next_sibling(next_sibling);
	}
	if (!hydrating) return next_sibling;
	if (is_text) {
		if (next_sibling?.nodeType !== 3) {
			var text = create_text();
			if (next_sibling === null) last_sibling?.after(text);
			else next_sibling.before(text);
			set_hydrate_node(text);
			return text;
		}
		merge_text_nodes(next_sibling);
	}
	set_hydrate_node(next_sibling);
	return next_sibling;
}
/**
* @template {Node} N
* @param {N} node
* @returns {void}
*/
function clear_text_content(node) {
	node.textContent = "";
}
/**
* Returns `true` if we're updating the current block, for example `condition` in
* an `{#if condition}` block just changed. In this case, the branch should be
* appended (or removed) at the same time as other updates within the
* current `<svelte:boundary>`
*/
function should_defer_append() {
	if (!async_mode_flag) return false;
	if (eager_block_effects !== null) return false;
	return (active_effect.f & REACTION_RAN) !== 0;
}
/**
* Branching here is intentional and load-bearing for perf. `createElement(tag)`
* hits a fast path in Blink that `createElementNS(NAMESPACE_HTML, tag)` doesn't,
* and passing an explicit `undefined` as the trailing options arg measurably
* slows both APIs. Funnelling every case through a single `createElementNS(ns,
* tag, options)` call would be smaller but slower on the HTML path.
*
* @template {keyof HTMLElementTagNameMap | string} T
* @param {T} tag
* @param {string} [namespace]
* @param {string} [is]
* @returns {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element}
*/
function create_element(tag, namespace, is) {
	if (namespace == null || namespace === "http://www.w3.org/1999/xhtml") return is ? document.createElement(tag, { is }) : document.createElement(tag);
	return is ? document.createElementNS(namespace, tag, { is }) : document.createElementNS(namespace, tag);
}
/**
* Browsers split text nodes larger than 65536 bytes when parsing.
* For hydration to succeed, we need to stitch them back together
* @param {Text} text
*/
function merge_text_nodes(text) {
	if (text.nodeValue.length < 65536) return;
	let next = text.nextSibling;
	while (next !== null && next.nodeType === 3) {
		next.remove();
		/** @type {string} */ text.nodeValue += next.nodeValue;
		next = text.nextSibling;
	}
}
/**
* @param {unknown} error
*/
function handle_error(error) {
	var effect = active_effect;
	if (effect === null) {
		/** @type {Derived} */ active_reaction.f |= ERROR_VALUE;
		return error;
	}
	if ((effect.f & 32768) === 0 && (effect.f & 4) === 0) throw error;
	invoke_error_boundary(error, effect);
}
/**
* @param {unknown} error
* @param {Effect | null} effect
*/
function invoke_error_boundary(error, effect) {
	if (effect !== null && (effect.f & 16384) !== 0) return;
	while (effect !== null) {
		if ((effect.f & 128) !== 0 && (effect.f & 33570816) === 0) {
			if ((effect.f & 32768) === 0) throw error;
			try {
				/** @type {Boundary} */ effect.b.error(error);
				return;
			} catch (e) {
				error = e;
			}
		}
		effect = effect.parent;
	}
	throw error;
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/effects.js
/** @import { Blocker, ComponentContext, ComponentContextLegacy, Derived, Effect, TemplateNode, TransitionManager } from '#client' */
/**
* @param {'$effect' | '$effect.pre' | '$inspect'} rune
*/
function validate_effect(rune) {
	if (active_effect === null) {
		if (active_reaction === null) effect_orphan(rune);
		effect_in_unowned_derived();
	}
	if (is_destroying_effect) effect_in_teardown(rune);
}
/**
* @param {Effect} effect
* @param {Effect} parent_effect
*/
function push_effect(effect, parent_effect) {
	var parent_last = parent_effect.last;
	if (parent_last === null) parent_effect.last = parent_effect.first = effect;
	else {
		parent_last.next = effect;
		effect.prev = parent_last;
		parent_effect.last = effect;
	}
}
/**
* @param {number} type
* @param {null | (() => void | (() => void))} fn
* @returns {Effect}
*/
function create_effect(type, fn) {
	var parent = active_effect;
	if (parent !== null && (parent.f & 8192) !== 0) type |= INERT;
	/** @type {Effect} */
	var effect = {
		ctx: component_context,
		deps: null,
		nodes: null,
		f: type | DIRTY | 512,
		first: null,
		fn,
		last: null,
		next: null,
		parent,
		b: parent && parent.b,
		prev: null,
		teardown: null,
		wv: 0,
		ac: null
	};
	current_batch?.register_created_effect(effect);
	/** @type {Effect | null} */
	var e = effect;
	if ((type & 4) !== 0) {
		if (collected_effects !== null) collected_effects.push(effect);
		else Batch.ensure().schedule(effect);
	} else if (fn !== null) {
		try {
			update_effect(effect);
		} catch (e) {
			destroy_effect(effect);
			throw e;
		}
		if (e.deps === null && e.teardown === null && e.nodes === null && e.first === e.last && (e.f & 524288) === 0) {
			e = e.first;
			if ((type & 16) !== 0 && (type & 65536) !== 0 && e !== null) e.f |= EFFECT_TRANSPARENT;
		}
	}
	if (e !== null) {
		e.parent = parent;
		if (parent !== null) push_effect(e, parent);
		if (active_reaction !== null && (active_reaction.f & 2) !== 0 && (type & 64) === 0) {
			var derived = active_reaction;
			(derived.effects ??= []).push(e);
		}
	}
	return effect;
}
/**
* Internal representation of `$effect.tracking()`
* @returns {boolean}
*/
function effect_tracking() {
	return active_reaction !== null && !untracking;
}
/**
* @param {() => void} fn
*/
function teardown(fn) {
	const effect = create_effect(8, null);
	set_signal_status(effect, CLEAN);
	effect.teardown = fn;
	return effect;
}
/**
* Internal representation of `$effect(...)`
* @param {() => void | (() => void)} fn
*/
function user_effect(fn) {
	validate_effect("$effect");
	var flags = active_effect.f;
	if (!active_reaction && (flags & 32) !== 0 && component_context !== null && !component_context.i) {
		var context = component_context;
		(context.e ??= []).push(fn);
	} else return create_user_effect(fn);
}
/**
* @param {() => void | (() => void)} fn
*/
function create_user_effect(fn) {
	return create_effect(4 | USER_EFFECT, fn);
}
/**
* Internal representation of `$effect.pre(...)`
* @param {() => void | (() => void)} fn
* @returns {Effect}
*/
function user_pre_effect(fn) {
	validate_effect("$effect.pre");
	return create_effect(8 | USER_EFFECT, fn);
}
/**
* An effect root whose children can transition out
* @param {() => void} fn
* @returns {(options?: { outro?: boolean }) => Promise<void>}
*/
function component_root(fn) {
	Batch.ensure();
	const effect = create_effect(64 | EFFECT_PRESERVED, fn);
	return (options = {}) => {
		return new Promise((fulfil) => {
			if (options.outro) pause_effect(effect, () => {
				destroy_effect(effect);
				fulfil(void 0);
			});
			else {
				destroy_effect(effect);
				fulfil(void 0);
			}
		});
	};
}
/**
* @param {() => void | (() => void)} fn
* @returns {Effect}
*/
function effect(fn) {
	return create_effect(4, fn);
}
/**
* Internal representation of `$: ..`
* @param {() => any} deps
* @param {() => void | (() => void)} fn
*/
function legacy_pre_effect(deps, fn) {
	var context = component_context;
	/** @type {{ effect: null | Effect, ran: boolean, deps: () => any }} */
	var token = {
		effect: null,
		ran: false,
		deps
	};
	context.l.$.push(token);
	token.effect = render_effect(() => {
		deps();
		if (token.ran) return;
		token.ran = true;
		var effect = active_effect;
		try {
			set_active_effect(effect.parent);
			untrack(fn);
		} finally {
			set_active_effect(effect);
		}
	});
}
function legacy_pre_effect_reset() {
	var context = component_context;
	render_effect(() => {
		for (var token of context.l.$) {
			token.deps();
			var effect = token.effect;
			if ((effect.f & 1024) !== 0 && effect.deps !== null) set_signal_status(effect, MAYBE_DIRTY);
			if (is_dirty(effect)) update_effect(effect);
			token.ran = false;
		}
	});
}
/**
* @param {() => void | (() => void)} fn
* @returns {Effect}
*/
function async_effect(fn) {
	return create_effect(ASYNC | EFFECT_PRESERVED, fn);
}
/**
* @param {() => void | (() => void)} fn
* @returns {Effect}
*/
function render_effect(fn, flags = 0) {
	return create_effect(8 | flags, fn);
}
/**
* @param {(...expressions: any) => void | (() => void)} fn
* @param {Array<() => any>} sync
* @param {Array<() => Promise<any>>} async
* @param {Blocker[]} blockers
*/
function template_effect(fn, sync = [], async = [], blockers = []) {
	flatten(blockers, sync, async, (values) => {
		create_effect(8, () => {
			fn(...values.map(get));
		});
	});
}
/**
* @param {(() => void)} fn
* @param {number} flags
*/
function block(fn, flags = 0) {
	return create_effect(16 | flags, fn);
}
/**
* @param {(() => void)} fn
*/
function branch(fn) {
	return create_effect(32 | EFFECT_PRESERVED, fn);
}
/**
* @param {Effect} effect
*/
function execute_effect_teardown(effect) {
	var teardown = effect.teardown;
	if (teardown !== null) {
		const previously_destroying_effect = is_destroying_effect;
		const previous_reaction = active_reaction;
		set_is_destroying_effect(true);
		set_active_reaction(null);
		try {
			teardown.call(null);
		} catch (error) {
			invoke_error_boundary(error, effect.parent);
		} finally {
			set_is_destroying_effect(previously_destroying_effect);
			set_active_reaction(previous_reaction);
		}
	}
}
/**
* @param {Effect} signal
* @param {boolean} remove_dom
* @returns {void}
*/
function destroy_effect_children(signal, remove_dom = false) {
	var effect = signal.first;
	signal.first = signal.last = null;
	while (effect !== null) {
		const controller = effect.ac;
		if (controller !== null) without_reactive_context(() => {
			controller.abort(STALE_REACTION);
		});
		var next = effect.next;
		if ((effect.f & 64) !== 0) effect.parent = null;
		else destroy_effect(effect, remove_dom);
		effect = next;
	}
}
/**
* @param {Effect} signal
* @returns {void}
*/
function destroy_block_effect_children(signal) {
	var effect = signal.first;
	while (effect !== null) {
		var next = effect.next;
		if ((effect.f & 32) === 0) destroy_effect(effect);
		effect = next;
	}
}
/**
* @param {Effect} effect
* @param {boolean} [remove_dom]
* @returns {void}
*/
function destroy_effect(effect, remove_dom = true) {
	var removed = false;
	if ((remove_dom || (effect.f & 262144) !== 0) && effect.nodes !== null && effect.nodes.end !== null) {
		remove_effect_dom(effect.nodes.start, effect.nodes.end);
		removed = true;
	}
	effect.f |= DESTROYING;
	destroy_effect_children(effect, remove_dom && !removed);
	remove_reactions(effect, 0);
	var transitions = effect.nodes && effect.nodes.t;
	if (transitions !== null) for (const transition of transitions) transition.stop();
	execute_effect_teardown(effect);
	effect.f ^= DESTROYING;
	effect.f |= DESTROYED;
	var parent = effect.parent;
	if (parent !== null && parent.first !== null) unlink_effect(effect);
	effect.next = effect.prev = effect.teardown = effect.ctx = effect.deps = effect.fn = effect.nodes = effect.ac = effect.b = null;
}
/**
*
* @param {TemplateNode | null} node
* @param {TemplateNode} end
*/
function remove_effect_dom(node, end) {
	while (node !== null) {
		/** @type {TemplateNode | null} */
		var next = node === end ? null : /* @__PURE__ */ get_next_sibling(node);
		node.remove();
		node = next;
	}
}
/**
* Detach an effect from the effect tree, freeing up memory and
* reducing the amount of work that happens on subsequent traversals
* @param {Effect} effect
*/
function unlink_effect(effect) {
	var parent = effect.parent;
	var prev = effect.prev;
	var next = effect.next;
	if (prev !== null) prev.next = next;
	if (next !== null) next.prev = prev;
	if (parent !== null) {
		if (parent.first === effect) parent.first = next;
		if (parent.last === effect) parent.last = prev;
	}
}
/**
* When a block effect is removed, we don't immediately destroy it or yank it
* out of the DOM, because it might have transitions. Instead, we 'pause' it.
* It stays around (in memory, and in the DOM) until outro transitions have
* completed, and if the state change is reversed then we _resume_ it.
* A paused effect does not update, and the DOM subtree becomes inert.
* @param {Effect} effect
* @param {() => void} [callback]
* @param {boolean} [destroy]
*/
function pause_effect(effect, callback, destroy = true) {
	/** @type {TransitionManager[]} */
	var transitions = [];
	effect.f |= 256;
	pause_children(effect, transitions, true);
	var fn = () => {
		if (destroy) destroy_effect(effect);
		if (callback) callback();
	};
	var remaining = transitions.length;
	if (remaining > 0) {
		var check = () => --remaining || fn();
		for (var transition of transitions) transition.out(check);
	} else fn();
}
/**
* @param {Effect} effect
* @param {TransitionManager[]} transitions
* @param {boolean} local
*/
function pause_children(effect, transitions, local) {
	if ((effect.f & 8192) !== 0) return;
	effect.f ^= INERT;
	var t = effect.nodes && effect.nodes.t;
	if (t !== null) {
		for (const transition of t) if (transition.is_global || local) transitions.push(transition);
	}
	var child = effect.first;
	while (child !== null) {
		var sibling = child.next;
		if ((child.f & 64) === 0) {
			var transparent = (child.f & 65536) !== 0 || (child.f & 32) !== 0 && (effect.f & 16) !== 0;
			pause_children(child, transitions, transparent ? local : false);
		}
		child = sibling;
	}
}
/**
* The opposite of `pause_effect`. We call this if (for example)
* `x` becomes falsy then truthy: `{#if x}...{/if}`
* @param {Effect} effect
*/
function resume_effect(effect) {
	effect.f &= -257;
	resume_children(effect, true);
}
/**
* @param {Effect} effect
* @param {boolean} local
*/
function resume_children(effect, local) {
	if ((effect.f & 256) !== 0) return;
	if ((effect.f & 8192) === 0) return;
	effect.f ^= INERT;
	if ((effect.f & 1024) === 0) {
		set_signal_status(effect, DIRTY);
		Batch.ensure().schedule(effect);
	}
	var child = effect.first;
	while (child !== null) {
		var sibling = child.next;
		var transparent = (child.f & 65536) !== 0 || (child.f & 32) !== 0;
		resume_children(child, transparent ? local : false);
		child = sibling;
	}
	var t = effect.nodes && effect.nodes.t;
	if (t !== null) {
		for (const transition of t) if (transition.is_global || local) transition.in();
	}
}
/**
* @param {Effect} effect
* @param {DocumentFragment} fragment
*/
function move_effect(effect, fragment) {
	if (!effect.nodes) return;
	/** @type {TemplateNode | null} */
	var node = effect.nodes.start;
	var end = effect.nodes.end;
	while (node !== null) {
		/** @type {TemplateNode | null} */
		var next = node === end ? null : /* @__PURE__ */ get_next_sibling(node);
		fragment.append(node);
		node = next;
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/legacy.js
/** @import { Value } from '#client' */
/**
* @type {Set<Value> | null}
* @deprecated
*/
var captured_signals = null;
/**
* Capture an array of all the signals that are read when `fn` is called
* @template T
* @param {() => T} fn
*/
function capture_signals(fn) {
	var previous_captured_signals = captured_signals;
	try {
		captured_signals = /* @__PURE__ */ new Set();
		untrack(fn);
		if (previous_captured_signals !== null) for (var signal of captured_signals) previous_captured_signals.add(signal);
		return captured_signals;
	} finally {
		captured_signals = previous_captured_signals;
	}
}
/**
* Invokes a function and captures all signals that are read during the invocation,
* then invalidates them.
* @param {() => any} fn
* @deprecated
*/
function invalidate_inner_signals(fn) {
	for (var signal of capture_signals(fn)) internal_set(signal, signal.v);
}
//#endregion
//#region node_modules/svelte/src/internal/client/runtime.js
/** @import { Derived, Effect, Reaction, Source, Value } from '#client' */
/**
* True if updating in an effect context that is reactive (i.e. not branch/root effects)
*/
var is_updating_effect = false;
var is_destroying_effect = false;
/** @param {boolean} value */
function set_is_destroying_effect(value) {
	is_destroying_effect = value;
}
/** @type {null | Reaction} */
var active_reaction = null;
var untracking = false;
/** @param {null | Reaction} reaction */
function set_active_reaction(reaction) {
	active_reaction = reaction;
}
/** @type {null | Effect} */
var active_effect = null;
/** @param {null | Effect} effect */
function set_active_effect(effect) {
	active_effect = effect;
}
/**
* When sources are created within a reaction, reading and writing
* them within that reaction should not cause a re-run
* @type {null | Set<Source>}
*/
var current_sources = null;
/** @param {Value} value */
function push_reaction_value(value) {
	if (active_reaction !== null && (!async_mode_flag || (active_reaction.f & 2) !== 0)) (current_sources ??= /* @__PURE__ */ new Set()).add(value);
}
/**
* The dependencies of the reaction that is currently being executed. In many cases,
* the dependencies are unchanged between runs, and so this will be `null` unless
* and until a new dependency is accessed — we track this via `skipped_deps`
* @type {null | Value[]}
*/
var new_deps = null;
var skipped_deps = 0;
/**
* Tracks writes that the effect it's executed in doesn't listen to yet,
* so that the dependency can be added to the effect later on if it then reads it
* @type {null | Source[]}
*/
var untracked_writes = null;
/** @param {null | Source[]} value */
function set_untracked_writes(value) {
	untracked_writes = value;
}
/**
* @type {number} Used by sources and deriveds for handling updates.
* Version starts from 1 so that unowned deriveds differentiate between a created effect and a run one for tracing
**/
var write_version = 1;
/** @type {number} Used to version each read of a source of derived to avoid duplicating dependencies inside a reaction */
var read_version = 0;
var update_version = read_version;
/** @param {number} value */
function set_update_version(value) {
	update_version = value;
}
function increment_write_version() {
	return ++write_version;
}
/**
* Determines whether a derived or effect is dirty.
* If it is MAYBE_DIRTY, will set the status to CLEAN
* @param {Reaction} reaction
* @returns {boolean}
*/
function is_dirty(reaction) {
	var flags = reaction.f;
	if ((flags & 2048) !== 0) return true;
	if (flags & 2) reaction.f &= ~WAS_MARKED;
	if ((flags & 4096) !== 0) {
		var dependencies = reaction.deps;
		var length = dependencies.length;
		for (var i = 0; i < length; i++) {
			var dependency = dependencies[i];
			if (is_dirty(dependency)) update_derived(dependency);
			if (dependency.wv > reaction.wv) return true;
		}
		if ((flags & 512) !== 0 && batch_values === null) set_signal_status(reaction, CLEAN);
	}
	return false;
}
/**
* @param {Value} signal
* @param {Effect} effect
* @param {boolean} [root]
*/
function schedule_possible_effect_self_invalidation(signal, effect, root = true) {
	var reactions = signal.reactions;
	if (reactions === null) return;
	if (!async_mode_flag && current_sources !== null && current_sources.has(signal)) return;
	for (var i = 0; i < reactions.length; i++) {
		var reaction = reactions[i];
		if ((reaction.f & 2) !== 0) schedule_possible_effect_self_invalidation(reaction, effect, false);
		else if (effect === reaction) {
			if (root) set_signal_status(reaction, DIRTY);
			else if ((reaction.f & 1024) !== 0) set_signal_status(reaction, MAYBE_DIRTY);
			schedule_effect(reaction);
		}
	}
}
/** @param {Reaction} reaction */
function update_reaction(reaction) {
	var previous_deps = new_deps;
	var previous_skipped_deps = skipped_deps;
	var previous_untracked_writes = untracked_writes;
	var previous_reaction = active_reaction;
	var previous_sources = current_sources;
	var previous_component_context = component_context;
	var previous_untracking = untracking;
	var previous_update_version = update_version;
	var flags = reaction.f;
	new_deps = null;
	skipped_deps = 0;
	untracked_writes = null;
	active_reaction = (flags & 96) === 0 ? reaction : null;
	current_sources = null;
	set_component_context(reaction.ctx);
	untracking = false;
	update_version = ++read_version;
	if (reaction.ac !== null) {
		without_reactive_context(() => {
			/** @type {AbortController} */ reaction.ac.abort(STALE_REACTION);
		});
		reaction.ac = null;
	}
	try {
		reaction.f |= REACTION_IS_UPDATING;
		var fn = reaction.fn;
		var result = fn();
		reaction.f |= REACTION_RAN;
		var deps = update_dependencies(reaction);
		if (is_runes() && untracked_writes !== null && !untracking && deps !== null && (reaction.f & 6146) === 0) for (var i = 0; i < untracked_writes.length; i++) schedule_possible_effect_self_invalidation(untracked_writes[i], reaction);
		if (previous_reaction !== null && previous_reaction !== reaction) {
			read_version++;
			if (previous_reaction.deps !== null) for (let i = 0; i < previous_skipped_deps; i += 1) previous_reaction.deps[i].rv = read_version;
			if (previous_deps !== null) for (const dep of previous_deps) dep.rv = read_version;
			if (untracked_writes !== null) {
				if (previous_untracked_writes === null) previous_untracked_writes = untracked_writes;
				else previous_untracked_writes.push(...untracked_writes);
			}
		}
		if ((reaction.f & 8388608) !== 0) reaction.f ^= ERROR_VALUE;
		return result;
	} catch (error) {
		update_dependencies(reaction);
		return handle_error(error);
	} finally {
		reaction.f ^= REACTION_IS_UPDATING;
		new_deps = previous_deps;
		skipped_deps = previous_skipped_deps;
		untracked_writes = previous_untracked_writes;
		active_reaction = previous_reaction;
		current_sources = previous_sources;
		set_component_context(previous_component_context);
		untracking = previous_untracking;
		update_version = previous_update_version;
	}
}
/**
* @param {Reaction} reaction
*/
function update_dependencies(reaction) {
	var deps = reaction.deps;
	var is_fork = current_batch?.is_fork;
	if (new_deps !== null) {
		var i;
		if (!is_fork) remove_reactions(reaction, skipped_deps);
		if (deps !== null && skipped_deps > 0) {
			deps.length = skipped_deps + new_deps.length;
			for (i = 0; i < new_deps.length; i++) deps[skipped_deps + i] = new_deps[i];
		} else reaction.deps = deps = new_deps;
		if (effect_tracking() && (reaction.f & 512) !== 0) for (i = skipped_deps; i < deps.length; i++) (deps[i].reactions ??= []).push(reaction);
	} else if (!is_fork && deps !== null && skipped_deps < deps.length) {
		remove_reactions(reaction, skipped_deps);
		deps.length = skipped_deps;
	}
	return deps;
}
/**
* @template V
* @param {Reaction} signal
* @param {Value<V>} dependency
* @returns {void}
*/
function remove_reaction(signal, dependency) {
	let reactions = dependency.reactions;
	if (reactions !== null) {
		var index = index_of.call(reactions, signal);
		if (index !== -1) {
			var new_length = reactions.length - 1;
			if (new_length === 0) reactions = dependency.reactions = null;
			else {
				reactions[index] = reactions[new_length];
				reactions.pop();
			}
		}
	}
	if (reactions === null && (dependency.f & 2) !== 0 && (new_deps === null || !includes.call(new_deps, dependency))) {
		var derived = dependency;
		if ((derived.f & 512) !== 0) {
			derived.f ^= 512;
			derived.f &= ~WAS_MARKED;
		}
		if (derived.v !== UNINITIALIZED) update_derived_status(derived);
		if (derived.ac !== null) without_reactive_context(() => {
			/** @type {AbortController} */ derived.ac.abort(STALE_REACTION);
			derived.ac = null;
			set_signal_status(derived, DIRTY);
		});
		freeze_derived_effects(derived);
		remove_reactions(derived, 0);
	}
}
/**
* @param {Reaction} signal
* @param {number} start_index
* @returns {void}
*/
function remove_reactions(signal, start_index) {
	var dependencies = signal.deps;
	if (dependencies === null) return;
	for (var i = start_index; i < dependencies.length; i++) remove_reaction(signal, dependencies[i]);
}
/**
* @param {Effect} effect
* @returns {void}
*/
function update_effect(effect) {
	var flags = effect.f;
	if ((flags & 16384) !== 0) return;
	set_signal_status(effect, CLEAN);
	var previous_effect = active_effect;
	var was_updating_effect = is_updating_effect;
	active_effect = effect;
	is_updating_effect = (flags & 96) === 0;
	try {
		if ((flags & 16777232) !== 0) destroy_block_effect_children(effect);
		else destroy_effect_children(effect);
		execute_effect_teardown(effect);
		var teardown = update_reaction(effect);
		effect.teardown = typeof teardown === "function" ? teardown : null;
		effect.wv = write_version;
	} finally {
		is_updating_effect = was_updating_effect;
		active_effect = previous_effect;
	}
}
/**
* Returns a promise that resolves once any pending state changes have been applied.
* @returns {Promise<void>}
*/
async function tick() {
	if (async_mode_flag) return new Promise((f) => {
		requestAnimationFrame(() => f());
		setTimeout(() => f());
	});
	await Promise.resolve();
	flushSync();
}
/**
* @template V
* @param {Value<V>} signal
* @returns {V}
*/
function get(signal) {
	var is_derived = (signal.f & 2) !== 0;
	captured_signals?.add(signal);
	if (active_reaction !== null && !untracking) {
		if (!(active_effect !== null && (active_effect.f & 16384) !== 0) && (current_sources === null || !current_sources.has(signal))) {
			var deps = active_reaction.deps;
			if ((active_reaction.f & 2097152) !== 0) {
				if (signal.rv < read_version) {
					signal.rv = read_version;
					if (new_deps === null && deps !== null && deps[skipped_deps] === signal) skipped_deps++;
					else if (new_deps === null) new_deps = [signal];
					else new_deps.push(signal);
				}
			} else {
				active_reaction.deps ??= [];
				if (!includes.call(active_reaction.deps, signal)) active_reaction.deps.push(signal);
				var reactions = signal.reactions;
				if (reactions === null) signal.reactions = [active_reaction];
				else if (!includes.call(reactions, active_reaction)) reactions.push(active_reaction);
			}
		}
	}
	if (is_destroying_effect && old_values.has(signal)) return old_values.get(signal);
	if (is_derived) {
		var derived = signal;
		if (is_destroying_effect) {
			var value = derived.v;
			if ((derived.f & 1024) === 0 && derived.reactions !== null || depends_on_old_values(derived)) value = execute_derived(derived);
			old_values.set(derived, value);
			return value;
		}
		var should_connect = (derived.f & 512) === 0 && !untracking && active_reaction !== null && (is_updating_effect || (active_reaction.f & 512) !== 0);
		var is_new = (derived.f & REACTION_RAN) === 0;
		if (is_dirty(derived)) {
			if (should_connect) derived.f |= 512;
			update_derived(derived);
		}
		if (should_connect && !is_new) {
			unfreeze_derived_effects(derived);
			reconnect(derived);
		}
	}
	if (batch_values?.has(signal)) return batch_values.get(signal);
	if ((signal.f & 8388608) !== 0) throw signal.v;
	return signal.v;
}
/**
* (Re)connect a disconnected derived, so that it is notified
* of changes in `mark_reactions`
* @param {Derived} derived
*/
function reconnect(derived) {
	derived.f |= 512;
	if (derived.deps === null) return;
	for (const dep of derived.deps) {
		(dep.reactions ??= []).push(derived);
		if ((dep.f & 2) !== 0 && (dep.f & 512) === 0) {
			unfreeze_derived_effects(dep);
			reconnect(dep);
		}
	}
}
/** @param {Derived} derived */
function depends_on_old_values(derived) {
	if (derived.v === UNINITIALIZED) return true;
	if (derived.deps === null) return false;
	for (const dep of derived.deps) {
		if (old_values.has(dep)) return true;
		if ((dep.f & 2) !== 0 && depends_on_old_values(dep)) return true;
	}
	return false;
}
/**
* When used inside a [`$derived`](https://svelte.dev/docs/svelte/$derived) or [`$effect`](https://svelte.dev/docs/svelte/$effect),
* any state read inside `fn` will not be treated as a dependency.
*
* ```ts
* $effect(() => {
*   // this will run when `data` changes, but not when `time` changes
*   save(data, {
*     timestamp: untrack(() => time)
*   });
* });
* ```
* @template T
* @param {() => T} fn
* @returns {T}
*/
function untrack(fn) {
	var previous_untracking = untracking;
	try {
		untracking = true;
		return fn();
	} finally {
		untracking = previous_untracking;
	}
}
/**
* Possibly traverse an object and read all its properties so that they're all reactive in case this is `$state`.
* Does only check first level of an object for performance reasons (heuristic should be good for 99% of all cases).
* @param {any} value
* @returns {void}
*/
function deep_read_state(value) {
	if (typeof value !== "object" || !value || value instanceof EventTarget) return;
	if (STATE_SYMBOL in value) deep_read(value);
	else if (!Array.isArray(value)) for (let key in value) {
		const prop = value[key];
		if (typeof prop === "object" && prop && STATE_SYMBOL in prop) deep_read(prop);
	}
}
/**
* Deeply traverse an object and read all its properties
* so that they're all reactive in case this is `$state`
* @param {any} value
* @param {Set<any>} visited
* @returns {void}
*/
function deep_read(value, visited = /* @__PURE__ */ new Set()) {
	if (typeof value === "object" && value !== null && !(value instanceof EventTarget) && !visited.has(value)) {
		visited.add(value);
		if (value instanceof Date) value.getTime();
		for (let key in value) try {
			deep_read(value[key], visited);
		} catch (e) {}
		const proto = get_prototype_of(value);
		if (proto !== Object.prototype && proto !== Array.prototype && proto !== Map.prototype && proto !== Set.prototype && proto !== Date.prototype) {
			const descriptors = get_descriptors(proto);
			for (let key in descriptors) {
				const get = descriptors[key].get;
				if (get) try {
					get.call(value);
				} catch (e) {}
			}
		}
	}
}
/**
* Subset of delegated events which should be passive by default.
* These two are already passive via browser defaults on window, document and body.
* But since
* - we're delegating them
* - they happen often
* - they apply to mobile which is generally less performant
* we're marking them as passive by default for other elements, too.
*/
var PASSIVE_EVENTS = ["touchstart", "touchmove"];
/**
* Returns `true` if `name` is a passive event
* @param {string} name
*/
function is_passive_event(name) {
	return PASSIVE_EVENTS.includes(name);
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/events.js
/**
* Used on elements, as a map of event type -> event handler,
* and on events themselves to track which element handled an event
*/
var event_symbol = Symbol("events");
/** @type {Set<string>} */
var all_registered_events = /* @__PURE__ */ new Set();
/** @type {Set<(events: Array<string>) => void>} */
var root_event_handles = /* @__PURE__ */ new Set();
/**
* @param {string} event_name
* @param {EventTarget} dom
* @param {EventListener} [handler]
* @param {AddEventListenerOptions} [options]
*/
function create_event(event_name, dom, handler, options = {}) {
	/**
	* @this {EventTarget}
	*/
	function target_handler(event) {
		if (!options.capture) handle_event_propagation.call(dom, event);
		if (!event.cancelBubble) return without_reactive_context(() => {
			return handler?.call(this, event);
		});
	}
	if (event_name.startsWith("pointer") || event_name.startsWith("touch") || event_name === "wheel") queue_micro_task(() => {
		dom.addEventListener(event_name, target_handler, options);
	});
	else dom.addEventListener(event_name, target_handler, options);
	return target_handler;
}
/**
* @param {string} event_name
* @param {Element} dom
* @param {EventListener} [handler]
* @param {boolean} [capture]
* @param {boolean} [passive]
* @returns {void}
*/
function event(event_name, dom, handler, capture, passive) {
	var options = {
		capture,
		passive
	};
	var target_handler = create_event(event_name, dom, handler, options);
	if (dom === document.body || dom === window || dom === document || dom instanceof HTMLMediaElement) teardown(() => {
		dom.removeEventListener(event_name, target_handler, options);
	});
}
var last_propagated_event = null;
var last_propagated_event_clear_scheduled = false;
/**
* @this {EventTarget}
* @param {Event} event
* @returns {void}
*/
function handle_event_propagation(event) {
	var handler_element = this;
	var owner_document = handler_element.ownerDocument;
	var event_name = event.type;
	var path = event.composedPath?.() || [];
	var current_target = path[0] || event.target;
	last_propagated_event = event;
	if (!last_propagated_event_clear_scheduled) {
		last_propagated_event_clear_scheduled = true;
		setTimeout(() => {
			last_propagated_event_clear_scheduled = false;
			last_propagated_event = null;
		});
	}
	var path_idx = 0;
	var handled_at = last_propagated_event === event && event[event_symbol];
	if (handled_at) {
		var at_idx = path.indexOf(handled_at);
		if (at_idx !== -1 && (handler_element === document || handler_element === window)) {
			event[event_symbol] = handler_element;
			return;
		}
		var handler_idx = path.indexOf(handler_element);
		if (handler_idx === -1) return;
		if (at_idx <= handler_idx) path_idx = at_idx;
	}
	current_target = path[path_idx] || event.target;
	if (current_target === handler_element) return;
	define_property(event, "currentTarget", {
		configurable: true,
		get() {
			return current_target || owner_document;
		}
	});
	var previous_reaction = active_reaction;
	var previous_effect = active_effect;
	set_active_reaction(null);
	set_active_effect(null);
	try {
		/**
		* @type {unknown}
		*/
		var throw_error;
		/**
		* @type {unknown[]}
		*/
		var other_errors = [];
		while (current_target !== null) {
			if (current_target === handler_element) break;
			try {
				var delegated = current_target[event_symbol]?.[event_name];
				if (delegated != null && (!current_target.disabled || event.target === current_target)) delegated.call(current_target, event);
			} catch (error) {
				if (throw_error) other_errors.push(error);
				else throw_error = error;
			}
			if (event.cancelBubble) break;
			path_idx++;
			current_target = path_idx < path.length ? path[path_idx] : null;
		}
		if (throw_error) {
			for (let error of other_errors) queueMicrotask(() => {
				throw error;
			});
			throw throw_error;
		}
	} finally {
		event[event_symbol] = handler_element;
		delete event.currentTarget;
		set_active_reaction(previous_reaction);
		set_active_effect(previous_effect);
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/reconciler.js
var policy = globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
/** @param {string} html */
createHTML: (html) => {
	return html;
} });
/** @param {string} html */
function create_trusted_html(html) {
	return policy?.createHTML(html) ?? html;
}
/**
* @param {string} html
*/
function create_fragment_from_html(html) {
	var elem = create_element("template");
	elem.innerHTML = create_trusted_html(html.replaceAll("<!>", "<!---->"));
	return elem.content;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/template.js
/** @import { Effect, EffectNodes, TemplateNode } from '#client' */
/** @import { TemplateStructure } from './types' */
/**
* @param {TemplateNode} start
* @param {TemplateNode | null} end
*/
function assign_nodes(start, end) {
	var effect = active_effect;
	if (effect.nodes === null) effect.nodes = {
		start,
		end,
		a: null,
		t: null
	};
}
/**
* @param {string} content
* @param {number} flags
* @returns {() => Node | Node[]}
*/
/*#__NO_SIDE_EFFECTS__*/
function from_html(content, flags) {
	var is_fragment = (flags & 1) !== 0;
	var use_import_node = (flags & 2) !== 0;
	/** @type {Node} */
	var node;
	/**
	* Whether or not the first item is a text/element node. If not, we need to
	* create an additional comment node to act as `effect.nodes.start`
	*/
	var has_start = !content.startsWith("<!>");
	return () => {
		if (hydrating) {
			assign_nodes(hydrate_node, null);
			return hydrate_node;
		}
		if (node === void 0) {
			node = create_fragment_from_html(has_start ? content : "<!>" + content);
			if (!is_fragment) node = /* @__PURE__ */ get_first_child(node);
		}
		var clone = use_import_node || is_firefox ? document.importNode(node, true) : node.cloneNode(true);
		if (is_fragment) {
			var start = /* @__PURE__ */ get_first_child(clone);
			var end = clone.lastChild;
			assign_nodes(start, end);
		} else assign_nodes(clone, clone);
		return clone;
	};
}
/**
* Assign the created (or in hydration mode, traversed) dom elements to the current block
* and insert the elements into the dom (in client mode).
* @param {Text | Comment | Element} anchor
* @param {DocumentFragment | Element} dom
*/
function append(anchor, dom) {
	if (hydrating) {
		var effect = active_effect;
		if ((effect.f & 32768) === 0 || effect.nodes.end === null) effect.nodes.end = hydrate_node;
		hydrate_next();
		return;
	}
	if (anchor === null) return;
	anchor.before(dom);
}
//#endregion
//#region node_modules/svelte/src/reactivity/create-subscriber.js
/**
* Returns a `subscribe` function that integrates external event-based systems with Svelte's reactivity.
* It's particularly useful for integrating with web APIs like `MediaQuery`, `IntersectionObserver`, or `WebSocket`.
*
* If `subscribe` is called inside an effect (including indirectly, for example inside a getter),
* the `start` callback will be called with an `update` function. Whenever `update` is called, the effect re-runs.
*
* If `start` returns a cleanup function, it will be called when the effect is destroyed.
*
* If `subscribe` is called in multiple effects, `start` will only be called once as long as the effects
* are active, and the returned teardown function will only be called when all effects are destroyed.
*
* It's best understood with an example. Here's an implementation of [`MediaQuery`](https://svelte.dev/docs/svelte/svelte-reactivity#MediaQuery):
*
* ```js
* import { createSubscriber } from 'svelte/reactivity';
* import { on } from 'svelte/events';
*
* export class MediaQuery {
* 	#query;
* 	#subscribe;
*
* 	constructor(query) {
* 		this.#query = window.matchMedia(`(${query})`);
*
* 		this.#subscribe = createSubscriber((update) => {
* 			// when the `change` event occurs, re-run any effects that read `this.current`
* 			const off = on(this.#query, 'change', update);
*
* 			// stop listening when all the effects are destroyed
* 			return () => off();
* 		});
* 	}
*
* 	get current() {
* 		// This makes the getter reactive, if read in an effect
* 		this.#subscribe();
*
* 		// Return the current state of the query, whether or not we're in an effect
* 		return this.#query.matches;
* 	}
* }
* ```
* @param {(update: () => void) => (() => void) | void} start
* @since 5.7.0
*/
function createSubscriber(start) {
	let subscribers = 0;
	let version = source(0);
	/** @type {(() => void) | void} */
	let stop;
	return () => {
		if (effect_tracking()) {
			get(version);
			render_effect(() => {
				if (subscribers === 0) stop = untrack(() => start(() => increment(version)));
				subscribers += 1;
				return () => {
					queue_micro_task(() => {
						subscribers -= 1;
						if (subscribers === 0) {
							stop?.();
							stop = void 0;
							increment(version);
						}
					});
				};
			});
		}
	};
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/boundary.js
/** @import { Effect, Source, TemplateNode, } from '#client' */
/**
* @typedef {{
* 	 onerror?: ((error: unknown, reset: () => void) => void) | null;
*   failed?: ((anchor: Node, error: () => unknown, reset: () => () => void) => void) | null;
*   pending?: ((anchor: Node) => void) | null;
* }} BoundaryProps
*/
var flags = EFFECT_TRANSPARENT | EFFECT_PRESERVED;
/**
* @param {TemplateNode} node
* @param {BoundaryProps} props
* @param {((anchor: Node) => void)} children
* @param {((error: unknown) => unknown) | undefined} [transform_error]
* @returns {void}
*/
function boundary(node, props, children, transform_error) {
	new Boundary(node, props, children, transform_error);
}
var Boundary = class {
	/** @type {Boundary | null} */
	parent;
	is_pending = false;
	/**
	* API-level transformError transform function. Transforms errors before they reach the `failed` snippet.
	* Inherited from parent boundary, or defaults to identity.
	* @type {(error: unknown) => unknown}
	*/
	transform_error;
	/** @type {TemplateNode} */
	#anchor;
	/** @type {TemplateNode | null} */
	#hydrate_open = hydrating ? hydrate_node : null;
	/** @type {BoundaryProps} */
	#props;
	/** @type {((anchor: Node) => void)} */
	#children;
	/** @type {Effect} */
	#effect;
	/** @type {Effect | null} */
	#main_effect = null;
	/** @type {Effect | null} */
	#pending_effect = null;
	/** @type {Effect | null} */
	#failed_effect = null;
	/** @type {DocumentFragment | null} */
	#offscreen_fragment = null;
	#local_pending_count = 0;
	#pending_count = 0;
	#pending_count_update_queued = false;
	/** @type {Set<Effect>} */
	#dirty_effects = /* @__PURE__ */ new Set();
	/** @type {Set<Effect>} */
	#maybe_dirty_effects = /* @__PURE__ */ new Set();
	/**
	* A source containing the number of pending async deriveds/expressions.
	* Only created if `$effect.pending()` is used inside the boundary,
	* otherwise updating the source results in needless `Batch.ensure()`
	* calls followed by no-op flushes
	* @type {Source<number> | null}
	*/
	#effect_pending = null;
	#effect_pending_subscriber = createSubscriber(() => {
		this.#effect_pending = source(this.#local_pending_count);
		return () => {
			this.#effect_pending = null;
		};
	});
	/**
	* @param {TemplateNode} node
	* @param {BoundaryProps} props
	* @param {((anchor: Node) => void)} children
	* @param {((error: unknown) => unknown) | undefined} [transform_error]
	*/
	constructor(node, props, children, transform_error) {
		this.#anchor = node;
		this.#props = props;
		this.#children = (anchor) => {
			var effect = active_effect;
			effect.b = this;
			effect.f |= 128;
			children(anchor);
		};
		this.parent = active_effect.b;
		this.transform_error = transform_error ?? this.parent?.transform_error ?? ((e) => e);
		this.#effect = block(() => {
			if (hydrating) {
				const comment = this.#hydrate_open;
				hydrate_next();
				const server_rendered_pending = comment.data === "[!";
				if (comment.data.startsWith("[?")) {
					const serialized_error = JSON.parse(comment.data.slice(2));
					this.#hydrate_failed_content(serialized_error);
				} else if (server_rendered_pending) this.#hydrate_pending_content();
				else this.#hydrate_resolved_content();
			} else this.#render();
		}, flags);
		if (hydrating) this.#anchor = hydrate_node;
	}
	#hydrate_resolved_content() {
		try {
			this.#main_effect = branch(() => this.#children(this.#anchor));
		} catch (error) {
			this.error(error);
		}
	}
	/**
	* @param {unknown} error The deserialized error from the server's hydration comment
	*/
	#hydrate_failed_content(error) {
		const failed = this.#props.failed;
		const { reset, invoke_onerror } = this.#create_reset(error);
		queue_micro_task(invoke_onerror);
		if (!failed) return;
		this.#failed_effect = branch(() => {
			failed(this.#anchor, () => error, () => reset);
		});
	}
	/**
	* Creates the `reset` function for a failed boundary, along with a function
	* that invokes `onerror` with it (if provided)
	* @param {unknown} error
	* @returns {{ reset: () => void, invoke_onerror: () => void }}
	*/
	#create_reset(error) {
		var did_reset = false;
		var calling_on_error = false;
		const reset = () => {
			if (did_reset) {
				svelte_boundary_reset_noop();
				return;
			}
			did_reset = true;
			if (calling_on_error) svelte_boundary_reset_onerror();
			if (this.#failed_effect !== null) pause_effect(this.#failed_effect, () => {
				this.#failed_effect = null;
			});
			this.#run(() => {
				this.#render();
			});
		};
		const invoke_onerror = () => {
			try {
				calling_on_error = true;
				this.#props.onerror?.(error, reset);
				calling_on_error = false;
			} catch (err) {
				invoke_error_boundary(err, this.#effect && this.#effect.parent);
			}
		};
		return {
			reset,
			invoke_onerror
		};
	}
	#hydrate_pending_content() {
		const pending = this.#props.pending;
		if (!pending) return;
		this.is_pending = true;
		this.#pending_effect = branch(() => pending(this.#anchor));
		queue_micro_task(() => {
			var fragment = this.#offscreen_fragment = document.createDocumentFragment();
			var anchor = create_text();
			var handled = false;
			fragment.append(anchor);
			this.#main_effect = this.#run(() => {
				try {
					return branch(() => this.#children(anchor));
				} catch (error) {
					try {
						this.error(error);
						handled = true;
					} catch (error) {
						invoke_error_boundary(error, this.#effect.parent);
					}
					return null;
				}
			});
			if (this.#main_effect === null) {
				this.#offscreen_fragment = null;
				if (handled) this.#resolve(current_batch);
				return;
			}
			if (this.#pending_count === 0) {
				this.#anchor.before(fragment);
				this.#offscreen_fragment = null;
				pause_effect(this.#pending_effect, () => {
					this.#pending_effect = null;
				});
				this.#resolve(current_batch);
			}
		});
	}
	#render() {
		try {
			this.is_pending = this.has_pending_snippet();
			this.#pending_count = 0;
			this.#local_pending_count = 0;
			this.#main_effect = branch(() => {
				this.#children(this.#anchor);
			});
			if (this.#pending_count > 0) {
				var fragment = this.#offscreen_fragment = document.createDocumentFragment();
				move_effect(this.#main_effect, fragment);
				const pending = this.#props.pending;
				this.#pending_effect = branch(() => pending(this.#anchor));
			} else this.#resolve(current_batch);
		} catch (error) {
			this.error(error);
		}
	}
	/**
	* @param {Batch} batch
	*/
	#resolve(batch) {
		this.is_pending = false;
		batch.transfer_effects(this.#dirty_effects, this.#maybe_dirty_effects);
	}
	/**
	* Defer an effect inside a pending boundary until the boundary resolves
	* @param {Effect} effect
	*/
	defer_effect(effect) {
		defer_effect(effect, this.#dirty_effects, this.#maybe_dirty_effects);
	}
	/**
	* Returns `false` if the effect exists inside a boundary whose pending snippet is shown
	* @returns {boolean}
	*/
	is_rendered() {
		return !this.is_pending && (!this.parent || this.parent.is_rendered());
	}
	has_pending_snippet() {
		return !!this.#props.pending;
	}
	/**
	* @template T
	* @param {() => T} fn
	*/
	#run(fn) {
		var previous_effect = active_effect;
		var previous_reaction = active_reaction;
		var previous_ctx = component_context;
		set_active_effect(this.#effect);
		set_active_reaction(this.#effect);
		set_component_context(this.#effect.ctx);
		try {
			Batch.ensure();
			return fn();
		} finally {
			set_active_effect(previous_effect);
			set_active_reaction(previous_reaction);
			set_component_context(previous_ctx);
		}
	}
	/**
	* Updates the pending count associated with the currently visible pending snippet,
	* if any, such that we can replace the snippet with content once work is done
	* @param {1 | -1} d
	* @param {Batch} batch
	*/
	#update_pending_count(d, batch) {
		if (!this.has_pending_snippet()) {
			if (this.parent) this.parent.#update_pending_count(d, batch);
			return;
		}
		this.#pending_count += d;
		if (this.#pending_count === 0) {
			this.#resolve(batch);
			if (this.#pending_effect) pause_effect(this.#pending_effect, () => {
				this.#pending_effect = null;
			});
			if (this.#offscreen_fragment) {
				this.#anchor.before(this.#offscreen_fragment);
				this.#offscreen_fragment = null;
			}
		}
	}
	/**
	* Update the source that powers `$effect.pending()` inside this boundary,
	* and controls when the current `pending` snippet (if any) is removed.
	* Do not call from inside the class
	* @param {1 | -1} d
	* @param {Batch} batch
	*/
	update_pending_count(d, batch) {
		this.#update_pending_count(d, batch);
		this.#local_pending_count += d;
		if (!this.#effect_pending || this.#pending_count_update_queued) return;
		this.#pending_count_update_queued = true;
		queue_micro_task(() => {
			this.#pending_count_update_queued = false;
			if (this.#effect_pending) internal_set(this.#effect_pending, this.#local_pending_count);
		});
	}
	get_effect_pending() {
		this.#effect_pending_subscriber();
		return get(this.#effect_pending);
	}
	/** @param {unknown} error */
	error(error) {
		if (!this.#props.onerror && !this.#props.failed) throw error;
		if (current_batch?.is_fork) {
			if (this.#main_effect) current_batch.skip_effect(this.#main_effect);
			if (this.#pending_effect) current_batch.skip_effect(this.#pending_effect);
			if (this.#failed_effect) current_batch.skip_effect(this.#failed_effect);
			current_batch.oncommit(() => {
				this.#handle_error(error);
			});
		} else this.#handle_error(error);
	}
	/**
	* @param {unknown} error
	*/
	#handle_error(error) {
		if (this.#main_effect) {
			destroy_effect(this.#main_effect);
			this.#main_effect = null;
		}
		if (this.#pending_effect) {
			destroy_effect(this.#pending_effect);
			this.#pending_effect = null;
		}
		if (this.#failed_effect) {
			destroy_effect(this.#failed_effect);
			this.#failed_effect = null;
		}
		if (hydrating) {
			set_hydrate_node(this.#hydrate_open);
			next();
			set_hydrate_node(skip_nodes());
		}
		let failed = this.#props.failed;
		/** @param {unknown} transformed_error */
		const handle_error_result = (transformed_error) => {
			const { reset, invoke_onerror } = this.#create_reset(transformed_error);
			invoke_onerror();
			if (failed) this.#failed_effect = this.#run(() => {
				try {
					return branch(() => {
						var effect = active_effect;
						effect.b = this;
						effect.f |= 128;
						failed(this.#anchor, () => transformed_error, () => reset);
					});
				} catch (error) {
					invoke_error_boundary(error, this.#effect.parent);
					return null;
				}
			});
		};
		queue_micro_task(() => {
			/** @type {unknown} */
			var result;
			try {
				result = this.transform_error(error);
			} catch (e) {
				invoke_error_boundary(e, this.#effect && this.#effect.parent);
				return;
			}
			if (result !== null && typeof result === "object" && typeof result.then === "function")
 /** @type {any} */ result.then(
				handle_error_result,
				/** @param {unknown} e */
				(e) => invoke_error_boundary(e, this.#effect && this.#effect.parent)
			);
			else handle_error_result(result);
		});
	}
};
/**
* @param {Element} text
* @param {string} value
* @returns {void}
*/
function set_text(text, value) {
	var str = value == null ? "" : typeof value === "object" ? `${value}` : value;
	if (str !== (text[TEXT_CACHE] ??= text.nodeValue)) {
		/** @type {any} */ text[TEXT_CACHE] = str;
		text.nodeValue = `${str}`;
	}
}
/**
* Mounts a component to the given target and returns the exports and potentially the props (if compiled with `accessors: true`) of the component.
* Transitions will play during the initial render unless the `intro` option is set to `false`.
*
* @template {Record<string, any>} Props
* @template {Record<string, any>} Exports
* @param {ComponentType<SvelteComponent<Props>> | Component<Props, Exports, any>} component
* @param {MountOptions<Props>} options
* @returns {Exports}
*/
function mount(component, options) {
	return _mount(component, options);
}
/** @type {Map<EventTarget, Map<string, number>>} */
var listeners = /* @__PURE__ */ new Map();
/**
* @template {Record<string, any>} Exports
* @param {ComponentType<SvelteComponent<any>> | Component<any>} Component
* @param {MountOptions} options
* @returns {Exports}
*/
function _mount(Component, { target, anchor, props = {}, events, context, intro = true, transformError }) {
	init_operations();
	/** @type {Exports} */
	var component = void 0;
	var unmount = component_root(() => {
		var anchor_node = anchor ?? target.appendChild(create_text());
		boundary(anchor_node, { pending: () => {} }, (anchor_node) => {
			push({});
			var ctx = component_context;
			if (context) ctx.c = context;
			if (events)
 /** @type {any} */ props.$$events = events;
			if (hydrating) assign_nodes(anchor_node, null);
			component = Component(anchor_node, props) || mark_as_component();
			if (hydrating) {
				/** @type {Effect & { nodes: EffectNodes }} */ active_effect.nodes.end = hydrate_node;
				if (hydrate_node === null || hydrate_node.nodeType !== 8 || hydrate_node.data !== "]") {
					hydration_mismatch();
					throw HYDRATION_ERROR;
				}
			}
			pop();
		}, transformError);
		/** @type {Set<string>} */
		var registered_events = /* @__PURE__ */ new Set();
		/** @param {Array<string>} events */
		var event_handle = (events) => {
			for (var i = 0; i < events.length; i++) {
				var event_name = events[i];
				if (registered_events.has(event_name)) continue;
				registered_events.add(event_name);
				var passive = is_passive_event(event_name);
				for (const node of [target, document]) {
					var counts = listeners.get(node);
					if (counts === void 0) {
						counts = /* @__PURE__ */ new Map();
						listeners.set(node, counts);
					}
					var count = counts.get(event_name);
					if (count === void 0) {
						node.addEventListener(event_name, handle_event_propagation, { passive });
						counts.set(event_name, 1);
					} else counts.set(event_name, count + 1);
				}
			}
		};
		event_handle(array_from(all_registered_events));
		root_event_handles.add(event_handle);
		return () => {
			for (var event_name of registered_events) for (const node of [target, document]) {
				var counts = listeners.get(node);
				var count = counts.get(event_name);
				if (--count == 0) {
					node.removeEventListener(event_name, handle_event_propagation);
					counts.delete(event_name);
					if (counts.size === 0) listeners.delete(node);
				} else counts.set(event_name, count);
			}
			root_event_handles.delete(event_handle);
			if (anchor_node !== anchor) anchor_node.parentNode?.removeChild(anchor_node);
		};
	});
	mounted_components.set(component, unmount);
	return component;
}
/**
* References of the components that were mounted or hydrated.
* Uses a `WeakMap` to avoid memory leaks.
*/
var mounted_components = /* @__PURE__ */ new WeakMap();
/**
* Unmounts a component that was previously mounted using `mount` or `hydrate`.
*
* Since 5.13.0, if `options.outro` is `true`, [transitions](https://svelte.dev/docs/svelte/transition) will play before the component is removed from the DOM.
*
* Returns a `Promise` that resolves after transitions have completed if `options.outro` is true, or immediately otherwise (prior to 5.13.0, returns `void`).
*
* ```js
* import { mount, unmount } from 'svelte';
* import App from './App.svelte';
*
* const app = mount(App, { target: document.body });
*
* // later...
* unmount(app, { outro: true });
* ```
* @param {Record<string, any>} component
* @param {{ outro?: boolean }} [options]
* @returns {Promise<void>}
*/
function unmount(component, options) {
	const fn = mounted_components.get(component);
	if (fn) {
		mounted_components.delete(component);
		return fn(options);
	}
	return Promise.resolve();
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/branches.js
/** @import { Effect, TemplateNode } from '#client' */
/**
* @typedef {{ effect: Effect, fragment: DocumentFragment }} Branch
*/
/**
* @template Key
*/
var BranchManager = class {
	/** @type {TemplateNode} */
	anchor;
	/** @type {Map<Batch, Key>} */
	#batches = /* @__PURE__ */ new Map();
	/**
	* Map of keys to effects that are currently rendered in the DOM.
	* These effects are visible and actively part of the document tree.
	* Example:
	* ```
	* {#if condition}
	* 	foo
	* {:else}
	* 	bar
	* {/if}
	* ```
	* Can result in the entries `true->Effect` and `false->Effect`
	* @type {Map<Key, Effect>}
	*/
	#onscreen = /* @__PURE__ */ new Map();
	/**
	* Similar to #onscreen with respect to the keys, but contains branches that are not yet
	* in the DOM, because their insertion is deferred.
	* @type {Map<Key, Branch>}
	*/
	#offscreen = /* @__PURE__ */ new Map();
	/**
	* Keys of effects that are currently outroing
	* @type {Set<Key>}
	*/
	#outroing = /* @__PURE__ */ new Set();
	/**
	* Whether to pause (i.e. outro) on change, or destroy immediately.
	* This is necessary for `<svelte:element>`
	*/
	#transition = true;
	/**
	* @param {TemplateNode} anchor
	* @param {boolean} transition
	*/
	constructor(anchor, transition = true) {
		this.anchor = anchor;
		this.#transition = transition;
	}
	/**
	* @param {Batch} batch
	*/
	#commit = (batch) => {
		if (!this.#batches.has(batch)) return;
		var key = this.#batches.get(batch);
		var onscreen = this.#onscreen.get(key);
		if (onscreen) {
			resume_effect(onscreen);
			this.#outroing.delete(key);
		} else {
			var offscreen = this.#offscreen.get(key);
			if (offscreen) {
				resume_effect(offscreen.effect);
				this.#onscreen.set(key, offscreen.effect);
				this.#offscreen.delete(key);
				/** @type {TemplateNode} */ offscreen.fragment.lastChild.remove();
				this.anchor.before(offscreen.fragment);
				onscreen = offscreen.effect;
			}
		}
		for (const [b, k] of this.#batches) {
			this.#batches.delete(b);
			if (b === batch) break;
			const offscreen = this.#offscreen.get(k);
			if (offscreen) {
				destroy_effect(offscreen.effect);
				this.#offscreen.delete(k);
			}
		}
		for (const [k, effect] of this.#onscreen) {
			if (k === key || this.#outroing.has(k)) continue;
			const on_destroy = () => {
				if (Array.from(this.#batches.values()).includes(k)) {
					var fragment = document.createDocumentFragment();
					move_effect(effect, fragment);
					fragment.append(create_text());
					this.#offscreen.set(k, {
						effect,
						fragment
					});
				} else destroy_effect(effect);
				this.#outroing.delete(k);
				this.#onscreen.delete(k);
			};
			if (this.#transition || !onscreen) {
				this.#outroing.add(k);
				pause_effect(effect, on_destroy, false);
			} else on_destroy();
		}
	};
	/**
	* @param {Batch} batch
	*/
	#discard = (batch) => {
		this.#batches.delete(batch);
		const keys = Array.from(this.#batches.values());
		for (const [k, branch] of this.#offscreen) if (!keys.includes(k)) {
			destroy_effect(branch.effect);
			this.#offscreen.delete(k);
		}
	};
	/**
	*
	* @param {any} key
	* @param {null | ((target: TemplateNode) => void)} fn
	*/
	ensure(key, fn) {
		var batch = current_batch;
		var defer = should_defer_append();
		if (fn && !this.#onscreen.has(key) && !this.#offscreen.has(key)) {
			if (defer) {
				var fragment = document.createDocumentFragment();
				var target = create_text();
				fragment.append(target);
				this.#offscreen.set(key, {
					effect: branch(() => fn(target)),
					fragment
				});
			} else this.#onscreen.set(key, branch(() => fn(this.anchor)));
		}
		this.#batches.set(batch, key);
		if (defer) {
			for (const [k, effect] of this.#onscreen) if (k === key) batch.unskip_effect(effect);
			else batch.skip_effect(effect);
			for (const [k, branch] of this.#offscreen) if (k === key) batch.unskip_effect(branch.effect);
			else batch.skip_effect(branch.effect);
			batch.oncommit(this.#commit);
			batch.ondiscard(this.#discard);
		} else {
			if (hydrating) this.anchor = hydrate_node;
			this.#commit(batch);
		}
	}
};
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/if.js
/** @import { TemplateNode } from '#client' */
/**
* @param {TemplateNode} node
* @param {(branch: (fn: (anchor: Node) => void, key?: number | false) => void) => void} fn
* @param {boolean} [elseif] True if this is an `{:else if ...}` block rather than an `{#if ...}`, as that affects which transitions are considered 'local'
* @returns {void}
*/
function if_block(node, fn, elseif = false) {
	/** @type {TemplateNode | undefined} */
	var marker;
	if (hydrating) {
		marker = hydrate_node;
		hydrate_next();
	}
	var branches = new BranchManager(node);
	var flags = elseif ? EFFECT_TRANSPARENT : 0;
	/**
	* @param {number | false} key
	* @param {null | ((anchor: Node) => void)} fn
	*/
	function update_branch(key, fn) {
		if (hydrating) {
			var data = read_hydration_instruction(marker);
			if (key !== parseInt(data.substring(1))) {
				var anchor = skip_nodes();
				set_hydrate_node(anchor);
				branches.anchor = anchor;
				set_hydrating(false);
				branches.ensure(key, fn);
				set_hydrating(true);
				return;
			}
		}
		branches.ensure(key, fn);
	}
	block(() => {
		var has_branch = false;
		fn((fn, key = 0) => {
			has_branch = true;
			update_branch(key, fn);
		});
		if (!has_branch) update_branch(-1, null);
	}, flags);
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/blocks/each.js
/** @import { EachItem, EachOutroGroup, EachState, Effect, EffectNodes, MaybeSource, Source, TemplateNode, TransitionManager, Value } from '#client' */
/** @import { Batch } from '../../reactivity/batch.js'; */
/**
* @param {any} _
* @param {number} i
*/
function index(_, i) {
	return i;
}
/**
* Pause multiple effects simultaneously, and coordinate their
* subsequent destruction. Used in each blocks
* @param {EachState} state
* @param {Effect[]} to_destroy
* @param {null | Node} controlled_anchor
*/
function pause_effects(state, to_destroy, controlled_anchor) {
	/** @type {TransitionManager[]} */
	var transitions = [];
	var length = to_destroy.length;
	/** @type {EachOutroGroup} */
	var group;
	var remaining = to_destroy.length;
	for (var i = 0; i < length; i++) {
		let effect = to_destroy[i];
		pause_effect(effect, () => {
			if (group) {
				group.pending.delete(effect);
				group.done.add(effect);
				if (group.pending.size === 0) {
					var groups = state.outrogroups;
					destroy_effects(state, array_from(group.done));
					groups.delete(group);
					if (groups.size === 0) state.outrogroups = null;
				}
			} else remaining -= 1;
		}, false);
	}
	if (remaining === 0) {
		var fast_path = transitions.length === 0 && controlled_anchor !== null && state.pending.size === 0;
		if (fast_path) {
			var anchor = controlled_anchor;
			var parent_node = anchor.parentNode;
			clear_text_content(parent_node);
			parent_node.append(anchor);
			state.items.clear();
		}
		destroy_effects(state, to_destroy, !fast_path);
	} else {
		group = {
			pending: new Set(to_destroy),
			done: /* @__PURE__ */ new Set()
		};
		(state.outrogroups ??= /* @__PURE__ */ new Set()).add(group);
	}
}
/**
* @param {EachState} state
* @param {Effect[]} to_destroy
* @param {boolean} remove_dom
*/
function destroy_effects(state, to_destroy, remove_dom = true) {
	/** @type {Set<Effect> | undefined} */
	var preserved_effects;
	if (state.pending.size > 0) {
		preserved_effects = /* @__PURE__ */ new Set();
		for (const keys of state.pending.values()) for (const key of keys) preserved_effects.add(
			/** @type {EachItem} */
			state.items.get(key).e
		);
	}
	for (var i = 0; i < to_destroy.length; i++) {
		var e = to_destroy[i];
		if (preserved_effects?.has(e)) {
			e.f |= EFFECT_OFFSCREEN;
			move_effect(e, document.createDocumentFragment());
		} else destroy_effect(to_destroy[i], remove_dom);
	}
}
/** @type {TemplateNode} */
var offscreen_anchor;
/**
* @template V
* @param {Element | Comment} node The next sibling node, or the parent node if this is a 'controlled' block
* @param {number} flags
* @param {() => V[]} get_collection
* @param {(value: V, index: number) => any} get_key
* @param {(anchor: Node, item: MaybeSource<V>, index: MaybeSource<number>) => void} render_fn
* @param {null | ((anchor: Node) => void)} fallback_fn
* @returns {void}
*/
function each(node, flags, get_collection, get_key, render_fn, fallback_fn = null) {
	var anchor = node;
	/** @type {Map<any, EachItem>} */
	var items = /* @__PURE__ */ new Map();
	if ((flags & 4) !== 0) {
		var parent_node = node;
		anchor = hydrating ? set_hydrate_node(/* @__PURE__ */ get_first_child(parent_node)) : parent_node.appendChild(create_text());
	}
	if (hydrating) hydrate_next();
	/** @type {Effect | null} */
	var fallback = null;
	var each_array = /* @__PURE__ */ derived_safe_equal(() => {
		var collection = get_collection();
		return is_array(collection) ? collection : collection == null ? [] : array_from(collection);
	});
	/** @type {V[]} */
	var array;
	/** @type {Map<Batch, Set<any>>} */
	var pending = /* @__PURE__ */ new Map();
	var first_run = true;
	/**
	* @param {Batch} batch
	*/
	function commit(batch) {
		if ((state.effect.f & 16384) !== 0) return;
		state.pending.delete(batch);
		state.fallback = fallback;
		reconcile(state, array, anchor, flags, get_key);
		if (fallback !== null) {
			if (array.length === 0) {
				if ((fallback.f & 33554432) === 0) resume_effect(fallback);
				else {
					fallback.f ^= EFFECT_OFFSCREEN;
					move(fallback, null, anchor);
				}
			} else pause_effect(fallback, () => {
				fallback = null;
			});
		}
	}
	/**
	* @param {Batch} batch
	*/
	function discard(batch) {
		state.pending.delete(batch);
	}
	/** @type {EachState} */
	var state = {
		effect: block(() => {
			array = get(each_array);
			var length = array.length;
			/** `true` if there was a hydration mismatch. Needs to be a `let` or else it isn't treeshaken out */
			let mismatch = false;
			if (hydrating) {
				if (read_hydration_instruction(anchor) === "[!" !== (length === 0)) {
					anchor = skip_nodes();
					set_hydrate_node(anchor);
					set_hydrating(false);
					mismatch = true;
				}
			}
			var keys = /* @__PURE__ */ new Set();
			var batch = current_batch;
			var defer = should_defer_append();
			for (var index = 0; index < length; index += 1) {
				if (hydrating && hydrate_node.nodeType === 8 && hydrate_node.data === "]") {
					anchor = hydrate_node;
					mismatch = true;
					set_hydrating(false);
				}
				var value = array[index];
				var key = get_key(value, index);
				var item = first_run ? null : items.get(key);
				if (item) {
					if (item.v) internal_set(item.v, value);
					if (item.i) internal_set(item.i, index);
					if (defer) batch.unskip_effect(item.e);
				} else {
					item = create_item(items, first_run ? anchor : offscreen_anchor ??= create_text(), value, key, index, render_fn, flags, get_collection);
					if (!first_run) item.e.f |= EFFECT_OFFSCREEN;
					items.set(key, item);
				}
				keys.add(key);
			}
			if (length === 0 && fallback_fn && !fallback) {
				if (first_run) fallback = branch(() => fallback_fn(anchor));
				else {
					fallback = branch(() => fallback_fn(offscreen_anchor ??= create_text()));
					fallback.f |= EFFECT_OFFSCREEN;
				}
			}
			if (length > keys.size) each_key_duplicate("", "", "");
			if (hydrating && length > 0) set_hydrate_node(skip_nodes());
			if (!first_run) {
				pending.set(batch, keys);
				if (defer) {
					for (const [key, item] of items) if (!keys.has(key)) batch.skip_effect(item.e);
					batch.oncommit(commit);
					batch.ondiscard(discard);
				} else commit(batch);
			}
			if (mismatch) set_hydrating(true);
			get(each_array);
		}),
		flags,
		items,
		pending,
		outrogroups: null,
		fallback
	};
	first_run = false;
	if (hydrating) anchor = hydrate_node;
}
/**
* Skip past any non-branch effects (which could be created with `createSubscriber`, for example) to find the next branch effect
* @param {Effect | null} effect
* @returns {Effect | null}
*/
function skip_to_branch(effect) {
	while (effect !== null && (effect.f & 32) === 0) effect = effect.next;
	return effect;
}
/**
* Add, remove, or reorder items output by an each block as its input changes
* @template V
* @param {EachState} state
* @param {Array<V>} array
* @param {Element | Comment | Text} anchor
* @param {number} flags
* @param {(value: V, index: number) => any} get_key
* @returns {void}
*/
function reconcile(state, array, anchor, flags, get_key) {
	var is_animated = (flags & 8) !== 0;
	var length = array.length;
	var items = state.items;
	var current = skip_to_branch(state.effect.first);
	/** @type {undefined | Set<Effect>} */
	var seen;
	/** @type {Effect | null} */
	var prev = null;
	/** @type {undefined | Set<Effect>} */
	var to_animate;
	/** @type {Effect[]} */
	var matched = [];
	/** @type {Effect[]} */
	var stashed = [];
	/** @type {V} */
	var value;
	/** @type {any} */
	var key;
	/** @type {Effect | undefined} */
	var effect;
	/** @type {number} */
	var i;
	if (is_animated) for (i = 0; i < length; i += 1) {
		value = array[i];
		key = get_key(value, i);
		effect = items.get(key).e;
		if ((effect.f & 33554432) === 0) {
			effect.nodes?.a?.measure();
			(to_animate ??= /* @__PURE__ */ new Set()).add(effect);
		}
	}
	for (i = 0; i < length; i += 1) {
		value = array[i];
		key = get_key(value, i);
		effect = items.get(key).e;
		if (state.outrogroups !== null) for (const group of state.outrogroups) {
			group.pending.delete(effect);
			group.done.delete(effect);
		}
		if ((effect.f & 8192) !== 0) {
			resume_effect(effect);
			if (is_animated) {
				effect.nodes?.a?.unfix();
				(to_animate ??= /* @__PURE__ */ new Set()).delete(effect);
			}
		}
		if ((effect.f & 33554432) !== 0) {
			effect.f ^= EFFECT_OFFSCREEN;
			if (effect === current) move(effect, null, anchor);
			else {
				var next = prev ? prev.next : current;
				if (effect === state.effect.last) state.effect.last = effect.prev;
				if (effect.prev) effect.prev.next = effect.next;
				if (effect.next) effect.next.prev = effect.prev;
				link(state, prev, effect);
				link(state, effect, next);
				move(effect, next, anchor);
				prev = effect;
				matched = [];
				stashed = [];
				current = skip_to_branch(prev.next);
				continue;
			}
		}
		if (effect !== current) {
			if (seen !== void 0 && seen.has(effect)) {
				if (matched.length < stashed.length) {
					var start = stashed[0];
					var j;
					prev = start.prev;
					var a = matched[0];
					var b = matched[matched.length - 1];
					for (j = 0; j < matched.length; j += 1) move(matched[j], start, anchor);
					for (j = 0; j < stashed.length; j += 1) seen.delete(stashed[j]);
					link(state, a.prev, b.next);
					link(state, prev, a);
					link(state, b, start);
					current = start;
					prev = b;
					i -= 1;
					matched = [];
					stashed = [];
				} else {
					seen.delete(effect);
					move(effect, current, anchor);
					link(state, effect.prev, effect.next);
					link(state, effect, prev === null ? state.effect.first : prev.next);
					link(state, prev, effect);
					prev = effect;
				}
				continue;
			}
			matched = [];
			stashed = [];
			while (current !== null && current !== effect) {
				(seen ??= /* @__PURE__ */ new Set()).add(current);
				stashed.push(current);
				current = skip_to_branch(current.next);
			}
			if (current === null) continue;
		}
		if ((effect.f & 33554432) === 0) matched.push(effect);
		prev = effect;
		current = skip_to_branch(effect.next);
	}
	if (state.outrogroups !== null) {
		for (const group of state.outrogroups) if (group.pending.size === 0) {
			destroy_effects(state, array_from(group.done));
			state.outrogroups?.delete(group);
		}
		if (state.outrogroups.size === 0) state.outrogroups = null;
	}
	if (current !== null || seen !== void 0) {
		/** @type {Effect[]} */
		var to_destroy = [];
		if (seen !== void 0) {
			for (effect of seen) if ((effect.f & 8192) === 0) to_destroy.push(effect);
		}
		while (current !== null) {
			if ((current.f & 8192) === 0 && current !== state.fallback) to_destroy.push(current);
			current = skip_to_branch(current.next);
		}
		var destroy_length = to_destroy.length;
		if (destroy_length > 0) {
			var controlled_anchor = (flags & 4) !== 0 && length === 0 ? anchor : null;
			if (is_animated) {
				for (i = 0; i < destroy_length; i += 1) to_destroy[i].nodes?.a?.measure();
				for (i = 0; i < destroy_length; i += 1) to_destroy[i].nodes?.a?.fix();
			}
			pause_effects(state, to_destroy, controlled_anchor);
		}
	}
	if (is_animated) queue_micro_task(() => {
		if (to_animate === void 0) return;
		for (effect of to_animate) effect.nodes?.a?.apply();
	});
}
/**
* @template V
* @param {Map<any, EachItem>} items
* @param {Node} anchor
* @param {V} value
* @param {unknown} key
* @param {number} index
* @param {(anchor: Node, item: V | Source<V>, index: number | Value<number>, collection: () => V[]) => void} render_fn
* @param {number} flags
* @param {() => V[]} get_collection
* @returns {EachItem}
*/
function create_item(items, anchor, value, key, index, render_fn, flags, get_collection) {
	var v = (flags & 1) !== 0 ? (flags & 16) === 0 ? /* @__PURE__ */ mutable_source(value, false, false) : source(value) : null;
	var i = (flags & 2) !== 0 ? source(index) : null;
	return {
		v,
		i,
		e: branch(() => {
			render_fn(anchor, v ?? value, i ?? index, get_collection);
			return () => {
				items.delete(key);
			};
		})
	};
}
/**
* @param {Effect} effect
* @param {Effect | null} next
* @param {Text | Element | Comment} anchor
*/
function move(effect, next, anchor) {
	if (!effect.nodes) return;
	var node = effect.nodes.start;
	var end = effect.nodes.end;
	var dest = next && (next.f & 33554432) === 0 ? next.nodes.start : anchor;
	while (node !== null) {
		var next_node = /* @__PURE__ */ get_next_sibling(node);
		dest.before(node);
		if (node === end) return;
		node = next_node;
	}
}
/**
* @param {EachState} state
* @param {Effect | null} prev
* @param {Effect | null} next
*/
function link(state, prev, next) {
	if (prev === null) state.effect.first = next;
	else prev.next = next;
	if (next === null) state.effect.last = prev;
	else next.prev = prev;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/css.js
/**
* @param {Node} anchor
* @param {{ hash: string, code: string }} css
*/
function append_styles(anchor, css) {
	effect(() => {
		anchor = active_effect?.parent?.nodes?.start ?? anchor;
		var root = anchor.getRootNode();
		var target = root.host ? root : /** @type {Document} */ root.head ?? root.ownerDocument.head;
		if (!target.querySelector("#" + css.hash)) {
			const style = create_element("style");
			style.id = css.hash;
			style.textContent = css.code;
			target.appendChild(style);
		}
	});
}
//#endregion
//#region node_modules/svelte/src/internal/shared/attributes.js
var whitespace = [..." 	\n\r\f\xA0\v﻿"];
/**
* @param {any} value
* @param {string | null} [hash]
* @param {Record<string, boolean>} [directives]
* @returns {string | null}
*/
function to_class(value, hash, directives) {
	var classname = value == null ? "" : "" + value;
	if (hash) classname = classname ? classname + " " + hash : hash;
	if (directives) {
		for (var key of Object.keys(directives)) if (directives[key]) classname = classname ? classname + " " + key : key;
		else if (classname.length) {
			var len = key.length;
			var a = 0;
			while ((a = classname.indexOf(key, a)) >= 0) {
				var b = a + len;
				if ((a === 0 || whitespace.includes(classname[a - 1])) && (b === classname.length || whitespace.includes(classname[b]))) classname = (a === 0 ? "" : classname.substring(0, a)) + classname.substring(b + 1);
				else a = b;
			}
		}
	}
	return classname === "" ? null : classname;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/class.js
/**
* @param {Element} dom
* @param {boolean | number} is_html
* @param {string | null} value
* @param {string} [hash]
* @param {Record<string, any>} [prev_classes]
* @param {Record<string, any>} [next_classes]
* @returns {Record<string, boolean> | undefined}
*/
function set_class(dom, is_html, value, hash, prev_classes, next_classes) {
	var prev = dom[CLASS_CACHE];
	if (hydrating || prev !== value || prev === void 0) {
		var next_class_name = to_class(value, hash, next_classes);
		if (!hydrating || next_class_name !== dom.getAttribute("class")) {
			if (next_class_name == null) dom.removeAttribute("class");
			else if (is_html) dom.className = next_class_name;
			else dom.setAttribute("class", next_class_name);
		}
		/** @type {any} */ dom[CLASS_CACHE] = value;
	} else if (next_classes && prev_classes !== next_classes) for (var key in next_classes) {
		var is_present = !!next_classes[key];
		if (prev_classes == null || is_present !== !!prev_classes[key]) dom.classList.toggle(key, is_present);
	}
	return next_classes;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/bindings/select.js
/**
* Sets the `selected` attribute on an option so form reset can restore it.
* @param {HTMLOptionElement} option
* @param {boolean} selected
*/
function set_selected(option, selected) {
	if (selected) {
		if (!option.hasAttribute("selected")) option.setAttribute("selected", "");
	} else option.removeAttribute("selected");
}
/**
* Marks the options matching `__defaultValue` as selected. Without `preserve`
* a newly matching option gets selected, as an inserted `<option selected>` would.
* @param {HTMLSelectElement} select
* @param {boolean} preserve
*/
function apply_default_select_value(select, preserve) {
	var value = select.__defaultValue;
	var multiple = select.multiple;
	var values = multiple ? value ?? [] : null;
	if (multiple && !is_array(values)) return;
	var index = select.selectedIndex;
	var selected = preserve && multiple ? new Set(select.selectedOptions) : null;
	for (var option of select.options) {
		var option_value = get_option_value(option);
		set_selected(option, multiple ? values.includes(option_value) : is(option_value, value));
	}
	if (!preserve) return;
	if (selected !== null) for (option of select.options) {
		var was_selected = selected.has(option);
		if (option.selected !== was_selected) option.selected = was_selected;
	}
	else if (select.selectedIndex !== index) select.selectedIndex = index;
}
/**
* Selects the correct option(s) (depending on whether this is a multiple select)
* @template V
* @param {HTMLSelectElement} select
* @param {V} value
* @param {boolean} mounting
*/
function select_option(select, value, mounting = false) {
	if (select.multiple) {
		if (value == void 0) return;
		if (!is_array(value)) return select_multiple_invalid_value();
		for (var option of select.options) option.selected = value.includes(get_option_value(option));
		return;
	}
	for (option of select.options) if (is(get_option_value(option), value)) {
		option.selected = true;
		return;
	}
	if (!mounting || value !== void 0) select.selectedIndex = -1;
}
/**
* Sets up a mutation observer to sync the current selection
* and default to the dom when the options change, for example
* when they are inside an `#each` block. Called once per `<select>`,
* by the compiled output or by `attribute_effect` for spreads.
* @param {HTMLSelectElement} select
*/
function init_select(select) {
	var observer = new MutationObserver((entries) => {
		if (entries.every(is_selectedcontent_mutation)) return;
		if ("__defaultValue" in select) apply_default_select_value(select, false);
		if ("__value" in select) select_option(select, select.__value);
	});
	observer.observe(select, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["value"]
	});
	teardown(() => {
		observer.disconnect();
	});
}
/**
* @param {HTMLSelectElement} select
* @param {() => unknown} get
* @param {(value: unknown) => void} set
* @returns {void}
*/
function bind_select_value(select, get, set = get) {
	var batches = /* @__PURE__ */ new WeakSet();
	var mounting = true;
	listen_to_event_and_reset_event(select, "change", (is_reset) => {
		var query = is_reset ? "[selected]" : ":checked";
		/** @type {unknown} */
		var value;
		if (select.multiple) value = [].map.call(select.querySelectorAll(query), get_option_value);
		else {
			/** @type {HTMLOptionElement | null} */
			var selected_option = select.querySelector(query) ?? select.querySelector("option:not([disabled])");
			value = selected_option && get_option_value(selected_option);
		}
		set(value);
		select.__value = value;
		if (current_batch !== null) batches.add(current_batch);
	});
	effect(() => {
		var value = get();
		if (select === document.activeElement) {
			var batch = async_mode_flag ? previous_batch : current_batch;
			if (batches.has(batch)) return;
		}
		select_option(select, value, mounting);
		if (mounting && value === void 0) {
			/** @type {HTMLOptionElement | null} */
			var selected_option = select.querySelector(":checked");
			if (selected_option !== null) {
				value = get_option_value(selected_option);
				set(value);
			}
		}
		select.__value = value;
		mounting = false;
	});
}
/** @param {HTMLOptionElement} option */
function get_option_value(option) {
	if ("__value" in option) return option.__value;
	else return option.value;
}
/**
* Returns `true` if the mutation stems from the browser mirroring the selected
* option's content into `<selectedcontent>`, or from us replacing the
* `<selectedcontent>` element with a clone of itself
* @param {MutationRecord} entry
*/
function is_selectedcontent_mutation(entry) {
	if (entry.target.closest("selectedcontent") !== null) return true;
	if (entry.type === "childList") {
		var nodes = [...entry.addedNodes, ...entry.removedNodes];
		return nodes.length > 0 && nodes.every((node) => node.nodeName === "SELECTEDCONTENT");
	}
	return false;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/attributes.js
/** @import { Blocker, Effect } from '#client' */
var IS_CUSTOM_ELEMENT = Symbol("is custom element");
var IS_HTML = Symbol("is html");
var LINK_TAG = IS_XHTML ? "link" : "LINK";
/**
* The value/checked attribute in the template actually corresponds to the defaultValue property, so we need
* to remove it upon hydration to avoid a bug when someone resets the form value.
* @param {HTMLInputElement} input
* @returns {void}
*/
function remove_input_defaults(input) {
	if (!hydrating) return;
	var already_removed = false;
	var remove_defaults = () => {
		if (already_removed) return;
		already_removed = true;
		if (input.hasAttribute("value")) {
			var value = input.value;
			set_attribute(input, "value", null);
			input.value = value;
		}
		if (input.hasAttribute("checked")) {
			var checked = input.checked;
			set_attribute(input, "checked", null);
			input.checked = checked;
		}
	};
	/** @type {any} */ input[FORM_RESET_HANDLER] = remove_defaults;
	queue_micro_task(remove_defaults);
	add_form_reset_listener();
}
/**
* @param {Element} element
* @param {string} attribute
* @param {string | null} value
* @param {boolean} [skip_warning]
*/
function set_attribute(element, attribute, value, skip_warning) {
	var attributes = get_attributes(element);
	if (hydrating) {
		attributes[attribute] = element.getAttribute(attribute);
		if (attribute === "src" || attribute === "srcset" || attribute === "href" && element.nodeName === LINK_TAG) {
			if (!skip_warning);
			return;
		}
	}
	if (attributes[attribute] === (attributes[attribute] = value)) return;
	if (attribute === "loading") element[LOADING_ATTR_SYMBOL] = value;
	if (value == null) element.removeAttribute(attribute);
	else if (typeof value !== "string" && get_setters(element).has(attribute)) element[attribute] = value;
	else element.setAttribute(attribute, value);
}
/**
*
* @param {Element} element
*/
function get_attributes(element) {
	return element[ATTRIBUTES_CACHE] ??= {
		[IS_CUSTOM_ELEMENT]: element.nodeName.includes("-"),
		[IS_HTML]: element.namespaceURI === NAMESPACE_HTML
	};
}
/** @type {Map<string, Set<string>>} */
var setters_cache = /* @__PURE__ */ new Map();
/** @param {Element} element */
function get_setters(element) {
	var cache_key = element.getAttribute("is") || element.nodeName;
	var setters = setters_cache.get(cache_key);
	if (setters) return setters;
	setters_cache.set(cache_key, setters = /* @__PURE__ */ new Set());
	var descriptors;
	var proto = element;
	var element_proto = Element.prototype;
	while (element_proto !== proto) {
		descriptors = get_descriptors(proto);
		for (var key in descriptors) if (descriptors[key].set && key !== "innerHTML" && key !== "textContent" && key !== "innerText") setters.add(key);
		proto = get_prototype_of(proto);
	}
	return setters;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/bindings/input.js
/** @import { Batch } from '../../../reactivity/batch.js' */
/**
* @param {HTMLInputElement} input
* @param {() => unknown} get
* @param {(value: unknown) => void} set
* @returns {void}
*/
function bind_value(input, get, set = get) {
	var batches = /* @__PURE__ */ new WeakSet();
	listen_to_event_and_reset_event(input, "input", async (is_reset) => {
		/** @type {any} */
		var value = is_reset ? input.defaultValue : input.value;
		value = is_numberlike_input(input) ? to_number(value) : value;
		set(value);
		if (current_batch !== null) batches.add(current_batch);
		await tick();
		if (value !== (value = get())) {
			var start = input.selectionStart;
			var end = input.selectionEnd;
			var length = input.value.length;
			input.value = value ?? "";
			if (end !== null) {
				var new_length = input.value.length;
				if (start === end && end === length && new_length > length) {
					input.selectionStart = new_length;
					input.selectionEnd = new_length;
				} else {
					input.selectionStart = start;
					input.selectionEnd = Math.min(end, new_length);
				}
			}
		}
	});
	if (hydrating && input.defaultValue !== input.value || untrack(get) == null && input.value) {
		set(is_numberlike_input(input) ? to_number(input.value) : input.value);
		if (current_batch !== null) batches.add(current_batch);
	}
	render_effect(() => {
		var value = get();
		if (input === document.activeElement) {
			var batch = async_mode_flag ? previous_batch : current_batch;
			if (batches.has(batch)) return;
		}
		if (is_numberlike_input(input) && value === to_number(input.value)) return;
		if (input.type === "date" && !value && !input.value) return;
		if (value !== input.value) input.value = value ?? "";
	});
}
/**
* @param {HTMLInputElement} input
* @param {() => unknown} get
* @param {(value: unknown) => void} set
* @returns {void}
*/
function bind_checked(input, get, set = get) {
	listen_to_event_and_reset_event(input, "change", (is_reset) => {
		set(is_reset ? input.defaultChecked : input.checked);
	});
	if (hydrating && input.defaultChecked !== input.checked || untrack(get) == null) set(input.checked);
	render_effect(() => {
		var value = get();
		input.checked = Boolean(value);
	});
}
/**
* @param {HTMLInputElement} input
*/
function is_numberlike_input(input) {
	var type = input.type;
	return type === "number" || type === "range";
}
/**
* @param {string} value
*/
function to_number(value) {
	return value === "" ? null : +value;
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/elements/bindings/props.js
/**
* Makes an `export`ed (non-prop) variable available on the `$$props` object
* so that consumers can do `bind:x` on the component.
* @template V
* @param {Record<string, unknown>} props
* @param {string} prop
* @param {V} value
* @returns {void}
*/
function bind_prop(props, prop, value) {
	var desc = get_descriptor(props, prop);
	if (desc && desc.set) {
		props[prop] = value;
		teardown(() => {
			props[prop] = null;
		});
	}
}
//#endregion
//#region node_modules/svelte/src/internal/client/dom/legacy/lifecycle.js
/** @import { ComponentContextLegacy } from '#client' */
/**
* Legacy-mode only: Call `onMount` callbacks and set up `beforeUpdate`/`afterUpdate` effects
* @param {boolean} [immutable]
*/
function init(immutable = false) {
	const context = component_context;
	const callbacks = context.l.u;
	if (!callbacks) return;
	let props = () => deep_read_state(context.s);
	if (immutable) {
		let version = 0;
		let prev = {};
		const d = /* @__PURE__ */ derived(() => {
			let changed = false;
			const props = context.s;
			for (const key in props) if (props[key] !== prev[key]) {
				prev[key] = props[key];
				changed = true;
			}
			if (changed) version++;
			return version;
		});
		props = () => get(d);
	}
	if (callbacks.b.length) user_pre_effect(() => {
		observe_all(context, props);
		run_all(callbacks.b);
	});
	user_effect(() => {
		const fns = untrack(() => callbacks.m.map(run));
		return () => {
			for (const fn of fns) if (typeof fn === "function") fn();
		};
	});
	if (callbacks.a.length) user_effect(() => {
		observe_all(context, props);
		run_all(callbacks.a);
	});
}
/**
* Invoke the getter of all signals associated with a component
* so they can be registered to the effect this function is called in.
* @param {ComponentContextLegacy} context
* @param {(() => void)} props
*/
function observe_all(context, props) {
	if (context.l.s) for (const signal of context.l.s) get(signal);
	props();
}
//#endregion
//#region node_modules/svelte/src/internal/client/reactivity/props.js
/** @import { Derived, Effect, Source } from './types.js' */
/**
* This function is responsible for synchronizing a possibly bound prop with the inner component state.
* It is used whenever the compiler sees that the component writes to the prop, or when it has a default prop_value.
* @template V
* @param {Record<string, unknown>} props
* @param {string} key
* @param {number} flags
* @param {V | (() => V)} [fallback]
* @returns {(() => V | ((arg: V) => V) | ((arg: V, mutation: boolean) => V))}
*/
function prop(props, key, flags, fallback) {
	var runes = !legacy_mode_flag || (flags & 2) !== 0;
	var bindable = (flags & 8) !== 0;
	var lazy = (flags & 16) !== 0;
	var fallback_value = fallback;
	var fallback_dirty = true;
	var fallback_signal = void 0;
	var get_fallback = () => {
		if (lazy && runes) {
			fallback_signal ??= /* @__PURE__ */ derived(fallback);
			return get(fallback_signal);
		}
		if (fallback_dirty) {
			fallback_dirty = false;
			fallback_value = lazy ? untrack(fallback) : fallback;
		}
		return fallback_value;
	};
	/** @type {((v: V) => void) | undefined} */
	let setter;
	if (bindable) {
		var is_entry_props = STATE_SYMBOL in props || LEGACY_PROPS in props;
		setter = get_descriptor(props, key)?.set ?? (is_entry_props && key in props ? (v) => props[key] = v : void 0);
	}
	/** @type {V} */
	var initial_value;
	var is_store_sub = false;
	if (bindable) [initial_value, is_store_sub] = capture_store_binding(() => props[key]);
	else initial_value = props[key];
	if (initial_value === void 0 && fallback !== void 0) {
		initial_value = get_fallback();
		if (setter) {
			if (runes) props_invalid_value(key);
			setter(initial_value);
		}
	}
	/** @type {() => V} */
	var getter;
	if (runes) getter = () => {
		var value = props[key];
		if (value === void 0) return get_fallback();
		fallback_dirty = true;
		return value;
	};
	else getter = () => {
		var value = props[key];
		if (value !== void 0) fallback_value = void 0;
		return value === void 0 ? fallback_value : value;
	};
	if (runes && (flags & 4) === 0) return getter;
	if (setter) {
		var legacy_parent = props.$$legacy;
		return (function(value, mutation) {
			if (arguments.length > 0) {
				if (!runes || !mutation || legacy_parent || is_store_sub)
 /** @type {Function} */ setter(mutation ? getter() : value);
				return value;
			}
			return getter();
		});
	}
	var overridden = false;
	var d = ((flags & 1) !== 0 ? derived : derived_safe_equal)(() => {
		overridden = false;
		return getter();
	});
	if (bindable) get(d);
	var parent_effect = active_effect;
	return (function(value, mutation) {
		if (arguments.length > 0) {
			const new_value = mutation ? get(d) : runes && bindable ? proxy(value) : value;
			set(d, new_value);
			overridden = true;
			if (fallback_value !== void 0) fallback_value = new_value;
			return value;
		}
		if (is_destroying_effect && overridden || (parent_effect.f & 16384) !== 0) return d.v;
		return get(d);
	});
}
if (typeof HTMLElement === "function");
//#endregion
//#region node_modules/svelte/src/internal/disclose-version.js
if (typeof window !== "undefined") ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add("5");
//#endregion
//#region node_modules/svelte/src/internal/flags/legacy.js
enable_legacy_mode_flag();
//#endregion
//#region src/CharacterInteraction.svelte
var root$1 = /* @__PURE__ */ from_html(`<option class="svelte-vtwlay"> </option>`);
var root_1$1 = /* @__PURE__ */ from_html(`<div class="gate-grid svelte-vtwlay"><label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 使用者已成年</label> <label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 所有角色明确成年</label> <label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 自愿与同意已确认</label></div> <p> </p>`, 1);
var root_2$1 = /* @__PURE__ */ from_html(`<div class="eci-shell svelte-vtwlay"><header class="svelte-vtwlay"><div class="svelte-vtwlay"><h2 class="svelte-vtwlay">🎭 动态角色交互预设器</h2> <p class="svelte-vtwlay">Svelte 技术验证节点 · 生成结构化配置与提示词片段</p></div> <span> </span></header> <main class="svelte-vtwlay"><section class="grid compact svelte-vtwlay"><label class="svelte-vtwlay"><span class="svelte-vtwlay">制作强度</span> <select class="svelte-vtwlay"><option class="svelte-vtwlay">S · 轻量</option><option class="svelte-vtwlay">SR · 标准</option><option class="svelte-vtwlay">SSR · 精致</option><option class="svelte-vtwlay">UR · 旗舰</option></select> <small class="svelte-vtwlay"> </small></label> <label class="svelte-vtwlay"><span class="svelte-vtwlay">动态类型</span> <select class="svelte-vtwlay"></select></label> <label class="svelte-vtwlay"><span class="svelte-vtwlay">片段时长</span> <select class="svelte-vtwlay"><option class="svelte-vtwlay">5 秒</option><option class="svelte-vtwlay">7 秒</option><option class="svelte-vtwlay">10 秒</option><option class="svelte-vtwlay">15 秒</option></select></label> <label class="svelte-vtwlay"><span class="svelte-vtwlay">输出组织</span> <select class="svelte-vtwlay"><option class="svelte-vtwlay">单片段 · 不循环</option><option class="svelte-vtwlay">单片段 · 无缝循环</option><option class="svelte-vtwlay">可选拼接</option><option class="svelte-vtwlay">连续拼接</option></select></label></section> <label class="wide svelte-vtwlay"><span class="svelte-vtwlay">角色表演意图</span> <textarea rows="3" placeholder="角色在做什么、看向哪里、情绪如何变化……" class="svelte-vtwlay"></textarea></label> <section class="switches svelte-vtwlay"><label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> AI 补全动作</label> <label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 锁定角色一致性</label> <label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 自动场景</label> <label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 自动特效</label> <label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 自动镜头</label> <label class="svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 保留视频参考入口</label></section> <section class="adult-card svelte-vtwlay"><div class="adult-head svelte-vtwlay"><div class="svelte-vtwlay"><b class="svelte-vtwlay">独立内容分级</b> <small class="svelte-vtwlay">S / SR / SSR / UR 只表示制作强度，不和成人尺度混用</small></div> <label class="toggle svelte-vtwlay"><input type="checkbox" class="svelte-vtwlay"/> 成人向开关</label></div> <!></section> <section class="preview svelte-vtwlay"><div class="preview-head svelte-vtwlay"><b class="svelte-vtwlay">实时提示词预览</b><span class="svelte-vtwlay"> </span></div> <pre class="svelte-vtwlay"> </pre></section></main></div>`);
var $$css$1 = {
	hash: "svelte-vtwlay",
	code: ".comfy-dom-widget > .eci-shell {width:100%;height:100%;}.eci-shell.svelte-vtwlay, .eci-shell.svelte-vtwlay :where(.svelte-vtwlay) {box-sizing:border-box;}.eci-shell.svelte-vtwlay {--bg: var(--eagle-vue-bg, var(--comfy-menu-bg, #11141a));--panel: var(--eagle-vue-panel, color-mix(in srgb, var(--bg) 87%, white 13%));--panel2: var(--eagle-vue-surface, color-mix(in srgb, var(--bg) 93%, white 7%));--input: var(--eagle-vue-input, color-mix(in srgb, var(--bg) 78%, black 22%));--line: var(--eagle-vue-border, color-mix(in srgb, var(--bg) 68%, white 32%));--text: var(--eagle-vue-text, var(--fg-color, #edf1f8));--muted: var(--eagle-vue-muted, color-mix(in srgb, var(--text) 62%, var(--bg) 38%));--accent: var(--eagle-vue-primary, var(--p-primary-color, #2f82db));width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;font:12px/1.45 system-ui, \"Microsoft YaHei\", sans-serif;}header.svelte-vtwlay {display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;background:var(--panel);border-bottom:1px solid var(--line);}h2.svelte-vtwlay {margin:0;font-size:15px;}header.svelte-vtwlay p:where(.svelte-vtwlay) {margin:2px 0 0;color:var(--muted);font-size:10px;}header.svelte-vtwlay > span:where(.svelte-vtwlay) {color:#e1b45a;border:1px solid #755e34;border-radius:999px;padding:2px 8px;white-space:nowrap;}header.svelte-vtwlay > span.saved:where(.svelte-vtwlay) {color:#77d89a;border-color:#386c4a;}main.svelte-vtwlay {flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:12px;display:flex;flex-direction:column;gap:11px;}.grid.svelte-vtwlay {display:grid;gap:9px;}.grid.compact.svelte-vtwlay {grid-template-columns:repeat(2,minmax(0,1fr));}label.svelte-vtwlay > span:where(.svelte-vtwlay), .wide.svelte-vtwlay > span:where(.svelte-vtwlay) {display:block;color:var(--muted);margin-bottom:4px;}select.svelte-vtwlay, textarea.svelte-vtwlay {width:100%;color:var(--text);background:var(--input);border:1px solid var(--line);border-radius:6px;padding:7px 8px;font:inherit;outline:none;}select.svelte-vtwlay:focus, textarea.svelte-vtwlay:focus {border-color:var(--accent);}textarea.svelte-vtwlay {resize:vertical;min-height:54px;}small.svelte-vtwlay {display:block;color:var(--muted);font-size:9px;margin-top:3px;}.switches.svelte-vtwlay {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);}.switches.svelte-vtwlay label:where(.svelte-vtwlay), .gate-grid.svelte-vtwlay label:where(.svelte-vtwlay), .toggle.svelte-vtwlay {display:flex;align-items:center;gap:6px;color:var(--text);}input[type=\"checkbox\"].svelte-vtwlay {accent-color:var(--accent);}.adult-card.svelte-vtwlay {border:1px solid #725a35;border-radius:8px;padding:9px;background:color-mix(in srgb,var(--panel2) 90%,#5b3719 10%);}.adult-head.svelte-vtwlay {display:flex;justify-content:space-between;gap:10px;align-items:center;}.adult-head.svelte-vtwlay small:where(.svelte-vtwlay) {max-width:360px;}.gate-grid.svelte-vtwlay {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:9px;padding-top:8px;border-top:1px dashed #6b583c;}.adult-card.svelte-vtwlay p:where(.svelte-vtwlay) {margin:7px 0 0;color:#f0b45d;font-size:10px;}.adult-card.svelte-vtwlay p.ok:where(.svelte-vtwlay) {color:#76d594;}.preview.svelte-vtwlay {min-height:180px;height:230px;flex:0 0 230px;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--input);}.preview-head.svelte-vtwlay {display:flex;justify-content:space-between;padding:7px 9px;background:var(--panel);border-bottom:1px solid var(--line);}.preview-head.svelte-vtwlay span:where(.svelte-vtwlay) {color:var(--muted);font-size:10px;}pre.svelte-vtwlay {flex:1;min-height:0;margin:0;padding:10px;overflow:auto;scrollbar-gutter:stable;white-space:pre-wrap;word-break:break-word;color:#cae7d2;font:10.5px/1.55 ui-monospace,Consolas,monospace;}main.svelte-vtwlay::-webkit-scrollbar, pre.svelte-vtwlay::-webkit-scrollbar {width:10px;height:10px;}main.svelte-vtwlay::-webkit-scrollbar-track, pre.svelte-vtwlay::-webkit-scrollbar-track {background:var(--bg);}main.svelte-vtwlay::-webkit-scrollbar-thumb, pre.svelte-vtwlay::-webkit-scrollbar-thumb {background:color-mix(in srgb,var(--line) 82%,var(--accent) 18%);border:2px solid var(--bg);border-radius:8px;}main.svelte-vtwlay::-webkit-scrollbar-thumb:hover, pre.svelte-vtwlay::-webkit-scrollbar-thumb:hover {background:var(--accent);}\n  @media (max-width: 620px) {.switches.svelte-vtwlay, .gate-grid.svelte-vtwlay {grid-template-columns:repeat(2,minmax(0,1fr));} }"
};
function CharacterInteraction($$anchor, $$props) {
	push($$props, false);
	append_styles($$anchor, $$css$1);
	const preview = /* @__PURE__ */ mutable_source();
	let initialState = prop($$props, "initialState", 24, () => ({}));
	let onStateChange = prop($$props, "onStateChange", 8, () => {});
	const defaults = {
		schema: "eagle.character_interaction.v1",
		productionLevel: "SR",
		dynamicType: "live_idle",
		durationSeconds: 7,
		outputMode: "single_loop",
		interactionIntent: "角色面向观众，保持自然呼吸和目光交流",
		aiMotionAutofill: true,
		autoScene: true,
		autoEffects: true,
		autoCamera: true,
		preserveIdentity: true,
		allowVideoReference: false,
		contentRating: "general",
		adultMode: false,
		ageVerified: false,
		allCharactersAdult: false,
		consentConfirmed: false
	};
	let state = /* @__PURE__ */ mutable_source({
		...defaults,
		...initialState() || {}
	});
	let saved = /* @__PURE__ */ mutable_source(true);
	function loadState(nextState) {
		set(state, {
			...defaults,
			...nextState || {}
		});
		set(saved, true);
	}
	const levelNotes = {
		S: "单一动作 · 固定镜头 · 快速生成",
		SR: "动作弧线 + 表情变化 · 默认推荐",
		SSR: "场景、镜头和特效协同",
		UR: "多段叙事设计 · 高复杂度与高成本"
	};
	const motionNotes = {
		live_idle: "Live 待机互动",
		greeting: "招呼 / 登场",
		expression_sticker: "动态表情包",
		showcase: "角色展示",
		dramatic: "情绪演出",
		action: "动作 / 战斗",
		short_drama: "AI 短剧镜头"
	};
	function adultGateOpen(value) {
		return value.adultMode && value.ageVerified && value.allCharactersAdult && value.consentConfirmed;
	}
	function previewPrompt(value) {
		const lines = [
			`【角色交互】${motionNotes[value.dynamicType] || value.dynamicType}`,
			`【制作强度】${value.productionLevel}：${levelNotes[value.productionLevel]}`,
			`【时长与输出】${value.durationSeconds} 秒；${value.outputMode}`,
			`【表演意图】${value.interactionIntent || "自然互动"}`,
			value.preserveIdentity ? "【角色一致性】锁定脸部、发型、服装、体型与主色，不漂移、不换装。" : "【角色一致性】允许适度造型变化。",
			value.aiMotionAutofill ? "【动作补全】由 AI 补齐预备、主动作、缓冲与收势，重心和惯性连续。" : "【动作补全】关闭，仅执行明确描述。",
			value.outputMode.includes("loop") ? "【循环】首尾姿态、视线、光照与背景运动闭合，避免停顿、跳帧和重复卡点。" : "【循环】不强制闭环，保留自然结尾。",
			`【自动化】场景 ${value.autoScene ? "开" : "关"}；特效 ${value.autoEffects ? "开" : "关"}；镜头 ${value.autoCamera ? "开" : "关"}。`,
			value.allowVideoReference ? "【动作参考】允许视频参考，但默认仍可由 AI 推演动作。" : "【动作参考】不依赖参考视频，由 AI 按动作语义推演。"
		];
		if (value.adultMode) lines.push(adultGateOpen(value) ? "【内容分级】成人向闸门已满足；实际内容仍须遵守模型和平台规则。" : "【内容分级】成人向闸门未满足，执行时自动回退到普通级。");
		else lines.push("【内容分级】普通级；制作强度 S/SR/SSR/UR 不代表成人尺度。");
		return lines.join("\n");
	}
	function commit() {
		set(saved, false);
		set(state, {
			...get(state),
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		onStateChange()(get(state));
		requestAnimationFrame(() => set(saved, true));
	}
	legacy_pre_effect(() => get(state), () => {
		set(preview, previewPrompt(get(state)));
	});
	legacy_pre_effect_reset();
	var $$exports = { loadState };
	init();
	var div = root_2$1();
	var header = child(div);
	var span = sibling(child(header), 2);
	let classes;
	var text = only_child(span, true);
	reset(header);
	var main = sibling(header, 2);
	var section = child(main);
	var label_1 = child(section);
	var select = sibling(child(label_1), 2);
	var option = child(select);
	option.value = option.__value = "S";
	var option_1 = sibling(option);
	option_1.value = option_1.__value = "SR";
	var option_2 = sibling(option_1);
	option_2.value = option_2.__value = "SSR";
	var option_3 = sibling(option_2);
	option_3.value = option_3.__value = "UR";
	reset(select);
	init_select(select);
	var text_1 = only_child(sibling(select, 2), true);
	reset(label_1);
	var label_2 = sibling(label_1, 2);
	var select_1 = sibling(child(label_2), 2);
	each(select_1, 5, () => untrack(() => Object.entries(motionNotes)), index, ($$anchor, $$item) => {
		var $$array = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array)[0];
		let label = () => get($$array)[1];
		var option_4 = root$1();
		var text_2 = only_child(option_4, true);
		var option_4_value = {};
		template_effect(() => {
			set_text(text_2, label());
			if (option_4_value !== (option_4_value = value())) option_4.value = (option_4.__value = option_4_value) ?? "";
		});
		append($$anchor, option_4);
	});
	reset(select_1);
	init_select(select_1);
	reset(label_2);
	var label_3 = sibling(label_2, 2);
	var select_2 = sibling(child(label_3), 2);
	var option_5 = child(select_2);
	option_5.value = option_5.__value = 5;
	var option_6 = sibling(option_5);
	option_6.value = option_6.__value = 7;
	var option_7 = sibling(option_6);
	option_7.value = option_7.__value = 10;
	var option_8 = sibling(option_7);
	option_8.value = option_8.__value = 15;
	reset(select_2);
	init_select(select_2);
	reset(label_3);
	var label_4 = sibling(label_3, 2);
	var select_3 = sibling(child(label_4), 2);
	var option_9 = child(select_3);
	option_9.value = option_9.__value = "single_clip";
	var option_10 = sibling(option_9);
	option_10.value = option_10.__value = "single_loop";
	var option_11 = sibling(option_10);
	option_11.value = option_11.__value = "optional_chain";
	var option_12 = sibling(option_11);
	option_12.value = option_12.__value = "continuous_chain";
	reset(select_3);
	init_select(select_3);
	reset(label_4);
	reset(section);
	var label_5 = sibling(section, 2);
	var textarea = sibling(child(label_5), 2);
	remove_textarea_child(textarea);
	reset(label_5);
	var section_1 = sibling(label_5, 2);
	var label_6 = child(section_1);
	var input = child(label_6);
	remove_input_defaults(input);
	next();
	reset(label_6);
	var label_7 = sibling(label_6, 2);
	var input_1 = child(label_7);
	remove_input_defaults(input_1);
	next();
	reset(label_7);
	var label_8 = sibling(label_7, 2);
	var input_2 = child(label_8);
	remove_input_defaults(input_2);
	next();
	reset(label_8);
	var label_9 = sibling(label_8, 2);
	var input_3 = child(label_9);
	remove_input_defaults(input_3);
	next();
	reset(label_9);
	var label_10 = sibling(label_9, 2);
	var input_4 = child(label_10);
	remove_input_defaults(input_4);
	next();
	reset(label_10);
	var label_11 = sibling(label_10, 2);
	var input_5 = child(label_11);
	remove_input_defaults(input_5);
	next();
	reset(label_11);
	reset(section_1);
	var section_2 = sibling(section_1, 2);
	var div_1 = child(section_2);
	var label_12 = sibling(child(div_1), 2);
	var input_6 = child(label_12);
	remove_input_defaults(input_6);
	next();
	reset(label_12);
	reset(div_1);
	var node = sibling(div_1, 2);
	var consequent = ($$anchor) => {
		var fragment = root_1$1();
		var div_2 = first_child(fragment);
		var label_13 = child(div_2);
		var input_7 = child(label_13);
		remove_input_defaults(input_7);
		next();
		reset(label_13);
		var label_14 = sibling(label_13, 2);
		var input_8 = child(label_14);
		remove_input_defaults(input_8);
		next();
		reset(label_14);
		var label_15 = sibling(label_14, 2);
		var input_9 = child(label_15);
		remove_input_defaults(input_9);
		next();
		reset(label_15);
		reset(div_2);
		var p = sibling(div_2, 2);
		let classes_1;
		var text_3 = only_child(p, true);
		template_effect(($0, $1) => {
			classes_1 = set_class(p, 1, "svelte-vtwlay", null, classes_1, { ok: $0 });
			set_text(text_3, $1);
		}, [() => adultGateOpen(get(state)), () => (get(state), untrack(() => adultGateOpen(get(state)) ? "闸门已满足" : "闸门未满足：后端将自动回退普通级"))]);
		bind_checked(input_7, () => get(state).ageVerified, ($$value) => (mutate(state, get(state).ageVerified = $$value), invalidate_inner_signals(() => {})));
		event("change", input_7, commit);
		bind_checked(input_8, () => get(state).allCharactersAdult, ($$value) => (mutate(state, get(state).allCharactersAdult = $$value), invalidate_inner_signals(() => {})));
		event("change", input_8, commit);
		bind_checked(input_9, () => get(state).consentConfirmed, ($$value) => (mutate(state, get(state).consentConfirmed = $$value), invalidate_inner_signals(() => {})));
		event("change", input_9, commit);
		append($$anchor, fragment);
	};
	if_block(node, ($$render) => {
		if (get(state), untrack(() => get(state).adultMode)) $$render(consequent);
	});
	reset(section_2);
	var section_3 = sibling(section_2, 2);
	var div_3 = child(section_3);
	var text_4 = only_child(sibling(child(div_3)));
	reset(div_3);
	var text_5 = only_child(sibling(div_3, 2), true);
	reset(section_3);
	reset(main);
	reset(div);
	template_effect(() => {
		classes = set_class(span, 1, "svelte-vtwlay", null, classes, { saved: get(saved) });
		set_text(text, get(saved) ? "已同步" : "同步中");
		set_text(text_1, (get(state), untrack(() => levelNotes[get(state).productionLevel])));
		set_text(text_4, `${(get(preview), untrack(() => get(preview).length)) ?? ""} 字符`);
		set_text(text_5, get(preview));
	});
	bind_select_value(select, () => get(state).productionLevel, ($$value) => (mutate(state, get(state).productionLevel = $$value), invalidate_inner_signals(() => {})));
	event("change", select, commit);
	bind_select_value(select_1, () => get(state).dynamicType, ($$value) => (mutate(state, get(state).dynamicType = $$value), invalidate_inner_signals(() => {})));
	event("change", select_1, commit);
	bind_select_value(select_2, () => get(state).durationSeconds, ($$value) => (mutate(state, get(state).durationSeconds = $$value), invalidate_inner_signals(() => {})));
	event("change", select_2, commit);
	bind_select_value(select_3, () => get(state).outputMode, ($$value) => (mutate(state, get(state).outputMode = $$value), invalidate_inner_signals(() => {})));
	event("change", select_3, commit);
	bind_value(textarea, () => get(state).interactionIntent, ($$value) => (mutate(state, get(state).interactionIntent = $$value), invalidate_inner_signals(() => {})));
	event("change", textarea, commit);
	bind_checked(input, () => get(state).aiMotionAutofill, ($$value) => (mutate(state, get(state).aiMotionAutofill = $$value), invalidate_inner_signals(() => {})));
	event("change", input, commit);
	bind_checked(input_1, () => get(state).preserveIdentity, ($$value) => (mutate(state, get(state).preserveIdentity = $$value), invalidate_inner_signals(() => {})));
	event("change", input_1, commit);
	bind_checked(input_2, () => get(state).autoScene, ($$value) => (mutate(state, get(state).autoScene = $$value), invalidate_inner_signals(() => {})));
	event("change", input_2, commit);
	bind_checked(input_3, () => get(state).autoEffects, ($$value) => (mutate(state, get(state).autoEffects = $$value), invalidate_inner_signals(() => {})));
	event("change", input_3, commit);
	bind_checked(input_4, () => get(state).autoCamera, ($$value) => (mutate(state, get(state).autoCamera = $$value), invalidate_inner_signals(() => {})));
	event("change", input_4, commit);
	bind_checked(input_5, () => get(state).allowVideoReference, ($$value) => (mutate(state, get(state).allowVideoReference = $$value), invalidate_inner_signals(() => {})));
	event("change", input_5, commit);
	bind_checked(input_6, () => get(state).adultMode, ($$value) => (mutate(state, get(state).adultMode = $$value), invalidate_inner_signals(() => {})));
	event("change", input_6, commit);
	append($$anchor, div);
	bind_prop($$props, "loadState", loadState);
	return pop($$exports);
}
//#endregion
//#region src/CharacterPV.svelte
var root = /* @__PURE__ */ from_html(`<option class="svelte-63pebg"> </option>`);
var root_1 = /* @__PURE__ */ from_html(`<button> </button>`);
var root_2 = /* @__PURE__ */ from_html(`<section class="grid four svelte-63pebg"><label class="svelte-63pebg"><span class="svelte-63pebg">BPM</span><input type="number" min="40" max="240" class="svelte-63pebg"/></label> <label class="svelte-63pebg"><span class="svelte-63pebg">节拍偏移 ms</span><input type="number" min="-2000" max="2000" class="svelte-63pebg"/></label> <label class="svelte-63pebg"><span class="svelte-63pebg">文字处理</span><select class="svelte-63pebg"></select></label> <div class="checks svelte-63pebg"><label class="svelte-63pebg"><input type="checkbox" class="svelte-63pebg"/> 保留标题安全区</label><label class="svelte-63pebg"><input type="checkbox" class="svelte-63pebg"/> 视频动作参考</label></div></section> <section class="grid two svelte-63pebg"><label class="svelte-63pebg"><span class="svelte-63pebg">后期标题</span><input placeholder="只作为元数据，不让模型绘字" class="svelte-63pebg"/></label><label class="svelte-63pebg"><span class="svelte-63pebg">副标题</span><input class="svelte-63pebg"/></label></section> <section class="chips svelte-63pebg"><b class="svelte-63pebg">转场</b><div class="svelte-63pebg"></div></section> <section class="chips svelte-63pebg"><b class="svelte-63pebg">特效</b><div class="svelte-63pebg"></div></section>`, 1);
var root_3 = /* @__PURE__ */ from_html(`<label class="svelte-63pebg"><input type="checkbox" class="svelte-63pebg"/> 使用者成年</label><label class="svelte-63pebg"><input type="checkbox" class="svelte-63pebg"/> 角色明确成年</label><label class="svelte-63pebg"><input type="checkbox" class="svelte-63pebg"/> 自愿同意</label>`, 1);
var root_4 = /* @__PURE__ */ from_html(`<div class="epv-shell svelte-63pebg"><header class="svelte-63pebg"><div class="svelte-63pebg"><h2 class="svelte-63pebg">⚡ 角色 PV · 动效规划器</h2><p class="svelte-63pebg">Svelte 独立节点 · 输出 H3 底片提示词与后期元数据</p></div> <span> </span></header> <main class="svelte-63pebg"><section class="grid four svelte-63pebg"><label class="svelte-63pebg"><span class="svelte-63pebg">制作强度</span><select class="svelte-63pebg"></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">片段时长</span><select class="svelte-63pebg"><option class="svelte-63pebg">5 秒</option><option class="svelte-63pebg">7 秒</option><option class="svelte-63pebg">10 秒</option><option class="svelte-63pebg">15 秒</option></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">输出组织</span><select class="svelte-63pebg"><option class="svelte-63pebg">单片段</option><option class="svelte-63pebg">单片段循环</option><option class="svelte-63pebg">可选拼接</option><option class="svelte-63pebg">连续拼接</option></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">切镜密度</span><select class="svelte-63pebg"><option class="svelte-63pebg">疏朗</option><option class="svelte-63pebg">标准</option><option class="svelte-63pebg">密集</option></select></label></section> <section class="grid two svelte-63pebg"><label class="svelte-63pebg"><span class="svelte-63pebg">创意主题</span><select class="svelte-63pebg"></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">视觉风格</span><select class="svelte-63pebg"></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">PV 模板</span><select class="svelte-63pebg"></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">节奏结构</span><select class="svelte-63pebg"></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">剪辑语法</span><select class="svelte-63pebg"></select></label> <label class="svelte-63pebg"><span class="svelte-63pebg">角色动作</span><select class="svelte-63pebg"></select></label></section> <label class="wide svelte-63pebg"><span class="svelte-63pebg">创意简述</span><textarea rows="2" class="svelte-63pebg"></textarea></label> <label class="wide svelte-63pebg"><span class="svelte-63pebg">动作方向</span><textarea rows="2" placeholder="角色的预备动作、峰值姿态、收势与视线方向" class="svelte-63pebg"></textarea></label> <button class="section-toggle svelte-63pebg"> </button> <!> <section class="rating svelte-63pebg"><div class="svelte-63pebg"><b class="svelte-63pebg">独立内容分级</b><small class="svelte-63pebg">S / SR / SSR / UR 仅表示制作复杂度</small></div> <label class="svelte-63pebg"><input type="checkbox" class="svelte-63pebg"/> 成人向开关</label> <!></section> <section class="preview svelte-63pebg"><div class="preview-head svelte-63pebg"><b class="svelte-63pebg">H3 / 后期提示词预览</b><span class="svelte-63pebg"> </span></div><pre class="svelte-63pebg"> </pre></section></main></div>`);
var $$css = {
	hash: "svelte-63pebg",
	code: ".epv-shell.svelte-63pebg, .epv-shell.svelte-63pebg :where(.svelte-63pebg) {box-sizing:border-box;}.epv-shell.svelte-63pebg {--bg:var(--eagle-vue-bg,var(--comfy-menu-bg,#101116));--panel:var(--eagle-vue-panel,#15171d);--surface:var(--eagle-vue-surface,#191b23);--surface2:var(--eagle-vue-surface-alt,#20232d);--input:var(--eagle-vue-input,#0c0e13);--line:var(--eagle-vue-border,#303441);--text:var(--eagle-vue-text,var(--fg-color,#e4e7ee));--muted:var(--eagle-vue-muted,#9299aa);--accent:var(--eagle-vue-primary,var(--p-primary-color,#2f82db));width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;font:12px/1.45 system-ui,\"Microsoft YaHei\",sans-serif;}header.svelte-63pebg{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--panel);border-bottom:1px solid var(--line)}h2.svelte-63pebg{margin:0;font-size:15px}header.svelte-63pebg p:where(.svelte-63pebg){margin:2px 0 0;color:var(--muted);font-size:10px}header.svelte-63pebg>span:where(.svelte-63pebg){color:#e1b45a;border:1px solid #755e34;border-radius:999px;padding:2px 8px}header.svelte-63pebg>span.saved:where(.svelte-63pebg){color:#77d89a;border-color:#386c4a}main.svelte-63pebg{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:12px;display:flex;flex-direction:column;gap:10px}.grid.svelte-63pebg{display:grid;gap:8px}.grid.two.svelte-63pebg{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.four.svelte-63pebg{grid-template-columns:repeat(4,minmax(0,1fr))}label.svelte-63pebg>span:where(.svelte-63pebg){display:block;color:var(--muted);margin-bottom:4px}select.svelte-63pebg,input.svelte-63pebg,textarea.svelte-63pebg{width:100%;color:var(--text);background:var(--input);border:1px solid var(--line);border-radius:6px;padding:7px 8px;font:inherit;outline:none}select.svelte-63pebg:focus,input.svelte-63pebg:focus,textarea.svelte-63pebg:focus{border-color:var(--accent)}textarea.svelte-63pebg{resize:vertical}.checks.svelte-63pebg{display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding-bottom:4px}.checks.svelte-63pebg label:where(.svelte-63pebg),.rating.svelte-63pebg label:where(.svelte-63pebg){display:flex;align-items:center;gap:5px}.checks.svelte-63pebg input:where(.svelte-63pebg),.rating.svelte-63pebg input:where(.svelte-63pebg){width:auto;accent-color:var(--accent)}.section-toggle.svelte-63pebg{padding:7px 9px;text-align:left;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:7px;cursor:pointer}.chips.svelte-63pebg{padding:8px;border:1px solid var(--line);border-radius:7px;background:var(--surface)}.chips.svelte-63pebg>b:where(.svelte-63pebg){display:block;margin-bottom:6px}.chips.svelte-63pebg>div:where(.svelte-63pebg){display:flex;flex-wrap:wrap;gap:5px}.chips.svelte-63pebg button:where(.svelte-63pebg){padding:4px 7px;color:var(--muted);background:var(--surface2);border:1px solid var(--line);border-radius:999px;cursor:pointer}.chips.svelte-63pebg button.active:where(.svelte-63pebg){color:#fff;background:var(--accent);border-color:var(--accent)}.rating.svelte-63pebg{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px;border:1px solid #725a35;border-radius:7px;background:color-mix(in srgb,var(--surface) 90%,#5b3719 10%)}.rating.svelte-63pebg>div:where(.svelte-63pebg){margin-right:auto}.rating.svelte-63pebg small:where(.svelte-63pebg){display:block;color:var(--muted);font-size:9px}.preview.svelte-63pebg{height:240px;min-height:190px;flex:0 0 240px;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--input)}.preview-head.svelte-63pebg{display:flex;justify-content:space-between;padding:7px 9px;background:var(--panel);border-bottom:1px solid var(--line)}.preview-head.svelte-63pebg span:where(.svelte-63pebg){color:var(--muted);font-size:10px}pre.svelte-63pebg{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;margin:0;padding:10px;white-space:pre-wrap;word-break:break-word;color:#cae7d2;font:10.5px/1.55 ui-monospace,Consolas,monospace}main.svelte-63pebg::-webkit-scrollbar,pre.svelte-63pebg::-webkit-scrollbar{width:10px;height:10px}main.svelte-63pebg::-webkit-scrollbar-track,pre.svelte-63pebg::-webkit-scrollbar-track{background:var(--bg)}main.svelte-63pebg::-webkit-scrollbar-thumb,pre.svelte-63pebg::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--line) 82%,var(--accent) 18%);border:2px solid var(--bg);border-radius:8px}main.svelte-63pebg::-webkit-scrollbar-thumb:hover,pre.svelte-63pebg::-webkit-scrollbar-thumb:hover{background:var(--accent)}\n  @media(max-width:720px){.grid.four.svelte-63pebg{grid-template-columns:repeat(2,minmax(0,1fr))}}"
};
function CharacterPV($$anchor, $$props) {
	push($$props, false);
	append_styles($$anchor, $$css);
	const preview = /* @__PURE__ */ mutable_source();
	let initialState = prop($$props, "initialState", 24, () => ({}));
	let onStateChange = prop($$props, "onStateChange", 8, () => {});
	const defaults = {
		schema: "eagle.character_pv.v1",
		enabled: true,
		productionLevel: "SSR",
		durationSeconds: 10,
		outputMode: "optional_chain",
		theme: "auto",
		visualStyle: "auto",
		template: "character_reveal",
		rhythm: "beat_sync",
		editGrammar: "match_on_action",
		actionProfile: "graceful",
		cutDensity: "medium",
		bpm: 120,
		beatOffsetMs: 0,
		title: "",
		subtitle: "",
		textTreatment: "hero_nameplate",
		reserveTitleSafeArea: true,
		allowVideoReference: false,
		transitions: [
			"flash_cut",
			"match_cut",
			"whip_zoom"
		],
		effects: [
			"deep_glow",
			"bokeh",
			"rgb_split"
		],
		creativeBrief: "围绕角色标志性外观和性格完成一次有记忆点的登场展示",
		actionDirection: "",
		notes: "",
		adultMode: false,
		ageVerified: false,
		allCharactersAdult: false,
		consentConfirmed: false
	};
	const choices = {
		productionLevel: [
			["S", "S · 轻量"],
			["SR", "SR · 标准"],
			["SSR", "SSR · 精致"],
			["UR", "UR · 旗舰"]
		],
		theme: [
			["auto", "自动匹配"],
			["hero_origin", "英雄起源"],
			["neon_idol", "霓虹偶像"],
			["fantasy_relic", "幻想遗物"],
			["urban_chase", "都市追逐"],
			["dream_archive", "梦境档案"],
			["dark_rival", "暗黑宿敌"],
			["festival_stage", "庆典舞台"],
			["tech_interface", "科技界面"],
			["fashion_editorial", "时尚大片"],
			["quiet_portrait", "安静肖像"]
		],
		visualStyle: [
			["auto", "保持参考媒介"],
			["anime_cel", "二维赛璐璐"],
			["live_action_cinematic", "真人电影感"],
			["graphic_comic", "图形漫画"],
			["y2k_digital", "Y2K 数字"],
			["retro_film", "复古胶片"],
			["luxury_editorial", "奢华编辑风"],
			["minimal_monochrome", "极简黑白"],
			["holographic", "全息视觉"],
			["ink_paper", "水墨纸张"]
		],
		template: [
			["character_reveal", "角色揭晓"],
			["kinetic_typography", "动效文字版式"],
			["image_flash", "图像快闪"],
			["mixed_pv", "综合角色 PV"],
			["action_showcase", "动作展示"],
			["emotional_memory", "情绪记忆"],
			["fashion_editorial", "时尚编辑"]
		],
		rhythm: [
			["beat_sync", "节拍同步"],
			["impact_accents", "冲击重音"],
			["smooth_cinematic", "平滑电影感"],
			["glitch_cut", "故障切镜"],
			["syncopated", "切分节奏"],
			["crescendo", "渐强推进"]
		],
		editGrammar: [
			["auto", "自动剪辑语法"],
			["detail_to_hero", "细节到全身"],
			["match_on_action", "动作匹配"],
			["shape_match", "形状匹配"],
			["color_match", "颜色匹配"],
			["eyeline_bridge", "视线衔接"],
			["beat_strobe", "节拍闪切"],
			["time_remap", "速度重映射"],
			["split_screen", "分屏"],
			["freeze_smash", "定格冲切"],
			["foreground_wipe", "前景遮挡"]
		],
		actionProfile: [
			["calm", "克制沉稳"],
			["graceful", "优雅"],
			["energetic", "活力"],
			["combat", "战斗"],
			["idol", "偶像表演"],
			["mysterious", "神秘"],
			["comedic", "喜剧反应"]
		],
		textTreatment: [
			["safe_title", "安全区标题"],
			["hero_nameplate", "角色名牌"],
			["kinetic_words", "动态短词"],
			["subtitle_card", "标题 + 副标题"],
			["no_text", "不使用文字"]
		]
	};
	const transitionOptions = [
		["hard_cut", "硬切"],
		["cut_on_action", "动作点切"],
		["flash_cut", "闪白切"],
		["match_cut", "匹配剪辑"],
		["graphic_match", "图形匹配"],
		["whip_pan", "甩镜平移"],
		["whip_zoom", "甩镜缩放"],
		["foreground_wipe", "前景遮挡"],
		["luma_wipe", "亮度擦除"],
		["speed_ramp", "变速转场"],
		["freeze_smash", "定格冲切"],
		["light_sweep", "扫光转场"]
	];
	const effectOptions = [
		["deep_glow", "Deep Glow"],
		["bokeh", "Bokeh"],
		["rgb_split", "RGB 分离"],
		["pixel_sort", "Pixel Sort"],
		["frame_echo", "帧回声"],
		["light_leak", "漏光"],
		["halftone", "半调网点"],
		["particle_burst", "粒子爆发"],
		["film_grain", "胶片颗粒"],
		["bloom_pulse", "辉光脉冲"],
		["hologram", "全息层"],
		["graphic_shapes", "动态图形"]
	];
	let state = /* @__PURE__ */ mutable_source({
		...defaults,
		...initialState() || {}
	});
	let saved = /* @__PURE__ */ mutable_source(true);
	let advancedOpen = /* @__PURE__ */ mutable_source(true);
	function loadState(nextState) {
		set(state, {
			...defaults,
			...nextState || {}
		});
		set(saved, true);
	}
	function label(group, value) {
		return (choices[group] || []).find(([key]) => key === value)?.[1] || value;
	}
	function adultGateOpen(value) {
		return value.adultMode && value.ageVerified && value.allCharactersAdult && value.consentConfirmed;
	}
	function previewPrompt(value) {
		const loop = value.outputMode === "single_loop" || value.outputMode === "continuous_chain";
		const lines = [
			"CHARACTER PV / MOTION-GRAPHICS CONTRACT:",
			`- Duration: ${value.durationSeconds}s; production ${value.productionLevel}; output ${value.outputMode}.`,
			`- Theme: ${label("theme", value.theme)}; visual style: ${label("visualStyle", value.visualStyle)}.`,
			`- Template: ${label("template", value.template)}; rhythm: ${label("rhythm", value.rhythm)} at ${value.bpm} BPM.`,
			`- Editing grammar: ${label("editGrammar", value.editGrammar)}; cut density: ${value.cutDensity}.`,
			`- Character action profile: ${label("actionProfile", value.actionProfile)}.`,
			`- Planned transitions for post: ${value.transitions.join(", ") || "clean_cut"}.`,
			`- Planned effects for post: ${value.effects.join(", ") || "none"}.`,
			"- Generate clean, temporally stable character plates; preserve face, hairstyle, costume, proportions, props and palette.",
			"- Treat flashes, RGB split, glitches, exact masks and typography as post-production metadata; do not deform the character to imitate them.",
			`- Typography treatment: ${label("textTreatment", value.textTreatment)}; never draw readable titles or logos into generated footage.`,
			value.reserveTitleSafeArea ? "- Reserve clean title-safe negative space away from face, hands and signature costume details." : "- No title-safe area is required.",
			loop ? "- Close the final pose, gaze, lighting and graphic phase back to the opening frame for a seamless loop." : "- Keep a clean editorial tail frame for cutting or optional assembly.",
			value.allowVideoReference ? "- Motion reference input is allowed when supplied." : "- Do not require video reference; infer motion from character intent and action semantics."
		];
		if (value.title) lines.push(`- Exact post title (metadata only): ${value.title}`);
		if (value.subtitle) lines.push(`- Exact post subtitle (metadata only): ${value.subtitle}`);
		if (value.creativeBrief) lines.push(`- Creative brief: ${value.creativeBrief}`);
		if (value.actionDirection) lines.push(`- Action direction: ${value.actionDirection}`);
		if (value.notes) lines.push(`- Additional direction: ${value.notes}`);
		lines.push(adultGateOpen(value) ? "- Adult gate satisfied; remain within model and platform rules." : "- General-audience content profile; S/SR/SSR/UR indicates production complexity only.");
		return lines.join("\n");
	}
	function commit() {
		set(saved, false);
		set(state, {
			...get(state),
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		onStateChange()(get(state));
		requestAnimationFrame(() => set(saved, true));
	}
	function toggleList(key, value) {
		const current = get(state)[key] || [];
		set(state, {
			...get(state),
			[key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
		});
		commit();
	}
	legacy_pre_effect(() => get(state), () => {
		set(preview, previewPrompt(get(state)));
	});
	legacy_pre_effect_reset();
	var $$exports = { loadState };
	init();
	var div = root_4();
	var header = child(div);
	var span = sibling(child(header), 2);
	let classes;
	var text_1 = only_child(span, true);
	reset(header);
	var main = sibling(header, 2);
	var section = child(main);
	var label_1 = child(section);
	var select = sibling(child(label_1));
	each(select, 5, () => untrack(() => choices.productionLevel), index, ($$anchor, $$item) => {
		var $$array = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array)[0];
		let text = () => get($$array)[1];
		var option = root();
		var text_2 = only_child(option, true);
		var option_value = {};
		template_effect(() => {
			set_text(text_2, text());
			if (option_value !== (option_value = value())) option.value = (option.__value = option_value) ?? "";
		});
		append($$anchor, option);
	});
	reset(select);
	init_select(select);
	reset(label_1);
	var label_2 = sibling(label_1, 2);
	var select_1 = sibling(child(label_2));
	var option_1 = child(select_1);
	option_1.value = option_1.__value = 5;
	var option_2 = sibling(option_1);
	option_2.value = option_2.__value = 7;
	var option_3 = sibling(option_2);
	option_3.value = option_3.__value = 10;
	var option_4 = sibling(option_3);
	option_4.value = option_4.__value = 15;
	reset(select_1);
	init_select(select_1);
	reset(label_2);
	var label_3 = sibling(label_2, 2);
	var select_2 = sibling(child(label_3));
	var option_5 = child(select_2);
	option_5.value = option_5.__value = "single_clip";
	var option_6 = sibling(option_5);
	option_6.value = option_6.__value = "single_loop";
	var option_7 = sibling(option_6);
	option_7.value = option_7.__value = "optional_chain";
	var option_8 = sibling(option_7);
	option_8.value = option_8.__value = "continuous_chain";
	reset(select_2);
	init_select(select_2);
	reset(label_3);
	var label_4 = sibling(label_3, 2);
	var select_3 = sibling(child(label_4));
	var option_9 = child(select_3);
	option_9.value = option_9.__value = "sparse";
	var option_10 = sibling(option_9);
	option_10.value = option_10.__value = "medium";
	var option_11 = sibling(option_10);
	option_11.value = option_11.__value = "dense";
	reset(select_3);
	init_select(select_3);
	reset(label_4);
	reset(section);
	var section_1 = sibling(section, 2);
	var label_5 = child(section_1);
	var select_4 = sibling(child(label_5));
	each(select_4, 5, () => untrack(() => choices.theme), index, ($$anchor, $$item) => {
		var $$array_1 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array_1)[0];
		let text = () => get($$array_1)[1];
		var option_12 = root();
		var text_3 = only_child(option_12, true);
		var option_12_value = {};
		template_effect(() => {
			set_text(text_3, text());
			if (option_12_value !== (option_12_value = value())) option_12.value = (option_12.__value = option_12_value) ?? "";
		});
		append($$anchor, option_12);
	});
	reset(select_4);
	init_select(select_4);
	reset(label_5);
	var label_6 = sibling(label_5, 2);
	var select_5 = sibling(child(label_6));
	each(select_5, 5, () => untrack(() => choices.visualStyle), index, ($$anchor, $$item) => {
		var $$array_2 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array_2)[0];
		let text = () => get($$array_2)[1];
		var option_13 = root();
		var text_4 = only_child(option_13, true);
		var option_13_value = {};
		template_effect(() => {
			set_text(text_4, text());
			if (option_13_value !== (option_13_value = value())) option_13.value = (option_13.__value = option_13_value) ?? "";
		});
		append($$anchor, option_13);
	});
	reset(select_5);
	init_select(select_5);
	reset(label_6);
	var label_7 = sibling(label_6, 2);
	var select_6 = sibling(child(label_7));
	each(select_6, 5, () => untrack(() => choices.template), index, ($$anchor, $$item) => {
		var $$array_3 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array_3)[0];
		let text = () => get($$array_3)[1];
		var option_14 = root();
		var text_5 = only_child(option_14, true);
		var option_14_value = {};
		template_effect(() => {
			set_text(text_5, text());
			if (option_14_value !== (option_14_value = value())) option_14.value = (option_14.__value = option_14_value) ?? "";
		});
		append($$anchor, option_14);
	});
	reset(select_6);
	init_select(select_6);
	reset(label_7);
	var label_8 = sibling(label_7, 2);
	var select_7 = sibling(child(label_8));
	each(select_7, 5, () => untrack(() => choices.rhythm), index, ($$anchor, $$item) => {
		var $$array_4 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array_4)[0];
		let text = () => get($$array_4)[1];
		var option_15 = root();
		var text_6 = only_child(option_15, true);
		var option_15_value = {};
		template_effect(() => {
			set_text(text_6, text());
			if (option_15_value !== (option_15_value = value())) option_15.value = (option_15.__value = option_15_value) ?? "";
		});
		append($$anchor, option_15);
	});
	reset(select_7);
	init_select(select_7);
	reset(label_8);
	var label_9 = sibling(label_8, 2);
	var select_8 = sibling(child(label_9));
	each(select_8, 5, () => untrack(() => choices.editGrammar), index, ($$anchor, $$item) => {
		var $$array_5 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array_5)[0];
		let text = () => get($$array_5)[1];
		var option_16 = root();
		var text_7 = only_child(option_16, true);
		var option_16_value = {};
		template_effect(() => {
			set_text(text_7, text());
			if (option_16_value !== (option_16_value = value())) option_16.value = (option_16.__value = option_16_value) ?? "";
		});
		append($$anchor, option_16);
	});
	reset(select_8);
	init_select(select_8);
	reset(label_9);
	var label_10 = sibling(label_9, 2);
	var select_9 = sibling(child(label_10));
	each(select_9, 5, () => untrack(() => choices.actionProfile), index, ($$anchor, $$item) => {
		var $$array_6 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
		let value = () => get($$array_6)[0];
		let text = () => get($$array_6)[1];
		var option_17 = root();
		var text_8 = only_child(option_17, true);
		var option_17_value = {};
		template_effect(() => {
			set_text(text_8, text());
			if (option_17_value !== (option_17_value = value())) option_17.value = (option_17.__value = option_17_value) ?? "";
		});
		append($$anchor, option_17);
	});
	reset(select_9);
	init_select(select_9);
	reset(label_10);
	reset(section_1);
	var label_11 = sibling(section_1, 2);
	var textarea = sibling(child(label_11));
	remove_textarea_child(textarea);
	reset(label_11);
	var label_12 = sibling(label_11, 2);
	var textarea_1 = sibling(child(label_12));
	remove_textarea_child(textarea_1);
	reset(label_12);
	var button = sibling(label_12, 2);
	var text_9 = only_child(button);
	var node = sibling(button, 2);
	var consequent = ($$anchor) => {
		var fragment = root_2();
		var section_2 = first_child(fragment);
		var label_13 = child(section_2);
		var input = sibling(child(label_13));
		remove_input_defaults(input);
		reset(label_13);
		var label_14 = sibling(label_13, 2);
		var input_1 = sibling(child(label_14));
		remove_input_defaults(input_1);
		reset(label_14);
		var label_15 = sibling(label_14, 2);
		var select_10 = sibling(child(label_15));
		each(select_10, 5, () => untrack(() => choices.textTreatment), index, ($$anchor, $$item) => {
			var $$array_7 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
			let value = () => get($$array_7)[0];
			let text = () => get($$array_7)[1];
			var option_18 = root();
			var text_10 = only_child(option_18, true);
			var option_18_value = {};
			template_effect(() => {
				set_text(text_10, text());
				if (option_18_value !== (option_18_value = value())) option_18.value = (option_18.__value = option_18_value) ?? "";
			});
			append($$anchor, option_18);
		});
		reset(select_10);
		init_select(select_10);
		reset(label_15);
		var div_1 = sibling(label_15, 2);
		var label_16 = child(div_1);
		var input_2 = child(label_16);
		remove_input_defaults(input_2);
		next();
		reset(label_16);
		var label_17 = sibling(label_16);
		var input_3 = child(label_17);
		remove_input_defaults(input_3);
		next();
		reset(label_17);
		reset(div_1);
		reset(section_2);
		var section_3 = sibling(section_2, 2);
		var label_18 = child(section_3);
		var input_4 = sibling(child(label_18));
		remove_input_defaults(input_4);
		reset(label_18);
		var label_19 = sibling(label_18);
		var input_5 = sibling(child(label_19));
		remove_input_defaults(input_5);
		reset(label_19);
		reset(section_3);
		var section_4 = sibling(section_3, 2);
		var div_2 = sibling(child(section_4));
		each(div_2, 5, () => transitionOptions, index, ($$anchor, $$item) => {
			var $$array_8 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
			let value = () => get($$array_8)[0];
			let text = () => get($$array_8)[1];
			var button_1 = root_1();
			let classes_1;
			var text_11 = only_child(button_1, true);
			template_effect(($0) => {
				classes_1 = set_class(button_1, 1, "svelte-63pebg", null, classes_1, { active: $0 });
				set_text(text_11, text());
			}, [() => get(state).transitions.includes(value())]);
			event("click", button_1, () => toggleList("transitions", value()));
			append($$anchor, button_1);
		});
		reset(div_2);
		reset(section_4);
		var section_5 = sibling(section_4, 2);
		var div_3 = sibling(child(section_5));
		each(div_3, 5, () => effectOptions, index, ($$anchor, $$item) => {
			var $$array_9 = /* @__PURE__ */ user_derived(() => to_array(get($$item), 2));
			let value = () => get($$array_9)[0];
			let text = () => get($$array_9)[1];
			var button_2 = root_1();
			let classes_2;
			var text_12 = only_child(button_2, true);
			template_effect(($0) => {
				classes_2 = set_class(button_2, 1, "svelte-63pebg", null, classes_2, { active: $0 });
				set_text(text_12, text());
			}, [() => get(state).effects.includes(value())]);
			event("click", button_2, () => toggleList("effects", value()));
			append($$anchor, button_2);
		});
		reset(div_3);
		reset(section_5);
		bind_value(input, () => get(state).bpm, ($$value) => (mutate(state, get(state).bpm = $$value), invalidate_inner_signals(() => {})));
		event("change", input, commit);
		bind_value(input_1, () => get(state).beatOffsetMs, ($$value) => (mutate(state, get(state).beatOffsetMs = $$value), invalidate_inner_signals(() => {})));
		event("change", input_1, commit);
		bind_select_value(select_10, () => get(state).textTreatment, ($$value) => (mutate(state, get(state).textTreatment = $$value), invalidate_inner_signals(() => {})));
		event("change", select_10, commit);
		bind_checked(input_2, () => get(state).reserveTitleSafeArea, ($$value) => (mutate(state, get(state).reserveTitleSafeArea = $$value), invalidate_inner_signals(() => {})));
		event("change", input_2, commit);
		bind_checked(input_3, () => get(state).allowVideoReference, ($$value) => (mutate(state, get(state).allowVideoReference = $$value), invalidate_inner_signals(() => {})));
		event("change", input_3, commit);
		bind_value(input_4, () => get(state).title, ($$value) => (mutate(state, get(state).title = $$value), invalidate_inner_signals(() => {})));
		event("change", input_4, commit);
		bind_value(input_5, () => get(state).subtitle, ($$value) => (mutate(state, get(state).subtitle = $$value), invalidate_inner_signals(() => {})));
		event("change", input_5, commit);
		append($$anchor, fragment);
	};
	if_block(node, ($$render) => {
		if (get(advancedOpen)) $$render(consequent);
	});
	var section_6 = sibling(node, 2);
	var label_20 = sibling(child(section_6), 2);
	var input_6 = child(label_20);
	remove_input_defaults(input_6);
	next();
	reset(label_20);
	var node_1 = sibling(label_20, 2);
	var consequent_1 = ($$anchor) => {
		var fragment_1 = root_3();
		var label_21 = first_child(fragment_1);
		var input_7 = child(label_21);
		remove_input_defaults(input_7);
		next();
		reset(label_21);
		var label_22 = sibling(label_21);
		var input_8 = child(label_22);
		remove_input_defaults(input_8);
		next();
		reset(label_22);
		var label_23 = sibling(label_22);
		var input_9 = child(label_23);
		remove_input_defaults(input_9);
		next();
		reset(label_23);
		bind_checked(input_7, () => get(state).ageVerified, ($$value) => (mutate(state, get(state).ageVerified = $$value), invalidate_inner_signals(() => {})));
		event("change", input_7, commit);
		bind_checked(input_8, () => get(state).allCharactersAdult, ($$value) => (mutate(state, get(state).allCharactersAdult = $$value), invalidate_inner_signals(() => {})));
		event("change", input_8, commit);
		bind_checked(input_9, () => get(state).consentConfirmed, ($$value) => (mutate(state, get(state).consentConfirmed = $$value), invalidate_inner_signals(() => {})));
		event("change", input_9, commit);
		append($$anchor, fragment_1);
	};
	if_block(node_1, ($$render) => {
		if (get(state), untrack(() => get(state).adultMode)) $$render(consequent_1);
	});
	reset(section_6);
	var section_7 = sibling(section_6, 2);
	var div_4 = child(section_7);
	var text_13 = only_child(sibling(child(div_4)));
	reset(div_4);
	var text_14 = only_child(sibling(div_4), true);
	reset(section_7);
	reset(main);
	reset(div);
	template_effect(() => {
		classes = set_class(span, 1, "svelte-63pebg", null, classes, { saved: get(saved) });
		set_text(text_1, get(saved) ? "已同步" : "同步中");
		set_text(text_9, `${get(advancedOpen) ? "▾" : "▸"} 后期与节拍设置`);
		set_text(text_13, `${(get(preview), untrack(() => get(preview).length)) ?? ""} 字符`);
		set_text(text_14, get(preview));
	});
	bind_select_value(select, () => get(state).productionLevel, ($$value) => (mutate(state, get(state).productionLevel = $$value), invalidate_inner_signals(() => {})));
	event("change", select, commit);
	bind_select_value(select_1, () => get(state).durationSeconds, ($$value) => (mutate(state, get(state).durationSeconds = $$value), invalidate_inner_signals(() => {})));
	event("change", select_1, commit);
	bind_select_value(select_2, () => get(state).outputMode, ($$value) => (mutate(state, get(state).outputMode = $$value), invalidate_inner_signals(() => {})));
	event("change", select_2, commit);
	bind_select_value(select_3, () => get(state).cutDensity, ($$value) => (mutate(state, get(state).cutDensity = $$value), invalidate_inner_signals(() => {})));
	event("change", select_3, commit);
	bind_select_value(select_4, () => get(state).theme, ($$value) => (mutate(state, get(state).theme = $$value), invalidate_inner_signals(() => {})));
	event("change", select_4, commit);
	bind_select_value(select_5, () => get(state).visualStyle, ($$value) => (mutate(state, get(state).visualStyle = $$value), invalidate_inner_signals(() => {})));
	event("change", select_5, commit);
	bind_select_value(select_6, () => get(state).template, ($$value) => (mutate(state, get(state).template = $$value), invalidate_inner_signals(() => {})));
	event("change", select_6, commit);
	bind_select_value(select_7, () => get(state).rhythm, ($$value) => (mutate(state, get(state).rhythm = $$value), invalidate_inner_signals(() => {})));
	event("change", select_7, commit);
	bind_select_value(select_8, () => get(state).editGrammar, ($$value) => (mutate(state, get(state).editGrammar = $$value), invalidate_inner_signals(() => {})));
	event("change", select_8, commit);
	bind_select_value(select_9, () => get(state).actionProfile, ($$value) => (mutate(state, get(state).actionProfile = $$value), invalidate_inner_signals(() => {})));
	event("change", select_9, commit);
	bind_value(textarea, () => get(state).creativeBrief, ($$value) => (mutate(state, get(state).creativeBrief = $$value), invalidate_inner_signals(() => {})));
	event("change", textarea, commit);
	bind_value(textarea_1, () => get(state).actionDirection, ($$value) => (mutate(state, get(state).actionDirection = $$value), invalidate_inner_signals(() => {})));
	event("change", textarea_1, commit);
	event("click", button, () => set(advancedOpen, !get(advancedOpen)));
	bind_checked(input_6, () => get(state).adultMode, ($$value) => (mutate(state, get(state).adultMode = $$value), invalidate_inner_signals(() => {})));
	event("change", input_6, commit);
	append($$anchor, div);
	bind_prop($$props, "loadState", loadState);
	return pop($$exports);
}
//#endregion
//#region src/main.js
var DEFINITIONS = [{
	nodeName: "EagleSvelteCharacterInteractionNode",
	stateWidget: "interaction_state",
	domWidget: "svelte_character_interaction_ui",
	Component: CharacterInteraction,
	defaultSize: [960, 720],
	minimumSize: [620, 560],
	panelHeight: 500,
	nodeChromeHeight: 140
}, {
	nodeName: "EagleSvelteCharacterPVNode",
	stateWidget: "pv_state",
	domWidget: "svelte_character_pv_ui",
	Component: CharacterPV,
	defaultSize: [960, 720],
	minimumSize: [680, 600],
	panelHeight: 540,
	nodeChromeHeight: 160
}];
function findWidget(node, name) {
	return (node.widgets || []).find((widget) => widget.name === name) || null;
}
function parseState(value) {
	try {
		const parsed = JSON.parse(String(value || "{}"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch (_error) {
		return {};
	}
}
function hideStateWidget(node, stateWidget) {
	const widget = findWidget(node, stateWidget);
	if (!widget) return false;
	widget.type = "hidden";
	widget.hidden = true;
	widget.options ||= {};
	Object.assign(widget.options, {
		hidden: true,
		vueNode: "never",
		hideInPanel: true
	});
	widget.computeSize = () => [0, -4];
	widget.draw = () => {};
	const widgetIndex = node.widgets?.indexOf(widget) ?? -1;
	if (widgetIndex >= 0) node.widgets.splice(widgetIndex, 1, widget);
	node.setDirtyCanvas?.(true, true);
	return true;
}
function suppressStateWidgetDefinition(nodeData, stateWidget) {
	const inputDefs = nodeData?.input || nodeData?.inputs;
	for (const groupName of ["required", "optional"]) {
		const definition = inputDefs?.[groupName]?.[stateWidget];
		if (!Array.isArray(definition)) continue;
		definition[1] = {
			...definition[1] || {},
			hidden: true,
			vueNode: "never",
			hideInPanel: true
		};
	}
}
function installNodeUi(nodeType, definition) {
	const { stateWidget, domWidget, Component, defaultSize, minimumSize, panelHeight, nodeChromeHeight } = definition;
	const originalCreated = nodeType.prototype.onNodeCreated;
	nodeType.prototype.onNodeCreated = function() {
		originalCreated?.apply(this, arguments);
		if (this._eagleSveltePanelMounted) return;
		this._eagleSveltePanelMounted = true;
		if (!this.size || this.size[0] < minimumSize[0] || this.size[1] < minimumSize[1]) this.setSize(defaultSize.slice());
		const node = this;
		// Suppress the serialized JSON row before Nodes 2.0 has a chance to
		// create its parameter component.  Timed passes cover frontends that
		// populate native widgets after onNodeCreated returns.
		hideStateWidget(node, stateWidget);
		const host = document.createElement("div");
		host.style.cssText = "display:block;width:100%;height:100%;min-width:0;overflow:hidden;box-sizing:border-box;";
		let currentViewportHeight = panelHeight;
		const MAX_VIEWPORT_HEIGHT = 4096;
		const panelWidget = this.addDOMWidget(domWidget, "div", host, {
			serialize: false,
			hideInPanel: true,
			hideOnZoom: false,
			getMinHeight: () => panelHeight,
			getMaxHeight: () => MAX_VIEWPORT_HEIGHT,
			getHeight: () => currentViewportHeight
		});
		panelWidget.width = void 0;
		panelWidget._eagleViewportHeight = panelHeight;
		const applySize = (size) => {
			const current = size || node.size || defaultSize;
			const width = Math.max(minimumSize[0] - 60, Number(current[0] || defaultSize[0]) - 20);
			const height = Math.min(MAX_VIEWPORT_HEIGHT, Math.max(panelHeight, Number(current[1] || defaultSize[1]) - nodeChromeHeight));
			currentViewportHeight = height;
			panelWidget._eagleViewportHeight = height;
			host.style.width = `${width}px`;
			host.style.height = `${height}px`;
			return [width, height];
		};
		// Do not shadow DOMWidgetImpl.computeLayoutSize with an instance
		// computeSize.  The inherited layout contract marks this panel growable,
		// so Classic and Nodes 2.0 allocate the user's full dragged height.
		applySize(this.size);
		const readState = () => parseState(findWidget(node, stateWidget)?.value);
		const writeState = (nextState) => {
			const widget = findWidget(node, stateWidget);
			if (!widget) return;
			widget.value = JSON.stringify(nextState);
			widget.callback?.(widget.value, node, widget);
			app.graph?.setDirtyCanvas?.(true, true);
			app.graph?.change?.();
		};
		try {
			this._eagleSveltePanelApp = mount(Component, {
				target: host,
				props: {
					initialState: readState(),
					onStateChange: writeState
				}
			});
			this._eagleSveltePanelReloadState = () => {
				this._eagleSveltePanelApp?.loadState?.(readState());
			};
			requestAnimationFrame(refreshEagleVueTheme);
		} catch (error) {
			host.textContent = `Svelte Eagle 面板加载失败：${error?.message || error}`;
			host.style.cssText += "padding:16px;color:#ff8585;background:#1b1012;white-space:pre-wrap;";
			console.error("[EagleSveltePanel] mount failed", error);
		}
		setTimeout(() => hideStateWidget(node, stateWidget), 0);
		setTimeout(() => hideStateWidget(node, stateWidget), 250);
		setTimeout(() => hideStateWidget(node, stateWidget), 500);
		const originalResize = this.onResize;
		this.onResize = function(size) {
			originalResize?.apply(this, arguments);
			applySize(size);
		};
		this._eagleSveltePanelApplySize = applySize;
	};
	const originalConfigured = nodeType.prototype.onConfigure;
	nodeType.prototype.onConfigure = function() {
		originalConfigured?.apply(this, arguments);
		hideStateWidget(this, stateWidget);
		const node = this;
		setTimeout(() => hideStateWidget(node, stateWidget), 0);
		setTimeout(() => hideStateWidget(node, stateWidget), 250);
		this._eagleSveltePanelReloadState?.();
		requestAnimationFrame(() => {
			this._eagleSveltePanelApplySize?.(this.size);
			refreshEagleVueTheme();
		});
	};
	const originalRemoved = nodeType.prototype.onRemoved;
	nodeType.prototype.onRemoved = function() {
		if (this._eagleSveltePanelApp) {
			unmount(this._eagleSveltePanelApp);
			this._eagleSveltePanelApp = null;
		}
		this._eagleSveltePanelApplySize = null;
		this._eagleSveltePanelReloadState = null;
		originalRemoved?.apply(this, arguments);
	};
}
app.registerExtension({
	name: "Eagle.SvelteDirectorPanels",
	async beforeRegisterNodeDef(nodeType, nodeData) {
		const definition = DEFINITIONS.find((item) => item.nodeName === nodeData?.name);
		if (!definition) return;
		suppressStateWidgetDefinition(nodeData, definition.stateWidget);
		installNodeUi(nodeType, definition);
	}
});
//#endregion

//# sourceMappingURL=svelte_character_interaction.js.map

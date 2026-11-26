var Sn = Array.isArray, Fi = Array.prototype.indexOf, Ft = Array.prototype.includes, zt = Array.from, Tn = Object.defineProperty, Be = Object.getOwnPropertyDescriptor, xn = Object.getOwnPropertyDescriptors, Bi = Object.prototype, ji = Array.prototype, Sr = Object.getPrototypeOf, un = Object.isExtensible;
const Hi = () => {
};
function Ki(e) {
  return e();
}
function dr(e) {
  for (var t = 0; t < e.length; t++)
    e[t]();
}
function Nn() {
  var e, t, r = new Promise((n, i) => {
    e = n, t = i;
  });
  return { promise: r, resolve: e, reject: t };
}
const H = 2, et = 4, Tt = 8, Mn = 1 << 24, ae = 16, re = 32, ke = 64, vr = 128, Tr = 256, ee = 512, I = 1024, B = 2048, te = 4096, V = 8192, G = 16384, it = 32768, Bt = 1 << 25, tt = 65536, jt = 1 << 17, Wi = 1 << 18, st = 1 << 19, Rn = 1 << 20, Ee = 1 << 25, Ue = 65536, Ht = 1 << 21, Ze = 1 << 22, Ae = 1 << 23, je = /* @__PURE__ */ Symbol("$state"), An = /* @__PURE__ */ Symbol("component"), Ui = /* @__PURE__ */ Symbol("legacy props"), Vi = /* @__PURE__ */ Symbol(""), Pn = /* @__PURE__ */ Symbol("attributes"), hr = /* @__PURE__ */ Symbol("class"), zi = /* @__PURE__ */ Symbol("style"), pr = /* @__PURE__ */ Symbol("text"), xt = new class extends Error {
  name = "StaleReactionError";
  message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}(), qi = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml")
), Yi = 1, Gi = 2, $i = 16, Ji = 1, Xi = 2, Zi = 4, Qi = 8, es = 16, ts = 1, rs = 2, F = /* @__PURE__ */ Symbol("uninitialized"), ns = "http://www.w3.org/1999/xhtml";
function is() {
  console.warn("https://svelte.dev/e/derived_inert");
}
function ss() {
  console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
function Ln(e) {
  return e === this.v;
}
function ls(e, t) {
  return e != e ? t == t : e !== t || e !== null && typeof e == "object" || typeof e == "function";
}
function Cn(e) {
  return !ls(e, this.v);
}
function On(e) {
  throw new Error("https://svelte.dev/e/lifecycle_outside_component");
}
function as() {
  throw new Error("https://svelte.dev/e/async_derived_orphan");
}
function os(e, t, r) {
  throw new Error("https://svelte.dev/e/each_key_duplicate");
}
function fs(e) {
  throw new Error("https://svelte.dev/e/effect_in_teardown");
}
function us() {
  throw new Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function cs(e) {
  throw new Error("https://svelte.dev/e/effect_orphan");
}
function ds() {
  throw new Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function vs(e) {
  throw new Error("https://svelte.dev/e/props_invalid_value");
}
function hs() {
  throw new Error("https://svelte.dev/e/state_descriptors_fixed");
}
function ps() {
  throw new Error("https://svelte.dev/e/state_prototype_fixed");
}
function _s() {
  throw new Error("https://svelte.dev/e/state_unsafe_mutation");
}
function gs() {
  throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
let lt = !1;
function ys() {
  lt = !0;
}
let P = null;
function rt(e) {
  P = e;
}
function Dn(e, t = !1, r) {
  P = {
    p: P,
    i: !1,
    c: null,
    e: null,
    s: e,
    x: null,
    r: (
      /** @type {Effect} */
      b
    ),
    l: lt && !t ? { s: null, u: null, $: [] } : null
  };
}
function In(e) {
  var t = (
    /** @type {ComponentContext} */
    P
  ), r = t.e;
  if (r !== null) {
    t.e = null;
    for (var n of r)
      Zn(n);
  }
  return e !== void 0 && (t.x = e), t.i = !0, P = t.p, xr(e);
}
function xr(e = {}) {
  return Tn(e, An, { value: !0 }), e;
}
function at() {
  return !lt || P !== null && P.l === null;
}
let $e = [];
function ms() {
  var e = $e;
  $e = [], dr(e);
}
function Re(e) {
  if ($e.length === 0) {
    var t = $e;
    queueMicrotask(() => {
      t === $e && ms();
    });
  }
  $e.push(e);
}
const bs = -7169;
function O(e, t) {
  e.f = e.f & bs | t;
}
function Nr(e) {
  (e.f & ee) !== 0 || e.deps === null ? O(e, I) : O(e, te);
}
function Fn(e) {
  if (e !== null)
    for (const t of e)
      (t.f & H) === 0 || (t.f & Ue) === 0 || (t.f ^= Ue, Fn(
        /** @type {Derived} */
        t.deps
      ));
}
function Bn(e, t, r) {
  (e.f & B) !== 0 ? t.add(e) : (e.f & te) !== 0 && r.add(e), Fn(e.deps), O(e, I);
}
let Lt = !1;
function ws(e) {
  var t = Lt;
  try {
    return Lt = !1, [e(), Lt];
  } finally {
    Lt = t;
  }
}
function Nt(e) {
  var t = S, r = b;
  ne(null), ie(null);
  try {
    return e();
  } finally {
    ne(t), ie(r);
  }
}
function Es(e, t, r, n) {
  const i = at() ? Et : Mr;
  var s = e.filter((v) => !v.settled), o = t.map(i);
  if (r.length === 0 && s.length === 0) {
    n(o);
    return;
  }
  var a = (
    /** @type {Effect} */
    b
  ), f = ks(), u = s.length === 1 ? s[0].promise : s.length > 1 ? Promise.all(s.map((v) => v.promise)) : null;
  function p(v) {
    if ((a.f & G) === 0) {
      f();
      try {
        n([...o, ...v]);
      } catch (c) {
        ce(c, a);
      }
      Kt();
    }
  }
  var d = jn();
  if (r.length === 0) {
    u.then(() => p([])).finally(d);
    return;
  }
  function _() {
    Promise.all(r.map((v) => /* @__PURE__ */ Ss(v))).then(p).catch((v) => ce(v, a)).finally(d);
  }
  u ? u.then(() => {
    f(), _(), Kt();
  }) : _();
}
function ks() {
  var e = (
    /** @type {Effect} */
    b
  ), t = S, r = P, n = (
    /** @type {Batch} */
    T
  );
  return function(s = !0) {
    ie(e), ne(t), rt(r), s && (e.f & G) === 0 && (n?.activate(), n?.apply());
  };
}
function Kt(e = !0) {
  ie(null), ne(null), rt(null), e && T?.deactivate();
}
function jn() {
  var e = (
    /** @type {Effect} */
    b
  ), t = e.b, r = (
    /** @type {Batch} */
    T
  ), n = !!t?.is_rendered();
  return t?.update_pending_count(1, r), r.increment(n, e), () => {
    t?.update_pending_count(-1, r), r.decrement(n, e);
  };
}
// @__NO_SIDE_EFFECTS__
function Et(e) {
  var t = H | B;
  return b !== null && (b.f |= st), {
    ctx: P,
    deps: null,
    effects: null,
    equals: Ln,
    f: t,
    fn: e,
    reactions: null,
    rv: 0,
    v: (
      /** @type {V} */
      F
    ),
    wv: 0,
    parent: b,
    ac: null
  };
}
const yt = /* @__PURE__ */ Symbol("obsolete");
// @__NO_SIDE_EFFECTS__
function Ss(e, t, r) {
  let n = (
    /** @type {Effect | null} */
    b
  );
  n === null && as();
  var i = (
    /** @type {Promise<V>} */
    /** @type {unknown} */
    void 0
  ), s = Ve(
    /** @type {V} */
    F
  ), o = !S, a = /* @__PURE__ */ new Set();
  return Ks(() => {
    var f = (
      /** @type {Effect} */
      b
    ), u = Nn();
    i = u.promise;
    try {
      Promise.resolve(e()).then(u.resolve, (v) => {
        v !== xt && u.reject(v);
      }).finally(Kt);
    } catch (v) {
      u.reject(v), Kt();
    }
    var p = (
      /** @type {Batch} */
      T
    );
    if (o) {
      if ((f.f & it) !== 0)
        var d = jn();
      if (
        // boundary can be null if the async derived is inside an $effect.root not connected to the component render tree
        n.b?.is_rendered()
      )
        p.async_deriveds.get(f)?.reject(yt);
      else
        for (const v of a.values())
          v.reject(yt);
      a.add(u), p.async_deriveds.set(f, u);
    }
    const _ = (v, c = void 0) => {
      d?.(), a.delete(u), c !== yt && (p.activate(), c ? (s.f |= Ae, nt(s, c)) : ((s.f & Ae) !== 0 && (s.f ^= Ae), nt(s, v)), p.deactivate());
    };
    u.promise.then(_, (v) => _(null, v || "unknown"));
  }), Cr(() => {
    for (const f of a)
      f.reject(yt);
  }), new Promise((f) => {
    function u(p) {
      function d() {
        p === i ? f(s) : u(i);
      }
      p.then(d, d);
    }
    u(i);
  });
}
// @__NO_SIDE_EFFECTS__
function Mr(e) {
  const t = /* @__PURE__ */ Et(e);
  return t.equals = Cn, t;
}
function Ts(e) {
  var t = e.effects;
  if (t !== null) {
    e.effects = null;
    for (var r = 0; r < t.length; r += 1)
      $(
        /** @type {Effect} */
        t[r]
      );
  }
}
function Rr(e) {
  var t, r = b, n = e.parent;
  if (!Se && n !== null && e.v !== F && // if it was never evaluated before, it's guaranteed to fail downstream, so we try to execute instead
  (n.f & (G | V)) !== 0)
    return is(), e.v;
  ie(n);
  try {
    e.f &= ~Ue, Ts(e), t = li(e);
  } finally {
    ie(r);
  }
  return t;
}
function Hn(e) {
  var t = Rr(e);
  if (!e.equals(t) && (e.wv = ii(), (!T?.is_fork || e.deps === null) && (T !== null ? (T.capture(e, t, !0), _r?.capture(e, t, !0)) : e.v = t, e.deps === null))) {
    O(e, I);
    return;
  }
  Se || (oe !== null ? (Lr() || T?.is_fork) && oe.set(e, t) : Nr(e));
}
function xs(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      (t.teardown || t.ac) && (t.teardown?.(), t.ac !== null && Nt(() => {
        t.ac.abort(xt), t.ac = null;
      }), t.fn !== null && (t.teardown = Hi), St(t, 0), Or(t));
}
function Kn(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      t.teardown && t.fn !== null && ze(t);
}
let ir = null, Ye = null, T = null, _r = null, oe = null, gr = null, sr = !1, Je = null, Dt = null;
var cn = 0;
let Ns = 1;
class Pe {
  id = Ns++;
  /** True as soon as `#process` was called */
  #t = !1;
  linked = !0;
  /** @type {Batch | null} */
  #l = null;
  /** @type {Batch | null} */
  #e = null;
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
  #o = /* @__PURE__ */ new Set();
  /**
   * If a fork is discarded, we need to destroy any effects that are no longer needed
   * @type {Set<(batch: Batch) => void>}
   */
  #n = /* @__PURE__ */ new Set();
  /**
   * The number of async effects that are currently in flight
   */
  #s = 0;
  /**
   * Async effects that are currently in flight, _not_ inside a pending boundary
   * @type {Map<Effect, number>}
   */
  #r = /* @__PURE__ */ new Map();
  /**
   * A deferred that resolves when the batch is committed, used with `settled()`
   * TODO replace with Promise.withResolvers once supported widely enough
   * @type {{ promise: Promise<void>, resolve: (value?: any) => void, reject: (reason: unknown) => void } | null}
   */
  #a = null;
  /**
   * The root effects that need to be flushed
   * @type {Effect[]}
   */
  #i = [];
  /**
   * Effects created while this batch was active.
   * @type {Effect[]}
   */
  #p = [];
  /**
   * Deferred effects (which run after async work has completed) that are DIRTY
   * @type {Set<Effect>}
   */
  #f = /* @__PURE__ */ new Set();
  /**
   * Deferred effects that are MAYBE_DIRTY
   * @type {Set<Effect>}
   */
  #u = /* @__PURE__ */ new Set();
  /**
   * A map of branches that still exist, but will be destroyed when this batch
   * is committed — we skip over these during `process`.
   * The value contains child effects that were dirty/maybe_dirty before being reset,
   * so they can be rescheduled if the branch survives.
   * @type {Map<Effect, { d: Effect[], m: Effect[] }>}
   */
  #d = /* @__PURE__ */ new Map();
  /**
   * Inverse of #skipped_branches which we need to tell prior batches to unskip them when committing
   * @type {Set<Effect>}
   */
  #_ = /* @__PURE__ */ new Set();
  is_fork = !1;
  #c = !1;
  constructor() {
    Ye === null ? ir = Ye = this : (Ye.#e = this, this.#l = Ye), Ye = this;
  }
  #m() {
    if (this.is_fork) return !0;
    for (const n of this.#r.keys()) {
      for (var t = n, r = !1; t.parent !== null; ) {
        if (this.#d.has(t)) {
          r = !0;
          break;
        }
        t = t.parent;
      }
      if (!r)
        return !0;
    }
    return !1;
  }
  /**
   * Add an effect to the #skipped_branches map and reset its children
   * @param {Effect} effect
   */
  skip_effect(t) {
    this.#d.has(t) || this.#d.set(t, { d: [], m: [] }), this.#_.delete(t);
  }
  /**
   * Remove an effect from the #skipped_branches map and reschedule
   * any tracked dirty/maybe_dirty child effects
   * @param {Effect} effect
   * @param {(e: Effect) => void} callback
   */
  unskip_effect(t, r = (n) => this.schedule(n)) {
    var n = this.#d.get(t);
    if (n) {
      this.#d.delete(t);
      for (var i of n.d)
        O(i, B), r(i);
      for (i of n.m)
        O(i, te), r(i);
    }
    this.#_.add(t);
  }
  #g() {
    this.#t = !0, cn++ > 1e3 && (this.#h(), Ms());
    for (const f of this.#f)
      this.#u.delete(f), O(f, B), this.schedule(f);
    for (const f of this.#u)
      O(f, te), this.schedule(f);
    const t = this.#i;
    this.#i = [], this.apply();
    var r = Je = [], n = [], i = Dt = [];
    for (const f of t)
      try {
        this.#w(f, r, n);
      } catch (u) {
        throw Vn(f), this.#m() || this.discard(), u;
      }
    if (T = null, i.length > 0) {
      var s = Pe.ensure();
      for (const f of i)
        s.schedule(f);
    }
    if (Je = null, Dt = null, this.#m()) {
      this.#v(n), this.#v(r);
      for (const [f, u] of this.#d)
        Un(f, u);
      i.length > 0 && /** @type {unknown} */
      T.#g();
      return;
    }
    const o = this.#b();
    if (o) {
      this.#v(n), this.#v(r), o.#E(this);
      return;
    }
    this.#f.clear(), this.#u.clear();
    for (const f of this.#o) f(this);
    this.#o.clear(), _r = this, dn(n), dn(r), _r = null, this.#a?.resolve();
    var a = (
      /** @type {Batch | null} */
      /** @type {unknown} */
      T
    );
    if (this.#s === 0 && (this.#i.length === 0 || a !== null) && this.#h(), this.#i.length > 0)
      if (a !== null) {
        const f = a;
        f.#i.push(...this.#i.filter((u) => !f.#i.includes(u)));
      } else
        a = this;
    a !== null && (ve.clear(), a.#g());
  }
  /**
   * Traverse the effect tree, executing effects or stashing
   * them for later execution as appropriate
   * @param {Effect} root
   * @param {Effect[]} effects
   * @param {Effect[]} render_effects
   */
  #w(t, r, n) {
    t.f ^= I;
    for (var i = t.first; i !== null; ) {
      var s = i.f, o = (s & (re | ke)) !== 0, a = o && (s & I) !== 0, f = a || (s & V) !== 0 || this.#d.has(i);
      if (!f && i.fn !== null) {
        o ? i.f ^= I : (s & et) !== 0 ? r.push(i) : ot(i) && ((s & ae) !== 0 && this.#u.add(i), ze(i));
        var u = i.first;
        if (u !== null) {
          i = u;
          continue;
        }
      }
      for (; i !== null; ) {
        var p = i.next;
        if (p !== null) {
          i = p;
          break;
        }
        i = i.parent;
      }
    }
  }
  #b() {
    for (var t = this.#l; t !== null; ) {
      if (!t.is_fork) {
        for (const [r, [, n]] of this.current)
          if (t.current.has(r) && !n)
            return t;
      }
      t = t.#l;
    }
    return null;
  }
  /**
   * @param {Batch} batch
   */
  #E(t) {
    for (const [n, i] of t.current)
      !this.previous.has(n) && t.previous.has(n) && this.previous.set(n, t.previous.get(n)), this.current.set(n, i);
    for (const [n, i] of t.async_deriveds) {
      const s = this.async_deriveds.get(n);
      s && i.promise.then(s.resolve).catch(s.reject);
    }
    t.async_deriveds.clear(), this.transfer_effects(t.#f, t.#u);
    const r = (n) => {
      var i = n.reactions;
      if (i !== null && !((n.f & H) !== 0 && (n.f & (B | te)) === 0))
        for (const a of i) {
          var s = a.f;
          if ((s & H) !== 0)
            r(
              /** @type {Derived} */
              a
            );
          else {
            var o = (
              /** @type {Effect} */
              a
            );
            s & (Ze | ae) && !this.async_deriveds.has(o) && (this.#u.delete(o), O(o, B), this.schedule(o));
          }
        }
    };
    for (const n of this.current.keys())
      r(n);
    this.oncommit(() => t.discard()), t.#h(), T = this, this.#g();
  }
  /**
   * @param {Effect[]} effects
   */
  #v(t) {
    for (var r = 0; r < t.length; r += 1)
      Bn(t[r], this.#f, this.#u);
  }
  /**
   * Associate a change to a given source with the current
   * batch, noting its previous and current values
   * @param {Value} source
   * @param {any} value
   * @param {boolean} [is_derived]
   */
  capture(t, r, n = !1) {
    t.v !== F && !this.previous.has(t) && this.previous.set(t, t.v), (t.f & Ae) === 0 && (this.current.set(t, [r, n]), oe?.set(t, r)), this.is_fork || (t.v = r);
  }
  activate() {
    T = this;
  }
  deactivate() {
    T = null, oe = null;
  }
  flush() {
    try {
      sr = !0, T = this, this.#g();
    } finally {
      cn = 0, gr = null, Je = null, Dt = null, sr = !1, T = null, oe = null, ve.clear();
    }
  }
  discard() {
    for (const t of this.#n) t(this);
    this.#n.clear();
    for (const t of this.async_deriveds.values())
      t.reject(yt);
    this.#h(), this.#a?.resolve();
  }
  /**
   * @param {Effect} effect
   */
  register_created_effect(t) {
    this.#p.push(t);
  }
  #y() {
    for (let d = ir; d !== null; d = d.#e) {
      var t = d.id < this.id, r = [];
      for (const [_, [v, c]] of this.current) {
        if (d.current.has(_)) {
          var n = (
            /** @type {[any, boolean]} */
            d.current.get(_)[0]
          );
          if (t && v !== n)
            d.current.set(_, [v, c]);
          else
            continue;
        }
        r.push(_);
      }
      if (t)
        for (const [_, v] of this.async_deriveds) {
          const c = d.async_deriveds.get(_);
          c && v.promise.then(c.resolve).catch(c.reject);
        }
      var i = [...d.current.keys()].filter(
        (_) => !/** @type {[any, boolean]} */
        d.current.get(_)[1]
      );
      if (!(!d.#t || i.length === 0)) {
        var s = i.filter((_) => !this.current.has(_));
        if (s.length === 0)
          t && d.discard();
        else if (r.length > 0) {
          if (t)
            for (const _ of this.#_)
              d.unskip_effect(_, (v) => {
                (v.f & (ae | Ze)) !== 0 ? d.schedule(v) : d.#v([v]);
              });
          d.activate();
          var o = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Map();
          for (var f of r)
            Wn(f, s, o, a);
          a = /* @__PURE__ */ new Map();
          var u = [...d.current].filter(([_, v]) => {
            const c = this.current.get(_);
            return c ? c[0] !== v[0] || c[1] !== v[1] : !0;
          }).map(([_]) => _);
          if (u.length > 0)
            for (const _ of this.#p)
              (_.f & (G | V | jt)) === 0 && Ar(_, u, a) && ((_.f & (Ze | ae)) !== 0 ? (O(_, B), d.schedule(_)) : d.#f.add(_));
          if (d.#i.length > 0 && !d.#c) {
            d.apply();
            for (var p of d.#i)
              d.#w(p, [], []);
            d.#i = [];
          }
          d.deactivate();
        }
      }
    }
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  increment(t, r) {
    if (this.#s += 1, t) {
      let n = this.#r.get(r) ?? 0;
      this.#r.set(r, n + 1);
    }
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  decrement(t, r) {
    if (this.#s -= 1, t) {
      let n = this.#r.get(r) ?? 0;
      n === 1 ? this.#r.delete(r) : this.#r.set(r, n - 1);
    }
    this.#c || (this.#c = !0, Re(() => {
      this.#c = !1, this.linked && this.flush();
    }));
  }
  /**
   * @param {Set<Effect>} dirty_effects
   * @param {Set<Effect>} maybe_dirty_effects
   */
  transfer_effects(t, r) {
    for (const n of t)
      this.#f.add(n);
    for (const n of r)
      this.#u.add(n);
    t.clear(), r.clear();
  }
  /** @param {(batch: Batch) => void} fn */
  oncommit(t) {
    this.#o.add(t);
  }
  /** @param {(batch: Batch) => void} fn */
  ondiscard(t) {
    this.#n.add(t);
  }
  settled() {
    return (this.#a ??= Nn()).promise;
  }
  static ensure() {
    if (T === null) {
      const t = T = new Pe();
      sr || Re(() => {
        t.#t || t.flush();
      });
    }
    return T;
  }
  apply() {
    {
      oe = null;
      return;
    }
  }
  /**
   *
   * @param {Effect} effect
   */
  schedule(t) {
    if (gr = t, t.b?.is_pending && (t.f & (et | Tt | Mn)) !== 0 && (t.f & it) === 0) {
      t.b.defer_effect(t);
      return;
    }
    for (var r = t; r.parent !== null; ) {
      r = r.parent;
      var n = r.f;
      if (Je !== null && r === b && (S === null || (S.f & H) === 0))
        return;
      if ((n & (ke | re)) !== 0) {
        if ((n & I) === 0)
          return;
        r.f ^= I;
      }
    }
    this.#i.push(r);
  }
  #h() {
    if (this.linked) {
      var t = this.#l, r = this.#e;
      t === null ? ir = r : t.#e = r, r === null ? Ye = t : r.#l = t, this.linked = !1;
    }
  }
}
function Ms() {
  try {
    ds();
  } catch (e) {
    ce(e, gr);
  }
}
let be = null;
function dn(e) {
  var t = e.length;
  if (t !== 0) {
    for (var r = 0; r < t; ) {
      var n = e[r++];
      if ((n.f & (G | V)) === 0 && ot(n) && (be = /* @__PURE__ */ new Set(), ze(n), n.deps === null && n.first === null && n.nodes === null && n.teardown === null && n.ac === null && ei(n), be?.size > 0)) {
        ve.clear();
        for (const i of be) {
          if ((i.f & (G | V)) !== 0) continue;
          const s = [i];
          let o = i.parent;
          for (; o !== null; )
            be.has(o) && (be.delete(o), s.push(o)), o = o.parent;
          for (let a = s.length - 1; a >= 0; a--) {
            const f = s[a];
            (f.f & (G | V)) === 0 && ze(f);
          }
        }
        be.clear();
      }
    }
    be = null;
  }
}
function Wn(e, t, r, n) {
  if (!r.has(e) && (r.add(e), e.reactions !== null))
    for (const i of e.reactions) {
      const s = i.f;
      (s & H) !== 0 ? Wn(
        /** @type {Derived} */
        i,
        t,
        r,
        n
      ) : (s & (Ze | ae)) !== 0 && (s & B) === 0 && Ar(i, t, n) && (O(i, B), Pr(
        /** @type {Effect} */
        i
      ));
    }
}
function Ar(e, t, r) {
  const n = r.get(e);
  if (n !== void 0) return n;
  if (e.deps !== null)
    for (const i of e.deps) {
      if (Ft.call(t, i))
        return !0;
      if ((i.f & H) !== 0 && Ar(
        /** @type {Derived} */
        i,
        t,
        r
      ))
        return r.set(
          /** @type {Derived} */
          i,
          !0
        ), !0;
    }
  return r.set(e, !1), !1;
}
function Pr(e) {
  T.schedule(e);
}
function Un(e, t) {
  if (!((e.f & re) !== 0 && (e.f & I) !== 0)) {
    (e.f & B) !== 0 ? t.d.push(e) : (e.f & te) !== 0 && t.m.push(e), O(e, I);
    for (var r = e.first; r !== null; )
      Un(r, t), r = r.next;
  }
}
function Vn(e) {
  O(e, I);
  for (var t = e.first; t !== null; )
    Vn(t), t = t.next;
}
let Wt = /* @__PURE__ */ new Set();
const ve = /* @__PURE__ */ new Map();
let zn = !1;
function Ve(e, t) {
  var r = {
    f: 0,
    // TODO ideally we could skip this altogether, but it causes type errors
    v: e,
    reactions: null,
    equals: Ln,
    rv: 0,
    wv: 0
  };
  return r;
}
// @__NO_SIDE_EFFECTS__
function xe(e, t) {
  const r = Ve(e);
  return Vs(r), r;
}
// @__NO_SIDE_EFFECTS__
function A(e, t = !1, r = !0) {
  const n = Ve(e);
  return t || (n.equals = Cn), lt && r && P !== null && P.l !== null && (P.l.s ??= []).push(n), n;
}
function Rs(e, t) {
  return g(
    e,
    L(() => l(e))
  ), t;
}
function g(e, t, r = !1) {
  S !== null && // since we are untracking the function inside `$inspect.with` we need to add this check
  // to ensure we error if state is set inside an inspect effect
  (!fe || (S.f & jt) !== 0) && at() && (S.f & (H | ae | Ze | jt)) !== 0 && (he === null || !he.has(e)) && _s();
  let n = r ? Xe(t) : t;
  return nt(e, n, Dt);
}
function nt(e, t, r = null) {
  if (!e.equals(t)) {
    Se ? ve.set(e, t) : ve.has(e) || ve.set(e, e.v);
    var n = Pe.ensure();
    if (n.capture(e, t), (e.f & H) !== 0) {
      const i = (
        /** @type {Derived} */
        e
      );
      (e.f & B) !== 0 && Rr(i), oe === null && Nr(i);
    }
    e.wv = ii(), qn(e, B, r), at() && b !== null && (b.f & I) !== 0 && (b.f & (re | ke)) === 0 && (Z === null ? zs([e]) : Z.push(e)), !n.is_fork && Wt.size > 0 && !zn && As();
  }
  return t;
}
function As() {
  zn = !1;
  for (const e of Wt) {
    (e.f & I) !== 0 && O(e, te);
    let t;
    try {
      t = ot(e);
    } catch {
      t = !0;
    }
    t && ze(e);
  }
  Wt.clear();
}
function bt(e) {
  g(e, e.v + 1);
}
function qn(e, t, r) {
  var n = e.reactions;
  if (n !== null)
    for (var i = at(), s = n.length, o = 0; o < s; o++) {
      var a = n[o], f = a.f;
      if (!(!i && a === b)) {
        var u = (f & B) === 0;
        if (u && O(a, t), (f & jt) !== 0)
          Wt.add(
            /** @type {Effect} */
            a
          );
        else if ((f & H) !== 0) {
          var p = (
            /** @type {Derived} */
            a
          );
          oe?.delete(p), (f & Ue) === 0 && (f & ee && (b === null || (b.f & Ht) === 0) && (a.f |= Ue), qn(p, te, r));
        } else if (u) {
          var d = (
            /** @type {Effect} */
            a
          );
          (f & ae) !== 0 && be !== null && be.add(d), r !== null ? r.push(d) : Pr(d);
        }
      }
    }
}
function Xe(e) {
  if (typeof e != "object" || e === null || je in e || An in e)
    return e;
  const t = Sr(e);
  if (t !== Bi && t !== ji)
    return e;
  var r = /* @__PURE__ */ new Map(), n = Sn(e), i = /* @__PURE__ */ xe(0), s = We, o = (a) => {
    if (We === s)
      return a();
    var f = S, u = We;
    ne(null), pn(s);
    var p = a();
    return ne(f), pn(u), p;
  };
  return n && r.set("length", /* @__PURE__ */ xe(
    /** @type {any[]} */
    e.length
  )), new Proxy(
    /** @type {any} */
    e,
    {
      defineProperty(a, f, u) {
        (!("value" in u) || u.configurable === !1 || u.enumerable === !1 || u.writable === !1) && hs();
        var p = r.get(f);
        return p === void 0 ? o(() => {
          var d = /* @__PURE__ */ xe(u.value);
          return r.set(f, d), d;
        }) : g(p, u.value, !0), !0;
      },
      deleteProperty(a, f) {
        var u = r.get(f);
        if (u === void 0) {
          if (f in a) {
            const p = o(() => /* @__PURE__ */ xe(F));
            r.set(f, p), bt(i);
          }
        } else
          g(u, F), bt(i);
        return !0;
      },
      get(a, f, u) {
        if (f === je)
          return e;
        var p = r.get(f), d = f in a;
        if (p === void 0 && (!d || Be(a, f)?.writable) && (p = o(() => {
          var v = Xe(d ? a[f] : F), c = /* @__PURE__ */ xe(v);
          return c;
        }), r.set(f, p)), p !== void 0) {
          var _ = l(p);
          return _ === F ? void 0 : _;
        }
        return Reflect.get(a, f, u);
      },
      getOwnPropertyDescriptor(a, f) {
        var u = Reflect.getOwnPropertyDescriptor(a, f);
        if (u && "value" in u) {
          var p = r.get(f);
          p && (u.value = l(p));
        } else if (u === void 0) {
          var d = r.get(f), _ = d?.v;
          if (d !== void 0 && _ !== F)
            return {
              enumerable: !0,
              configurable: !0,
              value: _,
              writable: !0
            };
        }
        return u;
      },
      has(a, f) {
        if (f === je)
          return !0;
        var u = r.get(f), p = u !== void 0 && u.v !== F || Reflect.has(a, f);
        if (u !== void 0 || b !== null && (!p || Be(a, f)?.writable)) {
          u === void 0 && (u = o(() => {
            var _ = p ? Xe(a[f]) : F, v = /* @__PURE__ */ xe(_);
            return v;
          }), r.set(f, u));
          var d = l(u);
          if (d === F)
            return !1;
        }
        return p;
      },
      set(a, f, u, p) {
        var d = r.get(f), _ = f in a;
        if (n && f === "length")
          for (var v = u; v < /** @type {Source<number>} */
          d.v; v += 1) {
            var c = r.get(v + "");
            c !== void 0 ? g(c, F) : v in a && (c = o(() => /* @__PURE__ */ xe(F)), r.set(v + "", c));
          }
        if (d === void 0)
          (!_ || Be(a, f)?.writable) && (d = o(() => /* @__PURE__ */ xe(void 0)), g(d, Xe(u)), r.set(f, d));
        else {
          _ = d.v !== F;
          var w = o(() => Xe(u));
          g(d, w);
        }
        var D = Reflect.getOwnPropertyDescriptor(a, f);
        if (D?.set && D.set.call(p, u), !_) {
          if (n && typeof f == "string") {
            var N = (
              /** @type {Source<number>} */
              r.get("length")
            ), E = Number(f);
            Number.isInteger(E) && E >= N.v && g(N, E + 1);
          }
          bt(i);
        }
        return !0;
      },
      ownKeys(a) {
        l(i);
        var f = Reflect.ownKeys(a).filter((d) => {
          var _ = r.get(d);
          return _ === void 0 || _.v !== F;
        });
        for (var [u, p] of r)
          p.v !== F && !(u in a) && f.push(u);
        return f;
      },
      setPrototypeOf() {
        ps();
      }
    }
  );
}
var vn, Yn, Gn, $n;
function Ps() {
  if (vn === void 0) {
    vn = window, Yn = /Firefox/.test(navigator.userAgent);
    var e = Element.prototype, t = Node.prototype, r = Text.prototype;
    Gn = Be(t, "firstChild").get, $n = Be(t, "nextSibling").get, un(e) && (e[hr] = void 0, e[Pn] = null, e[zi] = void 0, e.__e = void 0), un(r) && (r[pr] = void 0);
  }
}
function He(e = "") {
  return document.createTextNode(e);
}
// @__NO_SIDE_EFFECTS__
function kt(e) {
  return (
    /** @type {TemplateNode | null} */
    Gn.call(e)
  );
}
// @__NO_SIDE_EFFECTS__
function Mt(e) {
  return (
    /** @type {TemplateNode | null} */
    $n.call(e)
  );
}
function K(e, t) {
  return /* @__PURE__ */ kt(e);
}
function Ls(e, t = !1) {
  {
    var r = /* @__PURE__ */ kt(e);
    return r instanceof Comment && r.data === "" ? /* @__PURE__ */ Mt(r) : r;
  }
}
function se(e, t = !1) {
  return /* @__PURE__ */ kt(e);
}
function R(e, t = 1, r = !1) {
  let n = e;
  for (; t--; )
    n = /** @type {TemplateNode} */
    /* @__PURE__ */ Mt(n);
  return n;
}
function Cs(e) {
  e.textContent = "";
}
function Jn() {
  return !1;
}
function Os(e, t, r) {
  return (
    /** @type {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element} */
    r ? document.createElement(e, { is: r }) : document.createElement(e)
  );
}
function Ds(e) {
  var t = b;
  if (t === null)
    return S.f |= Ae, e;
  if ((t.f & it) === 0 && (t.f & et) === 0)
    throw e;
  ce(e, t);
}
function ce(e, t) {
  if (!(t !== null && (t.f & G) !== 0)) {
    for (; t !== null; ) {
      if ((t.f & vr) !== 0 && (t.f & (G | Bt)) === 0) {
        if ((t.f & it) === 0)
          throw e;
        try {
          t.b.error(e);
          return;
        } catch (r) {
          e = r;
        }
      }
      t = t.parent;
    }
    throw e;
  }
}
function Xn(e) {
  b === null && (S === null && cs(), us()), Se && fs();
}
function Is(e, t) {
  var r = t.last;
  r === null ? t.last = t.first = e : (r.next = e, e.prev = r, t.last = e);
}
function pe(e, t) {
  var r = b;
  r !== null && (r.f & V) !== 0 && (e |= V);
  var n = {
    ctx: P,
    deps: null,
    nodes: null,
    f: e | B | ee,
    first: null,
    fn: t,
    last: null,
    next: null,
    parent: r,
    b: r && r.b,
    prev: null,
    teardown: null,
    wv: 0,
    ac: null
  };
  T?.register_created_effect(n);
  var i = n;
  if ((e & et) !== 0)
    Je !== null ? Je.push(n) : Pe.ensure().schedule(n);
  else if (t !== null) {
    try {
      ze(n);
    } catch (o) {
      throw $(n), o;
    }
    i.deps === null && i.teardown === null && i.nodes === null && i.first === i.last && // either `null`, or a singular child
    (i.f & st) === 0 && (i = i.first, (e & ae) !== 0 && (e & tt) !== 0 && i !== null && (i.f |= tt));
  }
  if (i !== null && (i.parent = r, r !== null && Is(i, r), S !== null && (S.f & H) !== 0 && (e & ke) === 0)) {
    var s = (
      /** @type {Derived} */
      S
    );
    (s.effects ??= []).push(i);
  }
  return n;
}
function Lr() {
  return S !== null && !fe;
}
function Cr(e) {
  const t = pe(Tt, null);
  return O(t, I), t.teardown = e, t;
}
function yr(e) {
  Xn();
  var t = (
    /** @type {Effect} */
    b.f
  ), r = !S && (t & re) !== 0 && P !== null && !P.i;
  if (r) {
    var n = (
      /** @type {ComponentContext} */
      P
    );
    (n.e ??= []).push(e);
  } else
    return Zn(e);
}
function Zn(e) {
  return pe(et | Rn, e);
}
function Fs(e) {
  return Xn(), pe(Tt | Rn, e);
}
function Bs(e) {
  Pe.ensure();
  const t = pe(ke | st, e);
  return (r = {}) => new Promise((n) => {
    r.outro ? Ke(t, () => {
      $(t), n(void 0);
    }) : ($(t), n(void 0));
  });
}
function js(e) {
  return pe(et, e);
}
function j(e, t) {
  var r = (
    /** @type {ComponentContextLegacy} */
    P
  ), n = { effect: null, ran: !1, deps: e };
  r.l.$.push(n), n.effect = qt(() => {
    if (e(), !n.ran) {
      n.ran = !0;
      var i = (
        /** @type {Effect} */
        b
      );
      try {
        ie(i.parent), L(t);
      } finally {
        ie(i);
      }
    }
  });
}
function Hs() {
  var e = (
    /** @type {ComponentContextLegacy} */
    P
  );
  qt(() => {
    for (var t of e.l.$) {
      t.deps();
      var r = t.effect;
      (r.f & I) !== 0 && r.deps !== null && O(r, te), ot(r) && ze(r), t.ran = !1;
    }
  });
}
function Ks(e) {
  return pe(Ze | st, e);
}
function qt(e, t = 0) {
  return pe(Tt | t, e);
}
function Ne(e, t = [], r = [], n = []) {
  Es(n, t, r, (i) => {
    pe(Tt, () => {
      e(...i.map(l));
    });
  });
}
function Yt(e, t = 0) {
  var r = pe(ae | t, e);
  return r;
}
function Q(e) {
  return pe(re | st, e);
}
function Qn(e) {
  var t = e.teardown;
  if (t !== null) {
    const r = Se, n = S;
    hn(!0), ne(null);
    try {
      t.call(null);
    } catch (i) {
      ce(i, e.parent);
    } finally {
      hn(r), ne(n);
    }
  }
}
function Or(e, t = !1) {
  var r = e.first;
  for (e.first = e.last = null; r !== null; ) {
    const i = r.ac;
    i !== null && Nt(() => {
      i.abort(xt);
    });
    var n = r.next;
    (r.f & ke) !== 0 ? r.parent = null : $(r, t), r = n;
  }
}
function Ws(e) {
  for (var t = e.first; t !== null; ) {
    var r = t.next;
    (t.f & re) === 0 && $(t), t = r;
  }
}
function $(e, t = !0) {
  var r = !1;
  (t || (e.f & Wi) !== 0) && e.nodes !== null && e.nodes.end !== null && (Us(
    e.nodes.start,
    /** @type {TemplateNode} */
    e.nodes.end
  ), r = !0), e.f |= Bt, Or(e, t && !r), St(e, 0);
  var n = e.nodes && e.nodes.t;
  if (n !== null)
    for (const s of n)
      s.stop();
  Qn(e), e.f ^= Bt, e.f |= G;
  var i = e.parent;
  i !== null && i.first !== null && ei(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function Us(e, t) {
  for (; e !== null; ) {
    var r = e === t ? null : /* @__PURE__ */ Mt(e);
    e.remove(), e = r;
  }
}
function ei(e) {
  var t = e.parent, r = e.prev, n = e.next;
  r !== null && (r.next = n), n !== null && (n.prev = r), t !== null && (t.first === e && (t.first = n), t.last === e && (t.last = r));
}
function Ke(e, t, r = !0) {
  var n = [];
  e.f |= Tr, ti(e, n, !0);
  var i = () => {
    r && $(e), t && t();
  }, s = n.length;
  if (s > 0) {
    var o = () => --s || i();
    for (var a of n)
      a.out(o);
  } else
    i();
}
function ti(e, t, r) {
  if ((e.f & V) === 0) {
    e.f ^= V;
    var n = e.nodes && e.nodes.t;
    if (n !== null)
      for (const a of n)
        (a.is_global || r) && t.push(a);
    for (var i = e.first; i !== null; ) {
      var s = i.next;
      if ((i.f & ke) === 0) {
        var o = (i.f & tt) !== 0 || // If this is a branch effect without a block effect parent,
        // it means the parent block effect was pruned. In that case,
        // transparency information was transferred to the branch effect.
        (i.f & re) !== 0 && (e.f & ae) !== 0;
        ti(i, t, o ? r : !1);
      }
      i = s;
    }
  }
}
function Ut(e) {
  e.f &= ~Tr, ri(e, !0);
}
function ri(e, t) {
  if ((e.f & Tr) === 0 && (e.f & V) !== 0) {
    e.f ^= V, (e.f & I) === 0 && (O(e, B), Pe.ensure().schedule(e));
    for (var r = e.first; r !== null; ) {
      var n = r.next, i = (r.f & tt) !== 0 || (r.f & re) !== 0;
      ri(r, i ? t : !1), r = n;
    }
    var s = e.nodes && e.nodes.t;
    if (s !== null)
      for (const o of s)
        (o.is_global || t) && o.in();
  }
}
function Dr(e, t) {
  if (e.nodes)
    for (var r = e.nodes.start, n = e.nodes.end; r !== null; ) {
      var i = r === n ? null : /* @__PURE__ */ Mt(r);
      t.append(r), r = i;
    }
}
let It = !1, Se = !1;
function hn(e) {
  Se = e;
}
let S = null, fe = !1;
function ne(e) {
  S = e;
}
let b = null;
function ie(e) {
  b = e;
}
let he = null;
function Vs(e) {
  S !== null && (he ??= /* @__PURE__ */ new Set()).add(e);
}
let Y = null, X = 0, Z = null;
function zs(e) {
  Z = e;
}
let ni = 1, Fe = 0, We = Fe;
function pn(e) {
  We = e;
}
function ii() {
  return ++ni;
}
function ot(e) {
  var t = e.f;
  if ((t & B) !== 0)
    return !0;
  if (t & H && (e.f &= ~Ue), (t & te) !== 0) {
    for (var r = (
      /** @type {Value[]} */
      e.deps
    ), n = r.length, i = 0; i < n; i++) {
      var s = r[i];
      if (ot(
        /** @type {Derived} */
        s
      ) && Hn(
        /** @type {Derived} */
        s
      ), s.wv > e.wv)
        return !0;
    }
    (t & ee) !== 0 && // During time traveling we don't want to reset the status so that
    // traversal of the graph in the other batches still happens
    oe === null && O(e, I);
  }
  return !1;
}
function si(e, t, r = !0) {
  var n = e.reactions;
  if (n !== null && !(he !== null && he.has(e)))
    for (var i = 0; i < n.length; i++) {
      var s = n[i];
      (s.f & H) !== 0 ? si(
        /** @type {Derived} */
        s,
        t,
        !1
      ) : t === s && (r ? O(s, B) : (s.f & I) !== 0 && O(s, te), Pr(
        /** @type {Effect} */
        s
      ));
    }
}
function li(e) {
  var t = Y, r = X, n = Z, i = S, s = he, o = P, a = fe, f = We, u = e.f;
  Y = /** @type {null | Value[]} */
  null, X = 0, Z = null, S = (u & (re | ke)) === 0 ? e : null, he = null, rt(e.ctx), fe = !1, We = ++Fe, e.ac !== null && (Nt(() => {
    e.ac.abort(xt);
  }), e.ac = null);
  try {
    e.f |= Ht;
    var p = (
      /** @type {Function} */
      e.fn
    ), d = p();
    e.f |= it;
    var _ = _n(e);
    if (at() && Z !== null && !fe && _ !== null && (e.f & (H | te | B)) === 0)
      for (var v = 0; v < /** @type {Source[]} */
      Z.length; v++)
        si(
          Z[v],
          /** @type {Effect} */
          e
        );
    if (i !== null && i !== e) {
      if (Fe++, i.deps !== null)
        for (let c = 0; c < r; c += 1)
          i.deps[c].rv = Fe;
      if (t !== null)
        for (const c of t)
          c.rv = Fe;
      Z !== null && (n === null ? n = Z : n.push(.../** @type {Source[]} */
      Z));
    }
    return (e.f & Ae) !== 0 && (e.f ^= Ae), d;
  } catch (c) {
    return _n(e), Ds(c);
  } finally {
    e.f ^= Ht, Y = t, X = r, Z = n, S = i, he = s, rt(o), fe = a, We = f;
  }
}
function _n(e) {
  var t = e.deps, r = T?.is_fork;
  if (Y !== null) {
    var n;
    if (r || St(e, X), t !== null && X > 0)
      for (t.length = X + Y.length, n = 0; n < Y.length; n++)
        t[X + n] = Y[n];
    else
      e.deps = t = Y;
    if (Lr() && (e.f & ee) !== 0)
      for (n = X; n < t.length; n++)
        (t[n].reactions ??= []).push(e);
  } else !r && t !== null && X < t.length && (St(e, X), t.length = X);
  return t;
}
function qs(e, t) {
  let r = t.reactions;
  if (r !== null) {
    var n = Fi.call(r, e);
    if (n !== -1) {
      var i = r.length - 1;
      i === 0 ? r = t.reactions = null : (r[n] = r[i], r.pop());
    }
  }
  if (r === null && (t.f & H) !== 0 && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (Y === null || !Ft.call(Y, t))) {
    var s = (
      /** @type {Derived} */
      t
    );
    (s.f & ee) !== 0 && (s.f ^= ee, s.f &= ~Ue), s.v !== F && Nr(s), s.ac !== null && Nt(() => {
      s.ac.abort(xt), s.ac = null, O(s, B);
    }), xs(s), St(s, 0);
  }
}
function St(e, t) {
  var r = e.deps;
  if (r !== null)
    for (var n = t; n < r.length; n++)
      qs(e, r[n]);
}
function ze(e) {
  var t = e.f;
  if ((t & G) === 0) {
    O(e, I);
    var r = b, n = It;
    b = e, It = (t & (re | ke)) === 0;
    try {
      (t & (ae | Mn)) !== 0 ? Ws(e) : Or(e), Qn(e);
      var i = li(e);
      e.teardown = typeof i == "function" ? i : null, e.wv = ni;
      var s;
    } finally {
      It = n, b = r;
    }
  }
}
function l(e) {
  var t = e.f, r = (t & H) !== 0;
  if (S !== null && !fe) {
    var n = b !== null && (b.f & G) !== 0;
    if (!n && (he === null || !he.has(e))) {
      var i = S.deps;
      if ((S.f & Ht) !== 0)
        e.rv < Fe && (e.rv = Fe, Y === null && i !== null && i[X] === e ? X++ : Y === null ? Y = [e] : Y.push(e));
      else {
        S.deps ??= [], Ft.call(S.deps, e) || S.deps.push(e);
        var s = e.reactions;
        s === null ? e.reactions = [S] : Ft.call(s, S) || s.push(S);
      }
    }
  }
  if (Se && ve.has(e))
    return ve.get(e);
  if (r) {
    var o = (
      /** @type {Derived} */
      e
    );
    if (Se) {
      var a = o.v;
      return ((o.f & I) === 0 && o.reactions !== null || oi(o)) && (a = Rr(o)), ve.set(o, a), a;
    }
    var f = (o.f & ee) === 0 && !fe && S !== null && (It || (S.f & ee) !== 0), u = (o.f & it) === 0;
    ot(o) && (f && (o.f |= ee), Hn(o)), f && !u && (Kn(o), ai(o));
  }
  if (oe?.has(e))
    return oe.get(e);
  if ((e.f & Ae) !== 0)
    throw e.v;
  return e.v;
}
function ai(e) {
  if (e.f |= ee, e.deps !== null)
    for (const t of e.deps)
      (t.reactions ??= []).push(e), (t.f & H) !== 0 && (t.f & ee) === 0 && (Kn(
        /** @type {Derived} */
        t
      ), ai(
        /** @type {Derived} */
        t
      ));
}
function oi(e) {
  if (e.v === F) return !0;
  if (e.deps === null) return !1;
  for (const t of e.deps)
    if (ve.has(t) || (t.f & H) !== 0 && oi(
      /** @type {Derived} */
      t
    ))
      return !0;
  return !1;
}
function L(e) {
  var t = fe;
  try {
    return fe = !0, e();
  } finally {
    fe = t;
  }
}
function fi(e) {
  if (!(typeof e != "object" || !e || e instanceof EventTarget)) {
    if (je in e)
      mr(e);
    else if (!Array.isArray(e))
      for (let t in e) {
        const r = e[t];
        typeof r == "object" && r && je in r && mr(r);
      }
  }
}
function mr(e, t = /* @__PURE__ */ new Set()) {
  if (typeof e == "object" && e !== null && // We don't want to traverse DOM elements
  !(e instanceof EventTarget) && !t.has(e)) {
    t.add(e), e instanceof Date && e.getTime();
    for (let n in e)
      try {
        mr(e[n], t);
      } catch {
      }
    const r = Sr(e);
    if (r !== Object.prototype && r !== Array.prototype && r !== Map.prototype && r !== Set.prototype && r !== Date.prototype) {
      const n = xn(r);
      for (let i in n) {
        const s = n[i].get;
        if (s)
          try {
            s.call(e);
          } catch {
          }
      }
    }
  }
}
const Ys = ["touchstart", "touchmove"];
function Gs(e) {
  return Ys.includes(e);
}
const Ct = /* @__PURE__ */ Symbol("events"), $s = /* @__PURE__ */ new Set(), gn = /* @__PURE__ */ new Set();
function Js(e, t, r, n = {}) {
  function i(s) {
    if (n.capture || br.call(t, s), !s.cancelBubble)
      return Nt(() => r?.call(this, s));
  }
  return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? Re(() => {
    t.addEventListener(e, i, n);
  }) : t.addEventListener(e, i, n), i;
}
function U(e, t, r, n, i) {
  var s = { capture: n, passive: i }, o = Js(e, t, r, s);
  (t === document.body || // @ts-ignore
  t === window || // @ts-ignore
  t === document || // Firefox has quirky behavior, it can happen that we still get "canplay" events when the element is already removed
  t instanceof HTMLMediaElement) && Cr(() => {
    t.removeEventListener(e, o, s);
  });
}
let lr = null, ar = !1;
function br(e) {
  var t = this, r = (
    /** @type {Node} */
    t.ownerDocument
  ), n = e.type, i = e.composedPath?.() || [], s = (
    /** @type {null | Element} */
    i[0] || e.target
  );
  lr = e, ar || (ar = !0, setTimeout(() => {
    ar = !1, lr = null;
  }));
  var o = 0, a = lr === e && e[Ct];
  if (a) {
    var f = i.indexOf(a);
    if (f !== -1 && (t === document || t === /** @type {any} */
    window)) {
      e[Ct] = t;
      return;
    }
    var u = i.indexOf(t);
    if (u === -1)
      return;
    f <= u && (o = f);
  }
  if (s = /** @type {Element} */
  i[o] || e.target, s !== t) {
    Tn(e, "currentTarget", {
      configurable: !0,
      get() {
        return s || r;
      }
    });
    var p = S, d = b;
    ne(null), ie(null);
    try {
      for (var _, v = []; s !== null && s !== t; ) {
        try {
          var c = s[Ct]?.[n];
          c != null && (!/** @type {any} */
          s.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
          // -> the target could not have been disabled because it emits the event in the first place
          e.target === s) && c.call(s, e);
        } catch (w) {
          _ ? v.push(w) : _ = w;
        }
        if (e.cancelBubble) break;
        o++, s = o < i.length ? (
          /** @type {Element} */
          i[o]
        ) : null;
      }
      if (_) {
        for (let w of v)
          queueMicrotask(() => {
            throw w;
          });
        throw _;
      }
    } finally {
      e[Ct] = t, delete e.currentTarget, ne(p), ie(d);
    }
  }
}
const Xs = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
    /** @param {string} html */
    createHTML: (e) => e
  })
);
function Zs(e) {
  return (
    /** @type {string} */
    Xs?.createHTML(e) ?? e
  );
}
function Qs(e) {
  var t = Os("template");
  return t.innerHTML = Zs(e.replaceAll("<!>", "<!---->")), t.content;
}
function yn(e, t) {
  var r = (
    /** @type {Effect} */
    b
  );
  r.nodes === null && (r.nodes = { start: e, end: t, a: null, t: null });
}
// @__NO_SIDE_EFFECTS__
function Te(e, t) {
  var r = (t & ts) !== 0, n = (t & rs) !== 0, i, s = !e.startsWith("<!>");
  return () => {
    i === void 0 && (i = Qs(s ? e : "<!>" + e), r || (i = /** @type {TemplateNode} */
    /* @__PURE__ */ kt(i)));
    var o = (
      /** @type {TemplateNode} */
      n || Yn ? document.importNode(i, !0) : i.cloneNode(!0)
    );
    if (r) {
      var a = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ kt(o)
      ), f = (
        /** @type {TemplateNode} */
        o.lastChild
      );
      yn(a, f);
    } else
      yn(o, o);
    return o;
  };
}
function me(e, t) {
  e !== null && e.before(
    /** @type {Node} */
    t
  );
}
function el(e) {
  let t = 0, r = Ve(0), n;
  return () => {
    Lr() && (l(r), qt(() => (t === 0 && (n = L(() => e(() => bt(r)))), t += 1, () => {
      Re(() => {
        t -= 1, t === 0 && (n?.(), n = void 0, bt(r));
      });
    })));
  };
}
var tl = tt | st;
function rl(e, t, r, n) {
  new nl(e, t, r, n);
}
class nl {
  /** @type {Boundary | null} */
  parent;
  is_pending = !1;
  /**
   * API-level transformError transform function. Transforms errors before they reach the `failed` snippet.
   * Inherited from parent boundary, or defaults to identity.
   * @type {(error: unknown) => unknown}
   */
  transform_error;
  /** @type {TemplateNode} */
  #t;
  /** @type {TemplateNode | null} */
  #l = null;
  /** @type {BoundaryProps} */
  #e;
  /** @type {((anchor: Node) => void)} */
  #o;
  /** @type {Effect} */
  #n;
  /** @type {Effect | null} */
  #s = null;
  /** @type {Effect | null} */
  #r = null;
  /** @type {Effect | null} */
  #a = null;
  /** @type {DocumentFragment | null} */
  #i = null;
  #p = 0;
  #f = 0;
  #u = !1;
  /** @type {Set<Effect>} */
  #d = /* @__PURE__ */ new Set();
  /** @type {Set<Effect>} */
  #_ = /* @__PURE__ */ new Set();
  /**
   * A source containing the number of pending async deriveds/expressions.
   * Only created if `$effect.pending()` is used inside the boundary,
   * otherwise updating the source results in needless `Batch.ensure()`
   * calls followed by no-op flushes
   * @type {Source<number> | null}
   */
  #c = null;
  #m = el(() => (this.#c = Ve(this.#p), () => {
    this.#c = null;
  }));
  /**
   * @param {TemplateNode} node
   * @param {BoundaryProps} props
   * @param {((anchor: Node) => void)} children
   * @param {((error: unknown) => unknown) | undefined} [transform_error]
   */
  constructor(t, r, n, i) {
    this.#t = t, this.#e = r, this.#o = (s) => {
      var o = (
        /** @type {Effect} */
        b
      );
      o.b = this, o.f |= vr, n(s);
    }, this.parent = /** @type {Effect} */
    b.b, this.transform_error = i ?? this.parent?.transform_error ?? ((s) => s), this.#n = Yt(() => {
      this.#v();
    }, tl);
  }
  #g() {
    try {
      this.#s = Q(() => this.#o(this.#t));
    } catch (t) {
      this.error(t);
    }
  }
  /**
   * @param {unknown} error The deserialized error from the server's hydration comment
   */
  #w(t) {
    const r = this.#e.failed, { reset: n, invoke_onerror: i } = this.#b(t);
    Re(i), r && (this.#a = Q(() => {
      r(
        this.#t,
        () => t,
        () => n
      );
    }));
  }
  /**
   * Creates the `reset` function for a failed boundary, along with a function
   * that invokes `onerror` with it (if provided)
   * @param {unknown} error
   * @returns {{ reset: () => void, invoke_onerror: () => void }}
   */
  #b(t) {
    var r = !1, n = !1;
    const i = () => {
      if (r) {
        ss();
        return;
      }
      r = !0, n && gs(), this.#a !== null && Ke(this.#a, () => {
        this.#a = null;
      }), this.#h(() => {
        this.#v();
      });
    };
    return { reset: i, invoke_onerror: () => {
      try {
        n = !0, this.#e.onerror?.(t, i), n = !1;
      } catch (o) {
        ce(o, this.#n && this.#n.parent);
      }
    } };
  }
  #E() {
    const t = this.#e.pending;
    t && (this.is_pending = !0, this.#r = Q(() => t(this.#t)), Re(() => {
      var r = this.#i = document.createDocumentFragment(), n = He(), i = !1;
      if (r.append(n), this.#s = this.#h(() => {
        try {
          return Q(() => this.#o(n));
        } catch (s) {
          try {
            this.error(s), i = !0;
          } catch (o) {
            ce(o, this.#n.parent);
          }
          return null;
        }
      }), this.#s === null) {
        this.#i = null, i && this.#y(
          /** @type {Batch} */
          T
        );
        return;
      }
      this.#f === 0 && (this.#t.before(r), this.#i = null, Ke(
        /** @type {Effect} */
        this.#r,
        () => {
          this.#r = null;
        }
      ), this.#y(
        /** @type {Batch} */
        T
      ));
    }));
  }
  #v() {
    try {
      if (this.is_pending = this.has_pending_snippet(), this.#f = 0, this.#p = 0, this.#s = Q(() => {
        this.#o(this.#t);
      }), this.#f > 0) {
        var t = this.#i = document.createDocumentFragment();
        Dr(this.#s, t);
        const r = (
          /** @type {(anchor: Node) => void} */
          this.#e.pending
        );
        this.#r = Q(() => r(this.#t));
      } else
        this.#y(
          /** @type {Batch} */
          T
        );
    } catch (r) {
      this.error(r);
    }
  }
  /**
   * @param {Batch} batch
   */
  #y(t) {
    this.is_pending = !1, t.transfer_effects(this.#d, this.#_);
  }
  /**
   * Defer an effect inside a pending boundary until the boundary resolves
   * @param {Effect} effect
   */
  defer_effect(t) {
    Bn(t, this.#d, this.#_);
  }
  /**
   * Returns `false` if the effect exists inside a boundary whose pending snippet is shown
   * @returns {boolean}
   */
  is_rendered() {
    return !this.is_pending && (!this.parent || this.parent.is_rendered());
  }
  has_pending_snippet() {
    return !!this.#e.pending;
  }
  /**
   * @template T
   * @param {() => T} fn
   */
  #h(t) {
    var r = b, n = S, i = P;
    ie(this.#n), ne(this.#n), rt(this.#n.ctx);
    try {
      return Pe.ensure(), t();
    } finally {
      ie(r), ne(n), rt(i);
    }
  }
  /**
   * Updates the pending count associated with the currently visible pending snippet,
   * if any, such that we can replace the snippet with content once work is done
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  #k(t, r) {
    if (!this.has_pending_snippet()) {
      this.parent && this.parent.#k(t, r);
      return;
    }
    this.#f += t, this.#f === 0 && (this.#y(r), this.#r && Ke(this.#r, () => {
      this.#r = null;
    }), this.#i && (this.#t.before(this.#i), this.#i = null));
  }
  /**
   * Update the source that powers `$effect.pending()` inside this boundary,
   * and controls when the current `pending` snippet (if any) is removed.
   * Do not call from inside the class
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  update_pending_count(t, r) {
    this.#k(t, r), this.#p += t, !(!this.#c || this.#u) && (this.#u = !0, Re(() => {
      this.#u = !1, this.#c && nt(this.#c, this.#p);
    }));
  }
  get_effect_pending() {
    return this.#m(), l(
      /** @type {Source<number>} */
      this.#c
    );
  }
  /** @param {unknown} error */
  error(t) {
    if (!this.#e.onerror && !this.#e.failed)
      throw t;
    T?.is_fork ? (this.#s && T.skip_effect(this.#s), this.#r && T.skip_effect(this.#r), this.#a && T.skip_effect(this.#a), T.oncommit(() => {
      this.#S(t);
    })) : this.#S(t);
  }
  /**
   * @param {unknown} error
   */
  #S(t) {
    this.#s && ($(this.#s), this.#s = null), this.#r && ($(this.#r), this.#r = null), this.#a && ($(this.#a), this.#a = null);
    let r = this.#e.failed;
    const n = (i) => {
      const { reset: s, invoke_onerror: o } = this.#b(i);
      o(), r && (this.#a = this.#h(() => {
        try {
          return Q(() => {
            var a = (
              /** @type {Effect} */
              b
            );
            a.b = this, a.f |= vr, r(
              this.#t,
              () => i,
              () => s
            );
          });
        } catch (a) {
          return ce(
            a,
            /** @type {Effect} */
            this.#n.parent
          ), null;
        }
      }));
    };
    Re(() => {
      var i;
      try {
        i = this.transform_error(t);
      } catch (s) {
        ce(s, this.#n && this.#n.parent);
        return;
      }
      i !== null && typeof i == "object" && typeof /** @type {any} */
      i.then == "function" ? i.then(
        n,
        /** @param {unknown} e */
        (s) => ce(s, this.#n && this.#n.parent)
      ) : n(i);
    });
  }
}
function le(e, t) {
  var r = t == null ? "" : typeof t == "object" ? `${t}` : t;
  r !== /** @type {any} */
  (e[pr] ??= e.nodeValue) && (e[pr] = r, e.nodeValue = `${r}`);
}
function il(e, t) {
  return sl(e, t);
}
const Ot = /* @__PURE__ */ new Map();
function sl(e, { target: t, anchor: r, props: n = {}, events: i, context: s, intro: o = !0, transformError: a }) {
  Ps();
  var f = void 0, u = Bs(() => {
    var p = r ?? t.appendChild(He());
    rl(
      /** @type {TemplateNode} */
      p,
      {
        pending: () => {
        }
      },
      (v) => {
        Dn({});
        var c = (
          /** @type {ComponentContext} */
          P
        );
        s && (c.c = s), i && (n.$$events = i), f = e(v, n) || xr(), In();
      },
      a
    );
    var d = /* @__PURE__ */ new Set(), _ = (v) => {
      for (var c = 0; c < v.length; c++) {
        var w = v[c];
        if (!d.has(w)) {
          d.add(w);
          var D = Gs(w);
          for (const W of [t, document]) {
            var N = Ot.get(W);
            N === void 0 && (N = /* @__PURE__ */ new Map(), Ot.set(W, N));
            var E = N.get(w);
            E === void 0 ? (W.addEventListener(w, br, { passive: D }), N.set(w, 1)) : N.set(w, E + 1);
          }
        }
      }
    };
    return _(zt($s)), gn.add(_), () => {
      for (var v of d)
        for (const D of [t, document]) {
          var c = (
            /** @type {Map<string, number>} */
            Ot.get(D)
          ), w = (
            /** @type {number} */
            c.get(v)
          );
          --w == 0 ? (D.removeEventListener(v, br), c.delete(v), c.size === 0 && Ot.delete(D)) : c.set(v, w);
        }
      gn.delete(_), p !== r && p.parentNode?.removeChild(p);
    };
  });
  return wr.set(f, u), f;
}
let wr = /* @__PURE__ */ new WeakMap();
function ll(e, t) {
  const r = wr.get(e);
  return r ? (wr.delete(e), r(t)) : Promise.resolve();
}
class ui {
  /** @type {TemplateNode} */
  anchor;
  /** @type {Map<Batch, Key>} */
  #t = /* @__PURE__ */ new Map();
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
  #l = /* @__PURE__ */ new Map();
  /**
   * Similar to #onscreen with respect to the keys, but contains branches that are not yet
   * in the DOM, because their insertion is deferred.
   * @type {Map<Key, Branch>}
   */
  #e = /* @__PURE__ */ new Map();
  /**
   * Keys of effects that are currently outroing
   * @type {Set<Key>}
   */
  #o = /* @__PURE__ */ new Set();
  /**
   * Whether to pause (i.e. outro) on change, or destroy immediately.
   * This is necessary for `<svelte:element>`
   */
  #n = !0;
  /**
   * @param {TemplateNode} anchor
   * @param {boolean} transition
   */
  constructor(t, r = !0) {
    this.anchor = t, this.#n = r;
  }
  /**
   * @param {Batch} batch
   */
  #s = (t) => {
    if (this.#t.has(t)) {
      var r = (
        /** @type {Key} */
        this.#t.get(t)
      ), n = this.#l.get(r);
      if (n)
        Ut(n), this.#o.delete(r);
      else {
        var i = this.#e.get(r);
        i && (Ut(i.effect), this.#l.set(r, i.effect), this.#e.delete(r), i.fragment.lastChild.remove(), this.anchor.before(i.fragment), n = i.effect);
      }
      for (const [s, o] of this.#t) {
        if (this.#t.delete(s), s === t)
          break;
        const a = this.#e.get(o);
        a && ($(a.effect), this.#e.delete(o));
      }
      for (const [s, o] of this.#l) {
        if (s === r || this.#o.has(s)) continue;
        const a = () => {
          if (Array.from(this.#t.values()).includes(s)) {
            var u = document.createDocumentFragment();
            Dr(o, u), u.append(He()), this.#e.set(s, { effect: o, fragment: u });
          } else
            $(o);
          this.#o.delete(s), this.#l.delete(s);
        };
        this.#n || !n ? (this.#o.add(s), Ke(o, a, !1)) : a();
      }
    }
  };
  /**
   * @param {Batch} batch
   */
  #r = (t) => {
    this.#t.delete(t);
    const r = Array.from(this.#t.values());
    for (const [n, i] of this.#e)
      r.includes(n) || ($(i.effect), this.#e.delete(n));
  };
  /**
   *
   * @param {any} key
   * @param {null | ((target: TemplateNode) => void)} fn
   */
  ensure(t, r) {
    var n = (
      /** @type {Batch} */
      T
    ), i = Jn();
    if (r && !this.#l.has(t) && !this.#e.has(t))
      if (i) {
        var s = document.createDocumentFragment(), o = He();
        s.append(o), this.#e.set(t, {
          effect: Q(() => r(o)),
          fragment: s
        });
      } else
        this.#l.set(
          t,
          Q(() => r(this.anchor))
        );
    if (this.#t.set(n, t), i) {
      for (const [a, f] of this.#l)
        a === t ? n.unskip_effect(f) : n.skip_effect(f);
      for (const [a, f] of this.#e)
        a === t ? n.unskip_effect(f.effect) : n.skip_effect(f.effect);
      n.oncommit(this.#s), n.ondiscard(this.#r);
    } else
      this.#s(n);
  }
}
function vt(e, t, r = !1) {
  var n = new ui(e), i = r ? tt : 0;
  function s(o, a) {
    n.ensure(o, a);
  }
  Yt(() => {
    var o = !1;
    t((a, f = 0) => {
      o = !0, s(f, a);
    }), o || s(-1, null);
  }, i);
}
const al = /* @__PURE__ */ Symbol("NaN");
function ol(e, t, r) {
  var n = new ui(e), i = !at();
  Yt(() => {
    var s = t();
    s !== s && (s = /** @type {any} */
    al), i && s !== null && typeof s == "object" && (s = /** @type {V} */
    {}), n.ensure(s, r);
  });
}
function fl(e, t, r) {
  for (var n = [], i = t.length, s, o = t.length, a = 0; a < i; a++) {
    let d = t[a];
    Ke(
      d,
      () => {
        if (s) {
          if (s.pending.delete(d), s.done.add(d), s.pending.size === 0) {
            var _ = (
              /** @type {Set<EachOutroGroup>} */
              e.outrogroups
            );
            Er(e, zt(s.done)), _.delete(s), _.size === 0 && (e.outrogroups = null);
          }
        } else
          o -= 1;
      },
      !1
    );
  }
  if (o === 0) {
    var f = n.length === 0 && r !== null && e.pending.size === 0;
    if (f) {
      var u = (
        /** @type {Element} */
        r
      ), p = (
        /** @type {Element} */
        u.parentNode
      );
      Cs(p), p.append(u), e.items.clear();
    }
    Er(e, t, !f);
  } else
    s = {
      pending: new Set(t),
      done: /* @__PURE__ */ new Set()
    }, (e.outrogroups ??= /* @__PURE__ */ new Set()).add(s);
}
function Er(e, t, r = !0) {
  var n;
  if (e.pending.size > 0) {
    n = /* @__PURE__ */ new Set();
    for (const o of e.pending.values())
      for (const a of o)
        n.add(
          /** @type {EachItem} */
          e.items.get(a).e
        );
  }
  for (var i = 0; i < t.length; i++) {
    var s = t[i];
    if (n?.has(s)) {
      s.f |= Ee;
      const o = document.createDocumentFragment();
      Dr(s, o);
    } else
      $(t[i], r);
  }
}
var mn;
function ul(e, t, r, n, i, s = null) {
  var o = e, a = /* @__PURE__ */ new Map();
  {
    var f = (
      /** @type {Element} */
      e
    );
    o = f.appendChild(He());
  }
  var u = null, p = /* @__PURE__ */ Mr(() => {
    var E = r();
    return (
      /** @type {V[]} */
      Sn(E) ? E : E == null ? [] : zt(E)
    );
  }), d, _ = /* @__PURE__ */ new Map(), v = !0;
  function c(E) {
    (N.effect.f & G) === 0 && (N.pending.delete(E), N.fallback = u, cl(N, d, o, t, n), u !== null && (d.length === 0 ? (u.f & Ee) === 0 ? Ut(u) : (u.f ^= Ee, mt(u, null, o)) : Ke(u, () => {
      u = null;
    })));
  }
  function w(E) {
    N.pending.delete(E);
  }
  var D = Yt(() => {
    d = /** @type {V[]} */
    l(p);
    for (var E = d.length, W = /* @__PURE__ */ new Set(), M = (
      /** @type {Batch} */
      T
    ), z = Jn(), q = 0; q < E; q += 1) {
      var Le = d[q], J = n(Le, q), y = v ? null : a.get(J);
      y ? (y.v && nt(y.v, Le), y.i && nt(y.i, q), z && M.unskip_effect(y.e)) : (y = dl(
        a,
        v ? o : mn ??= He(),
        Le,
        J,
        q,
        i,
        t,
        r
      ), v || (y.e.f |= Ee), a.set(J, y)), W.add(J);
    }
    if (E === 0 && s && !u && (v ? u = Q(() => s(o)) : (u = Q(() => s(mn ??= He())), u.f |= Ee)), E > W.size && os(), !v)
      if (_.set(M, W), z) {
        for (const [m, _e] of a)
          W.has(m) || M.skip_effect(_e.e);
        M.oncommit(c), M.ondiscard(w);
      } else
        c(M);
    l(p);
  }), N = { effect: D, items: a, pending: _, outrogroups: null, fallback: u };
  v = !1;
}
function ht(e) {
  for (; e !== null && (e.f & re) === 0; )
    e = e.next;
  return e;
}
function cl(e, t, r, n, i) {
  var s = t.length, o = e.items, a = ht(e.effect.first), f, u = null, p = [], d = [], _, v, c, w;
  for (w = 0; w < s; w += 1) {
    if (_ = t[w], v = i(_, w), c = /** @type {EachItem} */
    o.get(v).e, e.outrogroups !== null)
      for (const J of e.outrogroups)
        J.pending.delete(c), J.done.delete(c);
    if ((c.f & V) !== 0 && Ut(c), (c.f & Ee) !== 0)
      if (c.f ^= Ee, c === a)
        mt(c, null, r);
      else {
        var D = u ? u.next : a;
        c === e.effect.last && (e.effect.last = c.prev), c.prev && (c.prev.next = c.next), c.next && (c.next.prev = c.prev), Me(e, u, c), Me(e, c, D), mt(c, D, r), u = c, p = [], d = [], a = ht(u.next);
        continue;
      }
    if (c !== a) {
      if (f !== void 0 && f.has(c)) {
        if (p.length < d.length) {
          var N = d[0], E;
          u = N.prev;
          var W = p[0], M = p[p.length - 1];
          for (E = 0; E < p.length; E += 1)
            mt(p[E], N, r);
          for (E = 0; E < d.length; E += 1)
            f.delete(d[E]);
          Me(e, W.prev, M.next), Me(e, u, W), Me(e, M, N), a = N, u = M, w -= 1, p = [], d = [];
        } else
          f.delete(c), mt(c, a, r), Me(e, c.prev, c.next), Me(e, c, u === null ? e.effect.first : u.next), Me(e, u, c), u = c;
        continue;
      }
      for (p = [], d = []; a !== null && a !== c; )
        (f ??= /* @__PURE__ */ new Set()).add(a), d.push(a), a = ht(a.next);
      if (a === null)
        continue;
    }
    (c.f & Ee) === 0 && p.push(c), u = c, a = ht(c.next);
  }
  if (e.outrogroups !== null) {
    for (const J of e.outrogroups)
      J.pending.size === 0 && (Er(e, zt(J.done)), e.outrogroups?.delete(J));
    e.outrogroups.size === 0 && (e.outrogroups = null);
  }
  if (a !== null || f !== void 0) {
    var z = [];
    if (f !== void 0)
      for (c of f)
        (c.f & V) === 0 && z.push(c);
    for (; a !== null; )
      (a.f & V) === 0 && a !== e.fallback && z.push(a), a = ht(a.next);
    var q = z.length;
    if (q > 0) {
      var Le = s === 0 ? r : null;
      fl(e, z, Le);
    }
  }
}
function dl(e, t, r, n, i, s, o, a) {
  var f = (o & Yi) !== 0 ? (o & $i) === 0 ? /* @__PURE__ */ A(r, !1, !1) : Ve(r) : null, u = (o & Gi) !== 0 ? Ve(i) : null;
  return {
    v: f,
    i: u,
    e: Q(() => (s(t, f ?? r, u ?? i, a), () => {
      e.delete(n);
    }))
  };
}
function mt(e, t, r) {
  if (e.nodes)
    for (var n = e.nodes.start, i = e.nodes.end, s = t && (t.f & Ee) === 0 ? (
      /** @type {EffectNodes} */
      t.nodes.start
    ) : r; n !== null; ) {
      var o = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ Mt(n)
      );
      if (s.before(n), n === i)
        return;
      n = o;
    }
}
function Me(e, t, r) {
  t === null ? e.effect.first = r : t.next = r, r === null ? e.effect.last = t : r.prev = t;
}
const bn = [...` 	
\r\f \v\uFEFF`];
function vl(e, t, r) {
  var n = "" + e;
  if (r) {
    for (var i of Object.keys(r))
      if (r[i])
        n = n ? n + " " + i : i;
      else if (n.length)
        for (var s = i.length, o = 0; (o = n.indexOf(i, o)) >= 0; ) {
          var a = o + s;
          (o === 0 || bn.includes(n[o - 1])) && (a === n.length || bn.includes(n[a])) ? n = (o === 0 ? "" : n.substring(0, o)) + n.substring(a + 1) : o = a;
        }
  }
  return n === "" ? null : n;
}
function hl(e, t, r, n, i, s) {
  var o = (
    /** @type {any} */
    e[hr]
  );
  if (o !== r || o === void 0) {
    var a = vl(r, n, s);
    a == null ? e.removeAttribute("class") : e.className = a, e[hr] = r;
  } else if (s && i !== s)
    for (var f in s) {
      var u = !!s[f];
      (i == null || u !== !!i[f]) && e.classList.toggle(f, u);
    }
  return s;
}
const pl = /* @__PURE__ */ Symbol("is custom element"), _l = /* @__PURE__ */ Symbol("is html"), gl = qi ? "progress" : "PROGRESS";
function pt(e, t) {
  var r = Ir(e);
  r.value === (r.value = // treat null and undefined the same for the initial value
  t ?? void 0) || // @ts-expect-error
  // `progress` elements always need their value set when it's `0`
  e.value === t && (t !== 0 || e.nodeName !== gl) || (e.value = t ?? "");
}
function or(e, t) {
  var r = Ir(e);
  r.checked !== (r.checked = // treat null and undefined the same for the initial value
  t ?? void 0) && (e.checked = t);
}
function fr(e, t, r, n) {
  var i = Ir(e);
  i[t] !== (i[t] = r) && (t === "loading" && (e[Vi] = r), r == null ? e.removeAttribute(t) : typeof r != "string" && yl(e).has(t) ? e[t] = r : e.setAttribute(t, r));
}
function Ir(e) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    /** @type {any} */
    e[Pn] ??= {
      [pl]: e.nodeName.includes("-"),
      [_l]: e.namespaceURI === ns
    }
  );
}
var wn = /* @__PURE__ */ new Map();
function yl(e) {
  var t = e.getAttribute("is") || e.nodeName, r = wn.get(t);
  if (r) return r;
  wn.set(t, r = /* @__PURE__ */ new Set());
  for (var n, i = e, s = Element.prototype; s !== i; ) {
    n = xn(i);
    for (var o in n)
      n[o].set && // better safe than sorry, we don't want spread attributes to mess with HTML content
      o !== "innerHTML" && o !== "textContent" && o !== "innerText" && r.add(o);
    i = Sr(i);
  }
  return r;
}
function _t(e, t, r) {
  var n = Be(e, t);
  n && n.set && (e[t] = r, Cr(() => {
    e[t] = null;
  }));
}
function ur(e, t) {
  return e === t || e?.[je] === t;
}
function ml(e = xr(), t, r, n) {
  var i = (
    /** @type {ComponentContext} */
    P.r
  ), s = (
    /** @type {Effect} */
    b
  );
  return js(() => {
    var o, a;
    return qt(() => {
      o = a, a = [], L(() => {
        ur(r(...a), e) || (t(e, ...a), o && ur(r(...o), e) && t(null, ...o));
      });
    }), () => {
      let f = s;
      for (; f !== i && f.parent !== null && f.parent.f & Bt; )
        f = f.parent;
      const u = () => {
        a && ur(r(...a), e) && t(null, ...a);
      }, p = f.teardown;
      f.teardown = () => {
        u(), p?.();
      };
    };
  }), e;
}
function bl(e = !1) {
  const t = (
    /** @type {ComponentContextLegacy} */
    P
  ), r = t.l.u;
  if (!r) return;
  let n = () => fi(t.s);
  if (e) {
    let i = 0, s = (
      /** @type {Record<string, any>} */
      {}
    );
    const o = /* @__PURE__ */ Et(() => {
      let a = !1;
      const f = t.s;
      for (const u in f)
        f[u] !== s[u] && (s[u] = f[u], a = !0);
      return a && i++, i;
    });
    n = () => l(o);
  }
  r.b.length && Fs(() => {
    En(t, n), dr(r.b);
  }), yr(() => {
    const i = L(() => r.m.map(Ki));
    return () => {
      for (const s of i)
        typeof s == "function" && s();
    };
  }), r.a.length && yr(() => {
    En(t, n), dr(r.a);
  });
}
function En(e, t) {
  if (e.l.s)
    for (const r of e.l.s) l(r);
  t();
}
function gt(e, t, r, n) {
  var i = !lt || (r & Xi) !== 0, s = (r & Qi) !== 0, o = (r & es) !== 0, a = (
    /** @type {V} */
    n
  ), f = !0, u = (
    /** @type {Derived<V> | undefined} */
    void 0
  ), p = () => o && i ? (u ??= /* @__PURE__ */ Et(
    /** @type {() => V} */
    n
  ), l(u)) : (f && (f = !1, a = o ? L(
    /** @type {() => V} */
    n
  ) : (
    /** @type {V} */
    n
  )), a);
  let d;
  if (s) {
    var _ = je in e || Ui in e;
    d = Be(e, t)?.set ?? (_ && t in e ? (M) => e[t] = M : void 0);
  }
  var v, c = !1;
  s ? [v, c] = ws(() => (
    /** @type {V} */
    e[t]
  )) : v = /** @type {V} */
  e[t], v === void 0 && n !== void 0 && (v = p(), d && (i && vs(), d(v)));
  var w;
  if (i ? w = () => {
    var M = (
      /** @type {V} */
      e[t]
    );
    return M === void 0 ? p() : (f = !0, M);
  } : w = () => {
    var M = (
      /** @type {V} */
      e[t]
    );
    return M !== void 0 && (a = /** @type {V} */
    void 0), M === void 0 ? a : M;
  }, i && (r & Zi) === 0)
    return w;
  if (d) {
    var D = e.$$legacy;
    return (
      /** @type {() => V} */
      (function(M, z) {
        return arguments.length > 0 ? ((!i || !z || D || c) && d(z ? w() : M), M) : w();
      })
    );
  }
  var N = !1, E = ((r & Ji) !== 0 ? Et : Mr)(() => (N = !1, w()));
  s && l(E);
  var W = (
    /** @type {Effect} */
    b
  );
  return (
    /** @type {() => V} */
    (function(M, z) {
      if (arguments.length > 0) {
        const q = z ? l(E) : i && s ? Xe(M) : M;
        return g(E, q), N = !0, a !== void 0 && (a = q), M;
      }
      return Se && N || (W.f & G) !== 0 ? E.v : l(E);
    })
  );
}
function wl(e) {
  P === null && On(), lt && P.l !== null ? kl(P).m.push(e) : yr(() => {
    const t = L(e);
    if (typeof t == "function") return (
      /** @type {() => void} */
      t
    );
  });
}
function El(e) {
  P === null && On(), wl(() => () => L(e));
}
function kl(e) {
  var t = (
    /** @type {ComponentContextLegacy} */
    e.l
  );
  return t.u ??= { a: [], b: [], m: [] };
}
const Sl = "5";
typeof window < "u" && ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add(Sl);
ys();
const Tl = 2, wt = 5, kr = 17, ci = 3592;
function de(e, t = 0) {
  const r = Number(e);
  return Number.isFinite(r) ? r : t;
}
function xl(e) {
  if (e && typeof e == "object") return (
    /** @type {Record<string, any>} */
    e
  );
  if (typeof e != "string" || !e.trim()) return {};
  try {
    const t = JSON.parse(e);
    return t && typeof t == "object" ? t : {};
  } catch {
    return {};
  }
}
function di(e) {
  const t = Math.trunc(de(e, 0));
  if (t <= 0) return 0;
  const r = Math.min(ci, Math.max(wt, t));
  return wt + kr * Math.round((r - wt) / kr);
}
function jl(e) {
  const t = Number(e);
  return Number.isInteger(t) && (t === 0 || t >= wt && t <= ci && (t - wt) % kr === 0);
}
function kn(e) {
  const t = String(e || "").trim();
  if (!t) return "";
  const r = t.match(/^s?(\d+):r?(\d+)/i);
  return r ? `${Number(r[1])}:${Number(r[2])}` : "";
}
function Hl(e) {
  if (!e || typeof e != "object") throw new Error("审片接口未返回 JSON 对象");
  const t = (
    /** @type {Record<string, any>} */
    e
  );
  if (t.resolved === !1 || t.resolved_success === !1)
    throw new Error(String(t.error || t.message || "审片 token 尚未成功解析"));
  if (t.resolved !== !0 && t.resolved_success !== !0)
    throw new Error("审片接口未确认 resolved=true");
  return t;
}
function Qe(e) {
  const t = xl(e), r = t.retry && typeof t.retry == "object" ? t.retry : t, n = t.options && typeof t.options == "object" ? t.options : t;
  return {
    version: Tl,
    selectedTakeKey: kn(t.selectedTakeKey || t.selected_take_key || ""),
    retryPrompt: String(r.prompt ?? r.retryPrompt ?? ""),
    retrySeed: Math.trunc(de(r.seed ?? r.retrySeed, -1)),
    retryLength: di(r.length ?? r.retryLength),
    retryRunName: String(r.runName ?? r.retryRunName ?? "").trim(),
    retryTakeKey: kn(r.takeKey ?? r.retryTakeKey),
    assemblePartial: !!(n.assemblePartial ?? n.assemble_partial ?? !0),
    timeoutMinutes: Math.max(0, de(n.timeoutMinutes ?? n.timeout_minutes, 0)),
    unloadModels: !!(n.unloadModels ?? n.unload_models ?? !1),
    autoplay: !!(n.autoplay ?? !1)
  };
}
function Nl(e) {
  const t = Qe(e);
  return JSON.stringify({
    version: t.version,
    selectedTakeKey: t.selectedTakeKey,
    retry: {
      prompt: t.retryPrompt,
      seed: t.retrySeed,
      length: t.retryLength,
      ...t.retryRunName && t.retryTakeKey ? { runName: t.retryRunName, takeKey: t.retryTakeKey } : {}
    },
    options: {
      assemblePartial: t.assemblePartial,
      timeoutMinutes: t.timeoutMinutes,
      unloadModels: t.unloadModels,
      autoplay: t.autoplay
    }
  });
}
function we(e) {
  return !e || typeof e != "object" ? "" : `${Math.trunc(de(e.index, 0))}:${Math.trunc(de(e.revision, 1))}`;
}
function Vt(e) {
  const t = e && typeof e == "object" ? (
    /** @type {Record<string, any>} */
    e
  ) : {}, r = Array.isArray(t.history) ? t.history.filter((n) => n && typeof n == "object").map((n) => ({ ...n })) : [];
  return !r.length && (t.preview_clip || t.clip_path) && r.push({
    index: de(t.current_index, 0),
    revision: de(t.revision, 1),
    clip_path: String(t.preview_clip || t.clip_path),
    prompt: String(t.prompt || ""),
    seed: de(t.seed, -1),
    length: de(t.length, 0)
  }), { ...t, history: r };
}
function Fr(e) {
  if (!e || typeof e != "object") return "idle";
  if (e.mode === "history" || e.read_only === !0 || e.restored_history === !0) return "history";
  if (e.awaiting_review) return "reviewing";
  const t = String(e.decision || "").toLowerCase();
  return t === "stop" || t === "approve_stop" ? "stopped" : t === "retry" || t === "reroll" || t === "resume" ? "retrying" : t === "error" ? "error" : t === "approve" || t === "auto" || e.approved === !0 ? "approved" : e.history?.length || e.preview_clip || e.clip_path || e.preview_url ? "ready" : "idle";
}
function Br(e) {
  const t = (
    /** @type {Array<Record<string, any>>} */
    e.history || []
  ), r = e.preview_clip || e.clip_path;
  return r && t.find((n) => n.clip_path === r) || t.find((n) => n.active && Number(n.index) === Number(e.current_index)) || t.at(-1) || null;
}
function Ge(e) {
  return Fr(e) !== "reviewing" ? "" : String(e.token || "") || JSON.stringify([e.run_name, we(Br(e))]);
}
function cr(e, t, r) {
  if (Fr(t) !== "reviewing") return e;
  const n = Br(t), i = String(t.run_name || "").trim(), s = we(n);
  return r && i && s && e.retryRunName === i && e.retryTakeKey === s ? e : {
    ...e,
    selectedTakeKey: s,
    retryPrompt: String(t.prompt ?? n?.prompt ?? ""),
    retrySeed: Math.trunc(de(t.seed ?? n?.seed, -1)),
    retryLength: 0,
    retryRunName: i,
    retryTakeKey: s
  };
}
var Ml = /* @__PURE__ */ Te('<p class="svelte-ah6v1b"> </p>'), Rl = /* @__PURE__ */ Te('<button><strong class="svelte-ah6v1b"> </strong> <span class="svelte-ah6v1b"> </span></button>'), Al = /* @__PURE__ */ Te('<nav class="takes svelte-ah6v1b" aria-label="候选片段"></nav>'), Pl = /* @__PURE__ */ Te('<video controls="" playsinline="" preload="metadata" class="svelte-ah6v1b"></video>', 2), Ll = /* @__PURE__ */ Te('<!> <div class="scrubber svelte-ah6v1b"><time class="svelte-ah6v1b"> </time> <input aria-label="视频播放进度" type="range" min="0" step="0.01" class="svelte-ah6v1b"/> <time class="svelte-ah6v1b"> </time></div>', 1), Cl = /* @__PURE__ */ Te('<div class="empty svelte-ah6v1b"> </div>'), Ol = /* @__PURE__ */ Te('<p class="summary svelte-ah6v1b"> </p>'), Dl = /* @__PURE__ */ Te('<small class="svelte-ah6v1b"> </small>'), Il = /* @__PURE__ */ Te('<main class="review-workspace svelte-ah6v1b"><header class="svelte-ah6v1b"><div class="svelte-ah6v1b"><h3 class="svelte-ah6v1b">🦅 H3 审片工作台</h3> <!></div> <span class="phase svelte-ah6v1b"> </span></header> <!> <section class="player-card svelte-ah6v1b"><!></section> <!> <section class="form-card svelte-ah6v1b"><label class="prompt svelte-ah6v1b"><span class="svelte-ah6v1b">重试提示词</span> <textarea placeholder="只在重试时覆盖当前镜头提示词" class="svelte-ah6v1b"></textarea></label> <div class="grid svelte-ah6v1b"><label class="svelte-ah6v1b"><span class="svelte-ah6v1b">种子</span><input type="number" class="svelte-ah6v1b"/></label> <label class="svelte-ah6v1b"><span class="svelte-ah6v1b">重试覆盖帧数（0 或 17k+5）</span><input type="number" min="0" max="3592" step="1" class="svelte-ah6v1b"/> <small class="svelte-ah6v1b"> </small> <!></label> <label class="svelte-ah6v1b"><span class="svelte-ah6v1b">下次等待自动通过（分）</span><input type="number" min="0" max="1440" step="0.5" class="svelte-ah6v1b"/> <small class="svelte-ah6v1b">仅对下一次进入审片等待生效</small></label></div> <div class="toggles svelte-ah6v1b"><label class="svelte-ah6v1b"><input type="checkbox" class="svelte-ah6v1b"/> 停止时合成已批准片段</label> <label class="svelte-ah6v1b"><input type="checkbox" class="svelte-ah6v1b"/> 等待时卸载模型</label> <label class="svelte-ah6v1b"><input type="checkbox" class="svelte-ah6v1b"/> 切换候选时自动播放</label></div></section> <footer class="svelte-ah6v1b"><button class="approve svelte-ah6v1b">批准并继续</button> <button class="svelte-ah6v1b">按修改重试</button> <button class="svelte-ah6v1b">换种子</button> <button class="svelte-ah6v1b">从所选场景重做</button> <button class="stop svelte-ah6v1b">批准并停止</button></footer> <div class="status svelte-ah6v1b" aria-live="polite"> </div></main>');
function Fl(e, t) {
  Dn(t, !1);
  const r = /* @__PURE__ */ A(), n = /* @__PURE__ */ A(), i = /* @__PURE__ */ A(), s = /* @__PURE__ */ A(), o = /* @__PURE__ */ A(), a = /* @__PURE__ */ A(), f = /* @__PURE__ */ A(), u = /* @__PURE__ */ A(), p = /* @__PURE__ */ A(), d = /* @__PURE__ */ A(), _ = /* @__PURE__ */ A(), v = /* @__PURE__ */ A(), c = /* @__PURE__ */ A(), w = /* @__PURE__ */ A(), D = /* @__PURE__ */ A(), N = /* @__PURE__ */ A(), E = /* @__PURE__ */ A(), W = /* @__PURE__ */ A();
  let M = gt(t, "initialReview", 24, () => ({})), z = gt(t, "initialWorkspace", 24, () => ({})), q = gt(t, "resolveVideoUrl", 8, (h, k) => k || String(h || "")), Le = gt(t, "onWorkspaceChange", 8, () => {
  }), J = gt(t, "onDecision", 8, async () => {
  }), y = /* @__PURE__ */ A(Vt(M())), m = /* @__PURE__ */ A(cr(Qe(z()), l(y), !0)), _e = /* @__PURE__ */ A(!1), ge = /* @__PURE__ */ A(), Ce = /* @__PURE__ */ A(0), qe = /* @__PURE__ */ A(0), ft = /* @__PURE__ */ A(""), Oe = /* @__PURE__ */ A("");
  function jr(h) {
    const k = Vt(h), x = Ge(l(y)), C = Ge(k);
    g(y, k), !(C && C === x) && ((!C || l(Oe) !== String(l(y).token || "")) && g(Oe, ""), g(ft, ""), g(_e, !1), C ? (g(m, cr(l(m), l(y), !x)), Rt()) : x && (g(m, {
      ...l(m),
      retryRunName: "",
      retryTakeKey: "",
      retryLength: 0
    }), Rt()));
  }
  function Hr(h) {
    g(m, cr(Qe(h), l(y), !0));
  }
  function Kr(h) {
    g(_e, !!h);
  }
  function Wr(h) {
    g(Oe, String(h || ""));
  }
  function Gt() {
    const h = l(ge);
    if (h) {
      try {
        h.pause();
      } catch {
      }
      h.removeAttribute("src");
      try {
        h.load();
      } catch {
      }
      g(ge, void 0);
    }
  }
  El(Gt);
  function Rt() {
    Le()?.(Nl(l(m)));
  }
  function vi(h) {
    g(m, { ...l(m), selectedTakeKey: we(h) }), g(Ce, 0), g(qe, 0), Rt();
  }
  function De(h) {
    g(m, Qe({ ...l(m), ...h })), Rt();
  }
  function hi(h) {
    const k = (
      /** @type {HTMLInputElement} */
      h.currentTarget
    ), x = di(k.value);
    k.value = String(x), De({ retryLength: x });
  }
  function pi() {
    const h = l(ge);
    g(qe, h && Number.isFinite(h.duration) ? h.duration : 0), g(Ce, h && Number.isFinite(h.currentTime) ? h.currentTime : 0), l(m).autoplay && h?.play?.().catch(() => {
    });
  }
  function _i() {
    const h = l(ge);
    g(Ce, h && Number.isFinite(h.currentTime) ? h.currentTime : 0);
  }
  function gi(h) {
    const k = (
      /** @type {HTMLInputElement} */
      h.currentTarget
    ), x = Number(k.value || 0);
    l(ge) && Number.isFinite(x) && Rs(ge, l(ge).currentTime = x), g(Ce, x);
  }
  function Ur(h) {
    const k = Math.max(0, Number(h) || 0), x = Math.floor(k / 60), C = (k - x * 60).toFixed(2).padStart(5, "0");
    return `${String(x).padStart(2, "0")}:${C}`;
  }
  async function ut(h) {
    const k = Ge(l(y));
    if (l(_e) || l(v) || !k) return;
    const x = String(l(y).token || "");
    g(_e, !0), g(ft, "正在提交决策…");
    try {
      const C = await J()?.(h, {
        retry_prompt: l(m).retryPrompt,
        retry_seed: Number(l(m).retrySeed ?? -1),
        retry_length: h === "retry" ? l(m).retryLength : 0,
        resume_scene: h === "resume" ? l(a) : 0,
        assemble_partial_on_stop: !!l(m).assemblePartial,
        auto_continue_timeout_minutes: Number(l(m).timeoutMinutes || 0),
        unload_models_while_waiting: !!l(m).unloadModels,
        token: x,
        run_name: String(l(y).run_name || "")
      });
      if (k !== Ge(l(y))) return;
      const ue = String(C?.lockedToken || x);
      ue && g(Oe, ue), g(ft, {
        approve: "已提交批准",
        approve_stop: "已提交批准并停止",
        retry: "已提交重试",
        reroll: "已提交换种子",
        resume: "已提交从所选场景重做"
      }[h] || "决策已提交");
    } catch (C) {
      k === Ge(l(y)) && g(ft, `提交失败：${C instanceof Error ? C.message : String(C)}`);
    } finally {
      k === Ge(l(y)) && g(_e, !1);
    }
  }
  j(() => l(y), () => {
    g(r, l(y).history || []);
  }), j(() => l(y), () => {
    g(n, Br(l(y)));
  }), j(
    () => (l(r), l(m), l(n)),
    () => {
      g(i, l(r).find((h) => we(h) === l(m).selectedTakeKey) || l(n));
    }
  ), j(() => l(i), () => {
    g(s, we(l(i)));
  }), j(
    () => (l(i), l(n), l(s), we),
    () => {
      g(o, !!(l(i) && l(n) && l(s) !== we(l(n))));
    }
  ), j(() => (l(i), l(y)), () => {
    g(a, l(i) ? Number(l(i).index || 0) + 1 : Number(l(y).current_index || 0) + 1);
  }), j(() => l(i), () => {
    g(f, Number(l(i)?.revision || 1));
  }), j(() => l(y), () => {
    g(u, l(y).preview_clip || l(y).clip_path || "");
  }), j(() => (l(i), l(u)), () => {
    g(p, l(i)?.clip_path || l(u));
  }), j(
    () => (fi(q()), l(p), l(i), l(u), l(y)),
    () => {
      g(d, q()(l(p), l(i)?.preview_url || (l(p) === l(u) ? l(y).preview_url : "")));
    }
  ), j(() => l(y), () => {
    g(_, Fr(l(y)));
  }), j(() => (l(Oe), l(y)), () => {
    g(v, !!(l(Oe) && l(Oe) === String(l(y).token || "")));
  }), j(() => (l(_e), l(v), l(_)), () => {
    g(c, l(_e) || l(v) || l(_) !== "reviewing");
  }), j(() => (l(_), l(y), l(n)), () => {
    g(w, l(_) === "reviewing" ? Number(l(y).length ?? l(n)?.length ?? 0) : 0);
  }), j(() => l(y), () => {
    g(D, Math.max(1, Number(l(y).fps || l(y).output_fps || 24)));
  }), j(() => (l(m), l(D)), () => {
    g(N, l(m).retryLength > 0 ? l(m).retryLength / l(D) : 0);
  }), j(() => (l(y), l(_)), () => {
    g(E, {
      idle: "空闲",
      ready: "片段已就绪",
      reviewing: "等待审片",
      approved: l(y).mode === "auto" || l(y).decision === "auto" ? "自动通过" : "已批准",
      retrying: "正在重试",
      stopped: "已停止",
      error: "发生错误",
      history: "只读回看"
    }[l(_)] || l(_));
  }), j(() => (l(o), l(y), l(_)), () => {
    g(W, {
      idle: "运行工作流以生成候选片段",
      ready: "可回看已生成的片段",
      reviewing: l(o) ? "批准与重试作用于当前待审版本" : "检查视频后选择下一步",
      approved: "可回看已通过的片段",
      retrying: "已提交重做，等待新片段",
      stopped: l(y).decision === "approve_stop" ? "已批准当前片段并停止循环" : "循环已停止",
      error: "审片流程发生错误",
      history: "历史快照"
    }[l(_)]);
  }), Hs();
  var yi = {
    setReview: jr,
    setWorkspace: Hr,
    setBusy: Kr,
    setLockedToken: Wr,
    disposeMedia: Gt
  };
  bl();
  var $t = Il(), Vr = K($t), zr = K(Vr), mi = R(K(zr), 2);
  {
    var bi = (h) => {
      var k = Ml(), x = se(k);
      Ne((C) => le(x, `场景 ${l(a) ?? ""} · r${C ?? ""}${l(o) ? " · 历史版本" : ""}`), [
        () => (l(f), L(() => String(l(f)).padStart(4, "0")))
      ]), me(h, k);
    };
    vt(mi, (h) => {
      (l(i) || l(p)) && h(bi);
    });
  }
  var wi = R(zr, 2), Ei = se(wi, !0), qr = R(Vr, 2);
  {
    var ki = (h) => {
      var k = Al();
      ul(k, 5, () => l(r), (x) => we(x), (x, C) => {
        var ue = Rl();
        let Pt;
        var Ie = K(ue), rr = se(Ie), nr = R(Ie, 2), ct = se(nr);
        Ne(
          (ye, dt, Ii) => {
            Pt = hl(ue, 1, "svelte-ah6v1b", null, Pt, { active: ye }), le(rr, `S${dt ?? ""}`), le(ct, `r${Ii ?? ""}`);
          },
          [
            () => we(l(C)) === l(s),
            () => (l(C), L(() => Number(l(C).index || 0) + 1)),
            () => (l(C), L(() => String(Number(l(C).revision || 1)).padStart(4, "0")))
          ]
        ), U("click", ue, () => vi(l(C))), me(x, ue);
      }), me(h, k);
    };
    vt(qr, (h) => {
      l(r), L(() => l(r).length > 0) && h(ki);
    });
  }
  var Yr = R(qr, 2), Si = K(Yr);
  {
    var Ti = (h) => {
      var k = Ll(), x = Ls(k);
      ol(x, () => l(d), (ct) => {
        var ye = Pl();
        ml(ye, (dt) => g(ge, dt), () => l(ge)), Ne(() => fr(ye, "src", l(d))), U("loadedmetadata", ye, pi), U("timeupdate", ye, _i), me(ct, ye);
      });
      var C = R(x, 2), ue = K(C), Pt = se(ue, !0), Ie = R(ue, 2), rr = R(Ie, 2), nr = se(rr, !0);
      Ne(
        (ct, ye, dt) => {
          le(Pt, ct), fr(Ie, "max", ye), pt(Ie, l(Ce)), le(nr, dt);
        },
        [
          () => (l(Ce), L(() => Ur(l(Ce)))),
          () => (l(qe), L(() => Math.max(0.01, l(qe)))),
          () => (l(qe), L(() => Ur(l(qe))))
        ]
      ), U("input", Ie, gi), me(h, k);
    }, xi = (h) => {
      var k = Cl(), x = se(k, !0);
      Ne(() => le(x, l(_) === "history" ? "暂无历史片段" : "暂无候选片段")), me(h, k);
    };
    vt(Si, (h) => {
      l(d) ? h(Ti) : h(xi, -1);
    });
  }
  var Gr = R(Yr, 2);
  {
    var Ni = (h) => {
      var k = Ol(), x = se(k, !0);
      Ne(() => le(x, (l(y), L(() => l(y).summary)))), me(h, k);
    };
    vt(Gr, (h) => {
      l(y), L(() => l(y).summary) && h(Ni);
    });
  }
  var $r = R(Gr, 2), Jr = K($r), Jt = R(K(Jr), 2), Xr = R(Jr, 2), Zr = K(Xr), Xt = R(K(Zr)), Qr = R(Zr, 2), At = R(K(Qr)), en = R(At, 2), Mi = se(en, !0), Ri = R(en, 2);
  {
    var Ai = (h) => {
      var k = Dl(), x = se(k);
      Ne(() => le(x, `当前待审原始帧数 ${l(w) ?? ""}`)), me(h, k);
    };
    vt(Ri, (h) => {
      l(w) > 0 && h(Ai);
    });
  }
  var Pi = R(Qr, 2), tn = R(K(Pi)), Li = R(Xr, 2), rn = K(Li), nn = K(rn), sn = R(rn, 2), ln = K(sn), Ci = R(sn, 2), an = K(Ci), on = R($r, 2), Zt = K(on), Qt = R(Zt, 2), er = R(Qt, 2), tr = R(er, 2), fn = R(tr, 2), Oi = R(on, 2), Di = se(Oi, !0);
  return Ne(
    (h) => {
      fr($t, "data-phase", l(_)), le(Ei, l(E)), pt(Jt, (l(m), L(() => l(m).retryPrompt))), Jt.disabled = l(c), pt(Xt, (l(m), L(() => l(m).retrySeed))), Xt.disabled = l(c), pt(At, (l(m), L(() => l(m).retryLength))), At.disabled = l(c), le(Mi, h), pt(tn, (l(m), L(() => l(m).timeoutMinutes))), or(nn, (l(m), L(() => l(m).assemblePartial))), or(ln, (l(m), L(() => l(m).unloadModels))), or(an, (l(m), L(() => l(m).autoplay))), Zt.disabled = l(c), Qt.disabled = l(c), er.disabled = l(c), tr.disabled = l(c) || !l(i), fn.disabled = l(c), le(Di, l(ft) || (l(v) ? "本次决策已提交" : l(W)));
    },
    [
      () => (l(m), l(N), l(D), L(() => l(m).retryLength ? `约 ${l(N).toFixed(2)} 秒 @ ${l(D)}fps` : "0 = 沿用当前帧长"))
    ]
  ), U("input", Jt, (h) => De({ retryPrompt: h.currentTarget.value })), U("change", Xt, (h) => De({ retrySeed: Number(h.currentTarget.value) })), U("change", At, hi), U("change", tn, (h) => De({ timeoutMinutes: Number(h.currentTarget.value) })), U("change", nn, (h) => De({ assemblePartial: h.currentTarget.checked })), U("change", ln, (h) => De({ unloadModels: h.currentTarget.checked })), U("change", an, (h) => De({ autoplay: h.currentTarget.checked })), U("click", Zt, () => ut("approve")), U("click", Qt, () => ut("retry")), U("click", er, () => ut("reroll")), U("click", tr, () => ut("resume")), U("click", fn, () => ut("approve_stop")), me(e, $t), _t(t, "setReview", jr), _t(t, "setWorkspace", Hr), _t(t, "setBusy", Kr), _t(t, "setLockedToken", Wr), _t(t, "disposeMedia", Gt), In(yi);
}
function Kl(e, t = {}) {
  if (!(e instanceof Element)) throw new TypeError("A DOM target is required");
  const r = il(Fl, {
    target: e,
    props: {
      initialReview: Vt(t.review),
      initialWorkspace: Qe(t.workspace),
      resolveVideoUrl: t.resolveVideoUrl,
      onWorkspaceChange: t.onWorkspaceChange,
      onDecision: t.onDecision
    }
  });
  return {
    /** @param {unknown} value */
    setReview(n) {
      r.setReview?.(Vt(n));
    },
    /** @param {unknown} value */
    setWorkspace(n) {
      r.setWorkspace?.(Qe(n));
    },
    /** @param {unknown} value */
    setBusy(n) {
      r.setBusy?.(!!n);
    },
    /** @param {unknown} value */
    setLockedToken(n) {
      r.setLockedToken?.(n);
    },
    disposeMedia() {
      r.disposeMedia?.();
    },
    destroy() {
      return ll(r);
    }
  };
}
export {
  Tl as REVIEW_WORKSPACE_SCHEMA_VERSION,
  Hl as assertResolvedDecision,
  jl as isValidRetryLength,
  Kl as mountH3ReviewWorkspace,
  Vt as normalizeReview,
  Qe as normalizeWorkspace,
  Nl as serializeWorkspace,
  di as snapRetryLength
};

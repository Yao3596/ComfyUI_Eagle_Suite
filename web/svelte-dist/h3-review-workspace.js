var dr = Array.isArray, Si = Array.prototype.indexOf, Mt = Array.prototype.includes, Dt = Array.from, hr = Object.defineProperty, Pe = Object.getOwnPropertyDescriptor, pr = Object.getOwnPropertyDescriptors, Ti = Object.prototype, xi = Array.prototype, _n = Object.getPrototypeOf, er = Object.isExtensible;
const Mi = () => {
};
function Ni(e) {
  return e();
}
function rn(e) {
  for (var t = 0; t < e.length; t++)
    e[t]();
}
function _r() {
  var e, t, n = new Promise((r, i) => {
    e = r, t = i;
  });
  return { promise: n, resolve: e, reject: t };
}
const H = 2, Ye = 4, gt = 8, gr = 1 << 24, se = 16, ne = 32, me = 64, sn = 128, gn = 256, ee = 512, D = 1024, F = 2048, te = 4096, K = 8192, Y = 16384, Je = 32768, Nt = 1 << 25, Ge = 65536, At = 1 << 17, Ai = 1 << 18, Ze = 1 << 19, br = 1 << 20, ge = 1 << 25, Ie = 65536, Rt = 1 << 21, Ke = 1 << 22, Se = 1 << 23, Le = /* @__PURE__ */ Symbol("$state"), mr = /* @__PURE__ */ Symbol("component"), Ri = /* @__PURE__ */ Symbol("legacy props"), Pi = /* @__PURE__ */ Symbol(""), yr = /* @__PURE__ */ Symbol("attributes"), ln = /* @__PURE__ */ Symbol("class"), Li = /* @__PURE__ */ Symbol("style"), an = /* @__PURE__ */ Symbol("text"), bt = new class extends Error {
  name = "StaleReactionError";
  message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}(), Oi = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml")
), Ci = 1, Di = 2, Ii = 16, Fi = 1, ji = 2, Bi = 4, Hi = 8, Wi = 16, Ui = 1, Vi = 2, I = /* @__PURE__ */ Symbol("uninitialized"), zi = "http://www.w3.org/1999/xhtml";
function Ki() {
  console.warn("https://svelte.dev/e/derived_inert");
}
function qi() {
  console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
function wr(e) {
  return e === this.v;
}
function Yi(e, t) {
  return e != e ? t == t : e !== t || e !== null && typeof e == "object" || typeof e == "function";
}
function Er(e) {
  return !Yi(e, this.v);
}
function kr(e) {
  throw new Error("https://svelte.dev/e/lifecycle_outside_component");
}
function Gi() {
  throw new Error("https://svelte.dev/e/async_derived_orphan");
}
function Xi(e, t, n) {
  throw new Error("https://svelte.dev/e/each_key_duplicate");
}
function $i(e) {
  throw new Error("https://svelte.dev/e/effect_in_teardown");
}
function Ji() {
  throw new Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function Zi(e) {
  throw new Error("https://svelte.dev/e/effect_orphan");
}
function Qi() {
  throw new Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function es(e) {
  throw new Error("https://svelte.dev/e/props_invalid_value");
}
function ts() {
  throw new Error("https://svelte.dev/e/state_descriptors_fixed");
}
function ns() {
  throw new Error("https://svelte.dev/e/state_prototype_fixed");
}
function rs() {
  throw new Error("https://svelte.dev/e/state_unsafe_mutation");
}
function is() {
  throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
let Qe = !1;
function ss() {
  Qe = !0;
}
let A = null;
function Xe(e) {
  A = e;
}
function Sr(e, t = !1, n) {
  A = {
    p: A,
    i: !1,
    c: null,
    e: null,
    s: e,
    x: null,
    r: (
      /** @type {Effect} */
      y
    ),
    l: Qe && !t ? { s: null, u: null, $: [] } : null
  };
}
function Tr(e) {
  var t = (
    /** @type {ComponentContext} */
    A
  ), n = t.e;
  if (n !== null) {
    t.e = null;
    for (var r of n)
      Wr(r);
  }
  return e !== void 0 && (t.x = e), t.i = !0, A = t.p, bn(e);
}
function bn(e = {}) {
  return hr(e, mr, { value: !0 }), e;
}
function et() {
  return !Qe || A !== null && A.l === null;
}
let Ue = [];
function ls() {
  var e = Ue;
  Ue = [], rn(e);
}
function ke(e) {
  if (Ue.length === 0) {
    var t = Ue;
    queueMicrotask(() => {
      t === Ue && ls();
    });
  }
  Ue.push(e);
}
const as = -7169;
function L(e, t) {
  e.f = e.f & as | t;
}
function mn(e) {
  (e.f & ee) !== 0 || e.deps === null ? L(e, D) : L(e, te);
}
function xr(e) {
  if (e !== null)
    for (const t of e)
      (t.f & H) === 0 || (t.f & Ie) === 0 || (t.f ^= Ie, xr(
        /** @type {Derived} */
        t.deps
      ));
}
function Mr(e, t, n) {
  (e.f & F) !== 0 ? t.add(e) : (e.f & te) !== 0 && n.add(e), xr(e.deps), L(e, D);
}
let Et = !1;
function os(e) {
  var t = Et;
  try {
    return Et = !1, [e(), Et];
  } finally {
    Et = t;
  }
}
function mt(e) {
  var t = k, n = y;
  re(null), ie(null);
  try {
    return e();
  } finally {
    re(t), ie(n);
  }
}
function fs(e, t, n, r) {
  const i = et() ? ht : yn;
  var s = e.filter((h) => !h.settled), o = t.map(i);
  if (n.length === 0 && s.length === 0) {
    r(o);
    return;
  }
  var a = (
    /** @type {Effect} */
    y
  ), f = us(), u = s.length === 1 ? s[0].promise : s.length > 1 ? Promise.all(s.map((h) => h.promise)) : null;
  function d(h) {
    if ((a.f & Y) === 0) {
      f();
      try {
        r([...o, ...h]);
      } catch (v) {
        fe(v, a);
      }
      Pt();
    }
  }
  var c = Nr();
  if (n.length === 0) {
    u.then(() => d([])).finally(c);
    return;
  }
  function _() {
    Promise.all(n.map((h) => /* @__PURE__ */ cs(h))).then(d).catch((h) => fe(h, a)).finally(c);
  }
  u ? u.then(() => {
    f(), _(), Pt();
  }) : _();
}
function us() {
  var e = (
    /** @type {Effect} */
    y
  ), t = k, n = A, r = (
    /** @type {Batch} */
    S
  );
  return function(s = !0) {
    ie(e), re(t), Xe(n), s && (e.f & Y) === 0 && (r?.activate(), r?.apply());
  };
}
function Pt(e = !0) {
  ie(null), re(null), Xe(null), e && S?.deactivate();
}
function Nr() {
  var e = (
    /** @type {Effect} */
    y
  ), t = e.b, n = (
    /** @type {Batch} */
    S
  ), r = !!t?.is_rendered();
  return t?.update_pending_count(1, n), n.increment(r, e), () => {
    t?.update_pending_count(-1, n), n.decrement(r, e);
  };
}
// @__NO_SIDE_EFFECTS__
function ht(e) {
  var t = H | F;
  return y !== null && (y.f |= Ze), {
    ctx: A,
    deps: null,
    effects: null,
    equals: wr,
    f: t,
    fn: e,
    reactions: null,
    rv: 0,
    v: (
      /** @type {V} */
      I
    ),
    wv: 0,
    parent: y,
    ac: null
  };
}
const ut = /* @__PURE__ */ Symbol("obsolete");
// @__NO_SIDE_EFFECTS__
function cs(e, t, n) {
  let r = (
    /** @type {Effect | null} */
    y
  );
  r === null && Gi();
  var i = (
    /** @type {Promise<V>} */
    /** @type {unknown} */
    void 0
  ), s = Fe(
    /** @type {V} */
    I
  ), o = !k, a = /* @__PURE__ */ new Set();
  return Ns(() => {
    var f = (
      /** @type {Effect} */
      y
    ), u = _r();
    i = u.promise;
    try {
      Promise.resolve(e()).then(u.resolve, (h) => {
        h !== bt && u.reject(h);
      }).finally(Pt);
    } catch (h) {
      u.reject(h), Pt();
    }
    var d = (
      /** @type {Batch} */
      S
    );
    if (o) {
      if ((f.f & Je) !== 0)
        var c = Nr();
      if (
        // boundary can be null if the async derived is inside an $effect.root not connected to the component render tree
        r.b?.is_rendered()
      )
        d.async_deriveds.get(f)?.reject(ut);
      else
        for (const h of a.values())
          h.reject(ut);
      a.add(u), d.async_deriveds.set(f, u);
    }
    const _ = (h, v = void 0) => {
      c?.(), a.delete(u), v !== ut && (d.activate(), v ? (s.f |= Se, $e(s, v)) : ((s.f & Se) !== 0 && (s.f ^= Se), $e(s, h)), d.deactivate());
    };
    u.promise.then(_, (h) => _(null, h || "unknown"));
  }), Tn(() => {
    for (const f of a)
      f.reject(ut);
  }), new Promise((f) => {
    function u(d) {
      function c() {
        d === i ? f(s) : u(i);
      }
      d.then(c, c);
    }
    u(i);
  });
}
// @__NO_SIDE_EFFECTS__
function yn(e) {
  const t = /* @__PURE__ */ ht(e);
  return t.equals = Er, t;
}
function vs(e) {
  var t = e.effects;
  if (t !== null) {
    e.effects = null;
    for (var n = 0; n < t.length; n += 1)
      G(
        /** @type {Effect} */
        t[n]
      );
  }
}
function wn(e) {
  var t, n = y, r = e.parent;
  if (!ye && r !== null && e.v !== I && // if it was never evaluated before, it's guaranteed to fail downstream, so we try to execute instead
  (r.f & (Y | K)) !== 0)
    return Ki(), e.v;
  ie(r);
  try {
    e.f &= ~Ie, vs(e), t = Xr(e);
  } finally {
    ie(n);
  }
  return t;
}
function Ar(e) {
  var t = wn(e);
  if (!e.equals(t) && (e.wv = Yr(), (!S?.is_fork || e.deps === null) && (S !== null ? (S.capture(e, t, !0), on?.capture(e, t, !0)) : e.v = t, e.deps === null))) {
    L(e, D);
    return;
  }
  ye || (le !== null ? (Sn() || S?.is_fork) && le.set(e, t) : mn(e));
}
function ds(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      (t.teardown || t.ac) && (t.teardown?.(), t.ac !== null && mt(() => {
        t.ac.abort(bt), t.ac = null;
      }), t.fn !== null && (t.teardown = Mi), _t(t, 0), xn(t));
}
function Rr(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      t.teardown && t.fn !== null && je(t);
}
let Xt = null, He = null, S = null, on = null, le = null, fn = null, $t = !1, Ve = null, Tt = null;
var tr = 0;
let hs = 1;
class Te {
  id = hs++;
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
  #r = /* @__PURE__ */ new Set();
  /**
   * The number of async effects that are currently in flight
   */
  #s = 0;
  /**
   * Async effects that are currently in flight, _not_ inside a pending boundary
   * @type {Map<Effect, number>}
   */
  #n = /* @__PURE__ */ new Map();
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
  #v = /* @__PURE__ */ new Map();
  /**
   * Inverse of #skipped_branches which we need to tell prior batches to unskip them when committing
   * @type {Set<Effect>}
   */
  #_ = /* @__PURE__ */ new Set();
  is_fork = !1;
  #c = !1;
  constructor() {
    He === null ? Xt = He = this : (He.#e = this, this.#l = He), He = this;
  }
  #m() {
    if (this.is_fork) return !0;
    for (const r of this.#n.keys()) {
      for (var t = r, n = !1; t.parent !== null; ) {
        if (this.#v.has(t)) {
          n = !0;
          break;
        }
        t = t.parent;
      }
      if (!n)
        return !0;
    }
    return !1;
  }
  /**
   * Add an effect to the #skipped_branches map and reset its children
   * @param {Effect} effect
   */
  skip_effect(t) {
    this.#v.has(t) || this.#v.set(t, { d: [], m: [] }), this.#_.delete(t);
  }
  /**
   * Remove an effect from the #skipped_branches map and reschedule
   * any tracked dirty/maybe_dirty child effects
   * @param {Effect} effect
   * @param {(e: Effect) => void} callback
   */
  unskip_effect(t, n = (r) => this.schedule(r)) {
    var r = this.#v.get(t);
    if (r) {
      this.#v.delete(t);
      for (var i of r.d)
        L(i, F), n(i);
      for (i of r.m)
        L(i, te), n(i);
    }
    this.#_.add(t);
  }
  #g() {
    this.#t = !0, tr++ > 1e3 && (this.#h(), ps());
    for (const f of this.#f)
      this.#u.delete(f), L(f, F), this.schedule(f);
    for (const f of this.#u)
      L(f, te), this.schedule(f);
    const t = this.#i;
    this.#i = [], this.apply();
    var n = Ve = [], r = [], i = Tt = [];
    for (const f of t)
      try {
        this.#w(f, n, r);
      } catch (u) {
        throw Or(f), this.#m() || this.discard(), u;
      }
    if (S = null, i.length > 0) {
      var s = Te.ensure();
      for (const f of i)
        s.schedule(f);
    }
    if (Ve = null, Tt = null, this.#m()) {
      this.#d(r), this.#d(n);
      for (const [f, u] of this.#v)
        Lr(f, u);
      i.length > 0 && /** @type {unknown} */
      S.#g();
      return;
    }
    const o = this.#y();
    if (o) {
      this.#d(r), this.#d(n), o.#E(this);
      return;
    }
    this.#f.clear(), this.#u.clear();
    for (const f of this.#o) f(this);
    this.#o.clear(), on = this, nr(r), nr(n), on = null, this.#a?.resolve();
    var a = (
      /** @type {Batch | null} */
      /** @type {unknown} */
      S
    );
    if (this.#s === 0 && (this.#i.length === 0 || a !== null) && this.#h(), this.#i.length > 0)
      if (a !== null) {
        const f = a;
        f.#i.push(...this.#i.filter((u) => !f.#i.includes(u)));
      } else
        a = this;
    a !== null && (ue.clear(), a.#g());
  }
  /**
   * Traverse the effect tree, executing effects or stashing
   * them for later execution as appropriate
   * @param {Effect} root
   * @param {Effect[]} effects
   * @param {Effect[]} render_effects
   */
  #w(t, n, r) {
    t.f ^= D;
    for (var i = t.first; i !== null; ) {
      var s = i.f, o = (s & (ne | me)) !== 0, a = o && (s & D) !== 0, f = a || (s & K) !== 0 || this.#v.has(i);
      if (!f && i.fn !== null) {
        o ? i.f ^= D : (s & Ye) !== 0 ? n.push(i) : tt(i) && ((s & se) !== 0 && this.#u.add(i), je(i));
        var u = i.first;
        if (u !== null) {
          i = u;
          continue;
        }
      }
      for (; i !== null; ) {
        var d = i.next;
        if (d !== null) {
          i = d;
          break;
        }
        i = i.parent;
      }
    }
  }
  #y() {
    for (var t = this.#l; t !== null; ) {
      if (!t.is_fork) {
        for (const [n, [, r]] of this.current)
          if (t.current.has(n) && !r)
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
    for (const [r, i] of t.current)
      !this.previous.has(r) && t.previous.has(r) && this.previous.set(r, t.previous.get(r)), this.current.set(r, i);
    for (const [r, i] of t.async_deriveds) {
      const s = this.async_deriveds.get(r);
      s && i.promise.then(s.resolve).catch(s.reject);
    }
    t.async_deriveds.clear(), this.transfer_effects(t.#f, t.#u);
    const n = (r) => {
      var i = r.reactions;
      if (i !== null && !((r.f & H) !== 0 && (r.f & (F | te)) === 0))
        for (const a of i) {
          var s = a.f;
          if ((s & H) !== 0)
            n(
              /** @type {Derived} */
              a
            );
          else {
            var o = (
              /** @type {Effect} */
              a
            );
            s & (Ke | se) && !this.async_deriveds.has(o) && (this.#u.delete(o), L(o, F), this.schedule(o));
          }
        }
    };
    for (const r of this.current.keys())
      n(r);
    this.oncommit(() => t.discard()), t.#h(), S = this, this.#g();
  }
  /**
   * @param {Effect[]} effects
   */
  #d(t) {
    for (var n = 0; n < t.length; n += 1)
      Mr(t[n], this.#f, this.#u);
  }
  /**
   * Associate a change to a given source with the current
   * batch, noting its previous and current values
   * @param {Value} source
   * @param {any} value
   * @param {boolean} [is_derived]
   */
  capture(t, n, r = !1) {
    t.v !== I && !this.previous.has(t) && this.previous.set(t, t.v), (t.f & Se) === 0 && (this.current.set(t, [n, r]), le?.set(t, n)), this.is_fork || (t.v = n);
  }
  activate() {
    S = this;
  }
  deactivate() {
    S = null, le = null;
  }
  flush() {
    try {
      $t = !0, S = this, this.#g();
    } finally {
      tr = 0, fn = null, Ve = null, Tt = null, $t = !1, S = null, le = null, ue.clear();
    }
  }
  discard() {
    for (const t of this.#r) t(this);
    this.#r.clear();
    for (const t of this.async_deriveds.values())
      t.reject(ut);
    this.#h(), this.#a?.resolve();
  }
  /**
   * @param {Effect} effect
   */
  register_created_effect(t) {
    this.#p.push(t);
  }
  #b() {
    for (let c = Xt; c !== null; c = c.#e) {
      var t = c.id < this.id, n = [];
      for (const [_, [h, v]] of this.current) {
        if (c.current.has(_)) {
          var r = (
            /** @type {[any, boolean]} */
            c.current.get(_)[0]
          );
          if (t && h !== r)
            c.current.set(_, [h, v]);
          else
            continue;
        }
        n.push(_);
      }
      if (t)
        for (const [_, h] of this.async_deriveds) {
          const v = c.async_deriveds.get(_);
          v && h.promise.then(v.resolve).catch(v.reject);
        }
      var i = [...c.current.keys()].filter(
        (_) => !/** @type {[any, boolean]} */
        c.current.get(_)[1]
      );
      if (!(!c.#t || i.length === 0)) {
        var s = i.filter((_) => !this.current.has(_));
        if (s.length === 0)
          t && c.discard();
        else if (n.length > 0) {
          if (t)
            for (const _ of this.#_)
              c.unskip_effect(_, (h) => {
                (h.f & (se | Ke)) !== 0 ? c.schedule(h) : c.#d([h]);
              });
          c.activate();
          var o = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Map();
          for (var f of n)
            Pr(f, s, o, a);
          a = /* @__PURE__ */ new Map();
          var u = [...c.current].filter(([_, h]) => {
            const v = this.current.get(_);
            return v ? v[0] !== h[0] || v[1] !== h[1] : !0;
          }).map(([_]) => _);
          if (u.length > 0)
            for (const _ of this.#p)
              (_.f & (Y | K | At)) === 0 && En(_, u, a) && ((_.f & (Ke | se)) !== 0 ? (L(_, F), c.schedule(_)) : c.#f.add(_));
          if (c.#i.length > 0 && !c.#c) {
            c.apply();
            for (var d of c.#i)
              c.#w(d, [], []);
            c.#i = [];
          }
          c.deactivate();
        }
      }
    }
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  increment(t, n) {
    if (this.#s += 1, t) {
      let r = this.#n.get(n) ?? 0;
      this.#n.set(n, r + 1);
    }
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  decrement(t, n) {
    if (this.#s -= 1, t) {
      let r = this.#n.get(n) ?? 0;
      r === 1 ? this.#n.delete(n) : this.#n.set(n, r - 1);
    }
    this.#c || (this.#c = !0, ke(() => {
      this.#c = !1, this.linked && this.flush();
    }));
  }
  /**
   * @param {Set<Effect>} dirty_effects
   * @param {Set<Effect>} maybe_dirty_effects
   */
  transfer_effects(t, n) {
    for (const r of t)
      this.#f.add(r);
    for (const r of n)
      this.#u.add(r);
    t.clear(), n.clear();
  }
  /** @param {(batch: Batch) => void} fn */
  oncommit(t) {
    this.#o.add(t);
  }
  /** @param {(batch: Batch) => void} fn */
  ondiscard(t) {
    this.#r.add(t);
  }
  settled() {
    return (this.#a ??= _r()).promise;
  }
  static ensure() {
    if (S === null) {
      const t = S = new Te();
      $t || ke(() => {
        t.#t || t.flush();
      });
    }
    return S;
  }
  apply() {
    {
      le = null;
      return;
    }
  }
  /**
   *
   * @param {Effect} effect
   */
  schedule(t) {
    if (fn = t, t.b?.is_pending && (t.f & (Ye | gt | gr)) !== 0 && (t.f & Je) === 0) {
      t.b.defer_effect(t);
      return;
    }
    for (var n = t; n.parent !== null; ) {
      n = n.parent;
      var r = n.f;
      if (Ve !== null && n === y && (k === null || (k.f & H) === 0))
        return;
      if ((r & (me | ne)) !== 0) {
        if ((r & D) === 0)
          return;
        n.f ^= D;
      }
    }
    this.#i.push(n);
  }
  #h() {
    if (this.linked) {
      var t = this.#l, n = this.#e;
      t === null ? Xt = n : t.#e = n, n === null ? He = t : n.#l = t, this.linked = !1;
    }
  }
}
function ps() {
  try {
    Qi();
  } catch (e) {
    fe(e, fn);
  }
}
let _e = null;
function nr(e) {
  var t = e.length;
  if (t !== 0) {
    for (var n = 0; n < t; ) {
      var r = e[n++];
      if ((r.f & (Y | K)) === 0 && tt(r) && (_e = /* @__PURE__ */ new Set(), je(r), r.deps === null && r.first === null && r.nodes === null && r.teardown === null && r.ac === null && Vr(r), _e?.size > 0)) {
        ue.clear();
        for (const i of _e) {
          if ((i.f & (Y | K)) !== 0) continue;
          const s = [i];
          let o = i.parent;
          for (; o !== null; )
            _e.has(o) && (_e.delete(o), s.push(o)), o = o.parent;
          for (let a = s.length - 1; a >= 0; a--) {
            const f = s[a];
            (f.f & (Y | K)) === 0 && je(f);
          }
        }
        _e.clear();
      }
    }
    _e = null;
  }
}
function Pr(e, t, n, r) {
  if (!n.has(e) && (n.add(e), e.reactions !== null))
    for (const i of e.reactions) {
      const s = i.f;
      (s & H) !== 0 ? Pr(
        /** @type {Derived} */
        i,
        t,
        n,
        r
      ) : (s & (Ke | se)) !== 0 && (s & F) === 0 && En(i, t, r) && (L(i, F), kn(
        /** @type {Effect} */
        i
      ));
    }
}
function En(e, t, n) {
  const r = n.get(e);
  if (r !== void 0) return r;
  if (e.deps !== null)
    for (const i of e.deps) {
      if (Mt.call(t, i))
        return !0;
      if ((i.f & H) !== 0 && En(
        /** @type {Derived} */
        i,
        t,
        n
      ))
        return n.set(
          /** @type {Derived} */
          i,
          !0
        ), !0;
    }
  return n.set(e, !1), !1;
}
function kn(e) {
  S.schedule(e);
}
function Lr(e, t) {
  if (!((e.f & ne) !== 0 && (e.f & D) !== 0)) {
    (e.f & F) !== 0 ? t.d.push(e) : (e.f & te) !== 0 && t.m.push(e), L(e, D);
    for (var n = e.first; n !== null; )
      Lr(n, t), n = n.next;
  }
}
function Or(e) {
  L(e, D);
  for (var t = e.first; t !== null; )
    Or(t), t = t.next;
}
let Lt = /* @__PURE__ */ new Set();
const ue = /* @__PURE__ */ new Map();
let Cr = !1;
function Fe(e, t) {
  var n = {
    f: 0,
    // TODO ideally we could skip this altogether, but it causes type errors
    v: e,
    reactions: null,
    equals: wr,
    rv: 0,
    wv: 0
  };
  return n;
}
// @__NO_SIDE_EFFECTS__
function we(e, t) {
  const n = Fe(e);
  return Ps(n), n;
}
// @__NO_SIDE_EFFECTS__
function C(e, t = !1, n = !0) {
  const r = Fe(e);
  return t || (r.equals = Er), Qe && n && A !== null && A.l !== null && (A.l.s ??= []).push(r), r;
}
function _s(e, t) {
  return m(
    e,
    x(() => l(e))
  ), t;
}
function m(e, t, n = !1) {
  k !== null && // since we are untracking the function inside `$inspect.with` we need to add this check
  // to ensure we error if state is set inside an inspect effect
  (!ae || (k.f & At) !== 0) && et() && (k.f & (H | se | Ke | At)) !== 0 && (ce === null || !ce.has(e)) && rs();
  let r = n ? ze(t) : t;
  return $e(e, r, Tt);
}
function $e(e, t, n = null) {
  if (!e.equals(t)) {
    ye ? ue.set(e, t) : ue.has(e) || ue.set(e, e.v);
    var r = Te.ensure();
    if (r.capture(e, t), (e.f & H) !== 0) {
      const i = (
        /** @type {Derived} */
        e
      );
      (e.f & F) !== 0 && wn(i), le === null && mn(i);
    }
    e.wv = Yr(), Dr(e, F, n), et() && y !== null && (y.f & D) !== 0 && (y.f & (ne | me)) === 0 && (Z === null ? Ls([e]) : Z.push(e)), !r.is_fork && Lt.size > 0 && !Cr && gs();
  }
  return t;
}
function gs() {
  Cr = !1;
  for (const e of Lt) {
    (e.f & D) !== 0 && L(e, te);
    let t;
    try {
      t = tt(e);
    } catch {
      t = !0;
    }
    t && je(e);
  }
  Lt.clear();
}
function vt(e) {
  m(e, e.v + 1);
}
function Dr(e, t, n) {
  var r = e.reactions;
  if (r !== null)
    for (var i = et(), s = r.length, o = 0; o < s; o++) {
      var a = r[o], f = a.f;
      if (!(!i && a === y)) {
        var u = (f & F) === 0;
        if (u && L(a, t), (f & At) !== 0)
          Lt.add(
            /** @type {Effect} */
            a
          );
        else if ((f & H) !== 0) {
          var d = (
            /** @type {Derived} */
            a
          );
          le?.delete(d), (f & Ie) === 0 && (f & ee && (y === null || (y.f & Rt) === 0) && (a.f |= Ie), Dr(d, te, n));
        } else if (u) {
          var c = (
            /** @type {Effect} */
            a
          );
          (f & se) !== 0 && _e !== null && _e.add(c), n !== null ? n.push(c) : kn(c);
        }
      }
    }
}
function ze(e) {
  if (typeof e != "object" || e === null || Le in e || mr in e)
    return e;
  const t = _n(e);
  if (t !== Ti && t !== xi)
    return e;
  var n = /* @__PURE__ */ new Map(), r = dr(e), i = /* @__PURE__ */ we(0), s = De, o = (a) => {
    if (De === s)
      return a();
    var f = k, u = De;
    re(null), sr(s);
    var d = a();
    return re(f), sr(u), d;
  };
  return r && n.set("length", /* @__PURE__ */ we(
    /** @type {any[]} */
    e.length
  )), new Proxy(
    /** @type {any} */
    e,
    {
      defineProperty(a, f, u) {
        (!("value" in u) || u.configurable === !1 || u.enumerable === !1 || u.writable === !1) && ts();
        var d = n.get(f);
        return d === void 0 ? o(() => {
          var c = /* @__PURE__ */ we(u.value);
          return n.set(f, c), c;
        }) : m(d, u.value, !0), !0;
      },
      deleteProperty(a, f) {
        var u = n.get(f);
        if (u === void 0) {
          if (f in a) {
            const d = o(() => /* @__PURE__ */ we(I));
            n.set(f, d), vt(i);
          }
        } else
          m(u, I), vt(i);
        return !0;
      },
      get(a, f, u) {
        if (f === Le)
          return e;
        var d = n.get(f), c = f in a;
        if (d === void 0 && (!c || Pe(a, f)?.writable) && (d = o(() => {
          var h = ze(c ? a[f] : I), v = /* @__PURE__ */ we(h);
          return v;
        }), n.set(f, d)), d !== void 0) {
          var _ = l(d);
          return _ === I ? void 0 : _;
        }
        return Reflect.get(a, f, u);
      },
      getOwnPropertyDescriptor(a, f) {
        var u = Reflect.getOwnPropertyDescriptor(a, f);
        if (u && "value" in u) {
          var d = n.get(f);
          d && (u.value = l(d));
        } else if (u === void 0) {
          var c = n.get(f), _ = c?.v;
          if (c !== void 0 && _ !== I)
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
        if (f === Le)
          return !0;
        var u = n.get(f), d = u !== void 0 && u.v !== I || Reflect.has(a, f);
        if (u !== void 0 || y !== null && (!d || Pe(a, f)?.writable)) {
          u === void 0 && (u = o(() => {
            var _ = d ? ze(a[f]) : I, h = /* @__PURE__ */ we(_);
            return h;
          }), n.set(f, u));
          var c = l(u);
          if (c === I)
            return !1;
        }
        return d;
      },
      set(a, f, u, d) {
        var c = n.get(f), _ = f in a;
        if (r && f === "length")
          for (var h = u; h < /** @type {Source<number>} */
          c.v; h += 1) {
            var v = n.get(h + "");
            v !== void 0 ? m(v, I) : h in a && (v = o(() => /* @__PURE__ */ we(I)), n.set(h + "", v));
          }
        if (c === void 0)
          (!_ || Pe(a, f)?.writable) && (c = o(() => /* @__PURE__ */ we(void 0)), m(c, ze(u)), n.set(f, c));
        else {
          _ = c.v !== I;
          var E = o(() => ze(u));
          m(c, E);
        }
        var j = Reflect.getOwnPropertyDescriptor(a, f);
        if (j?.set && j.set.call(d, u), !_) {
          if (r && typeof f == "string") {
            var R = (
              /** @type {Source<number>} */
              n.get("length")
            ), w = Number(f);
            Number.isInteger(w) && w >= R.v && m(R, w + 1);
          }
          vt(i);
        }
        return !0;
      },
      ownKeys(a) {
        l(i);
        var f = Reflect.ownKeys(a).filter((c) => {
          var _ = n.get(c);
          return _ === void 0 || _.v !== I;
        });
        for (var [u, d] of n)
          d.v !== I && !(u in a) && f.push(u);
        return f;
      },
      setPrototypeOf() {
        ns();
      }
    }
  );
}
var rr, Ir, Fr, jr;
function bs() {
  if (rr === void 0) {
    rr = window, Ir = /Firefox/.test(navigator.userAgent);
    var e = Element.prototype, t = Node.prototype, n = Text.prototype;
    Fr = Pe(t, "firstChild").get, jr = Pe(t, "nextSibling").get, er(e) && (e[ln] = void 0, e[yr] = null, e[Li] = void 0, e.__e = void 0), er(n) && (n[an] = void 0);
  }
}
function Oe(e = "") {
  return document.createTextNode(e);
}
// @__NO_SIDE_EFFECTS__
function pt(e) {
  return (
    /** @type {TemplateNode | null} */
    Fr.call(e)
  );
}
// @__NO_SIDE_EFFECTS__
function yt(e) {
  return (
    /** @type {TemplateNode | null} */
    jr.call(e)
  );
}
function W(e, t) {
  return /* @__PURE__ */ pt(e);
}
function ms(e, t = !1) {
  {
    var n = /* @__PURE__ */ pt(e);
    return n instanceof Comment && n.data === "" ? /* @__PURE__ */ yt(n) : n;
  }
}
function he(e, t = !1) {
  return /* @__PURE__ */ pt(e);
}
function N(e, t = 1, n = !1) {
  let r = e;
  for (; t--; )
    r = /** @type {TemplateNode} */
    /* @__PURE__ */ yt(r);
  return r;
}
function ys(e) {
  e.textContent = "";
}
function Br() {
  return !1;
}
function ws(e, t, n) {
  return (
    /** @type {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element} */
    n ? document.createElement(e, { is: n }) : document.createElement(e)
  );
}
function Es(e) {
  var t = y;
  if (t === null)
    return k.f |= Se, e;
  if ((t.f & Je) === 0 && (t.f & Ye) === 0)
    throw e;
  fe(e, t);
}
function fe(e, t) {
  if (!(t !== null && (t.f & Y) !== 0)) {
    for (; t !== null; ) {
      if ((t.f & sn) !== 0 && (t.f & (Y | Nt)) === 0) {
        if ((t.f & Je) === 0)
          throw e;
        try {
          t.b.error(e);
          return;
        } catch (n) {
          e = n;
        }
      }
      t = t.parent;
    }
    throw e;
  }
}
function Hr(e) {
  y === null && (k === null && Zi(), Ji()), ye && $i();
}
function ks(e, t) {
  var n = t.last;
  n === null ? t.last = t.first = e : (n.next = e, e.prev = n, t.last = e);
}
function ve(e, t) {
  var n = y;
  n !== null && (n.f & K) !== 0 && (e |= K);
  var r = {
    ctx: A,
    deps: null,
    nodes: null,
    f: e | F | ee,
    first: null,
    fn: t,
    last: null,
    next: null,
    parent: n,
    b: n && n.b,
    prev: null,
    teardown: null,
    wv: 0,
    ac: null
  };
  S?.register_created_effect(r);
  var i = r;
  if ((e & Ye) !== 0)
    Ve !== null ? Ve.push(r) : Te.ensure().schedule(r);
  else if (t !== null) {
    try {
      je(r);
    } catch (o) {
      throw G(r), o;
    }
    i.deps === null && i.teardown === null && i.nodes === null && i.first === i.last && // either `null`, or a singular child
    (i.f & Ze) === 0 && (i = i.first, (e & se) !== 0 && (e & Ge) !== 0 && i !== null && (i.f |= Ge));
  }
  if (i !== null && (i.parent = n, n !== null && ks(i, n), k !== null && (k.f & H) !== 0 && (e & me) === 0)) {
    var s = (
      /** @type {Derived} */
      k
    );
    (s.effects ??= []).push(i);
  }
  return r;
}
function Sn() {
  return k !== null && !ae;
}
function Tn(e) {
  const t = ve(gt, null);
  return L(t, D), t.teardown = e, t;
}
function un(e) {
  Hr();
  var t = (
    /** @type {Effect} */
    y.f
  ), n = !k && (t & ne) !== 0 && A !== null && !A.i;
  if (n) {
    var r = (
      /** @type {ComponentContext} */
      A
    );
    (r.e ??= []).push(e);
  } else
    return Wr(e);
}
function Wr(e) {
  return ve(Ye | br, e);
}
function Ss(e) {
  return Hr(), ve(gt | br, e);
}
function Ts(e) {
  Te.ensure();
  const t = ve(me | Ze, e);
  return (n = {}) => new Promise((r) => {
    n.outro ? Ce(t, () => {
      G(t), r(void 0);
    }) : (G(t), r(void 0));
  });
}
function xs(e) {
  return ve(Ye, e);
}
function J(e, t) {
  var n = (
    /** @type {ComponentContextLegacy} */
    A
  ), r = { effect: null, ran: !1, deps: e };
  n.l.$.push(r), r.effect = It(() => {
    if (e(), !r.ran) {
      r.ran = !0;
      var i = (
        /** @type {Effect} */
        y
      );
      try {
        ie(i.parent), x(t);
      } finally {
        ie(i);
      }
    }
  });
}
function Ms() {
  var e = (
    /** @type {ComponentContextLegacy} */
    A
  );
  It(() => {
    for (var t of e.l.$) {
      t.deps();
      var n = t.effect;
      (n.f & D) !== 0 && n.deps !== null && L(n, te), tt(n) && je(n), t.ran = !1;
    }
  });
}
function Ns(e) {
  return ve(Ke | Ze, e);
}
function It(e, t = 0) {
  return ve(gt | t, e);
}
function st(e, t = [], n = [], r = []) {
  fs(r, t, n, (i) => {
    ve(gt, () => {
      e(...i.map(l));
    });
  });
}
function Ft(e, t = 0) {
  var n = ve(se | t, e);
  return n;
}
function Q(e) {
  return ve(ne | Ze, e);
}
function Ur(e) {
  var t = e.teardown;
  if (t !== null) {
    const n = ye, r = k;
    ir(!0), re(null);
    try {
      t.call(null);
    } catch (i) {
      fe(i, e.parent);
    } finally {
      ir(n), re(r);
    }
  }
}
function xn(e, t = !1) {
  var n = e.first;
  for (e.first = e.last = null; n !== null; ) {
    const i = n.ac;
    i !== null && mt(() => {
      i.abort(bt);
    });
    var r = n.next;
    (n.f & me) !== 0 ? n.parent = null : G(n, t), n = r;
  }
}
function As(e) {
  for (var t = e.first; t !== null; ) {
    var n = t.next;
    (t.f & ne) === 0 && G(t), t = n;
  }
}
function G(e, t = !0) {
  var n = !1;
  (t || (e.f & Ai) !== 0) && e.nodes !== null && e.nodes.end !== null && (Rs(
    e.nodes.start,
    /** @type {TemplateNode} */
    e.nodes.end
  ), n = !0), e.f |= Nt, xn(e, t && !n), _t(e, 0);
  var r = e.nodes && e.nodes.t;
  if (r !== null)
    for (const s of r)
      s.stop();
  Ur(e), e.f ^= Nt, e.f |= Y;
  var i = e.parent;
  i !== null && i.first !== null && Vr(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function Rs(e, t) {
  for (; e !== null; ) {
    var n = e === t ? null : /* @__PURE__ */ yt(e);
    e.remove(), e = n;
  }
}
function Vr(e) {
  var t = e.parent, n = e.prev, r = e.next;
  n !== null && (n.next = r), r !== null && (r.prev = n), t !== null && (t.first === e && (t.first = r), t.last === e && (t.last = n));
}
function Ce(e, t, n = !0) {
  var r = [];
  e.f |= gn, zr(e, r, !0);
  var i = () => {
    n && G(e), t && t();
  }, s = r.length;
  if (s > 0) {
    var o = () => --s || i();
    for (var a of r)
      a.out(o);
  } else
    i();
}
function zr(e, t, n) {
  if ((e.f & K) === 0) {
    e.f ^= K;
    var r = e.nodes && e.nodes.t;
    if (r !== null)
      for (const a of r)
        (a.is_global || n) && t.push(a);
    for (var i = e.first; i !== null; ) {
      var s = i.next;
      if ((i.f & me) === 0) {
        var o = (i.f & Ge) !== 0 || // If this is a branch effect without a block effect parent,
        // it means the parent block effect was pruned. In that case,
        // transparency information was transferred to the branch effect.
        (i.f & ne) !== 0 && (e.f & se) !== 0;
        zr(i, t, o ? n : !1);
      }
      i = s;
    }
  }
}
function Ot(e) {
  e.f &= ~gn, Kr(e, !0);
}
function Kr(e, t) {
  if ((e.f & gn) === 0 && (e.f & K) !== 0) {
    e.f ^= K, (e.f & D) === 0 && (L(e, F), Te.ensure().schedule(e));
    for (var n = e.first; n !== null; ) {
      var r = n.next, i = (n.f & Ge) !== 0 || (n.f & ne) !== 0;
      Kr(n, i ? t : !1), n = r;
    }
    var s = e.nodes && e.nodes.t;
    if (s !== null)
      for (const o of s)
        (o.is_global || t) && o.in();
  }
}
function Mn(e, t) {
  if (e.nodes)
    for (var n = e.nodes.start, r = e.nodes.end; n !== null; ) {
      var i = n === r ? null : /* @__PURE__ */ yt(n);
      t.append(n), n = i;
    }
}
let xt = !1, ye = !1;
function ir(e) {
  ye = e;
}
let k = null, ae = !1;
function re(e) {
  k = e;
}
let y = null;
function ie(e) {
  y = e;
}
let ce = null;
function Ps(e) {
  k !== null && (ce ??= /* @__PURE__ */ new Set()).add(e);
}
let q = null, $ = 0, Z = null;
function Ls(e) {
  Z = e;
}
let qr = 1, Re = 0, De = Re;
function sr(e) {
  De = e;
}
function Yr() {
  return ++qr;
}
function tt(e) {
  var t = e.f;
  if ((t & F) !== 0)
    return !0;
  if (t & H && (e.f &= ~Ie), (t & te) !== 0) {
    for (var n = (
      /** @type {Value[]} */
      e.deps
    ), r = n.length, i = 0; i < r; i++) {
      var s = n[i];
      if (tt(
        /** @type {Derived} */
        s
      ) && Ar(
        /** @type {Derived} */
        s
      ), s.wv > e.wv)
        return !0;
    }
    (t & ee) !== 0 && // During time traveling we don't want to reset the status so that
    // traversal of the graph in the other batches still happens
    le === null && L(e, D);
  }
  return !1;
}
function Gr(e, t, n = !0) {
  var r = e.reactions;
  if (r !== null && !(ce !== null && ce.has(e)))
    for (var i = 0; i < r.length; i++) {
      var s = r[i];
      (s.f & H) !== 0 ? Gr(
        /** @type {Derived} */
        s,
        t,
        !1
      ) : t === s && (n ? L(s, F) : (s.f & D) !== 0 && L(s, te), kn(
        /** @type {Effect} */
        s
      ));
    }
}
function Xr(e) {
  var t = q, n = $, r = Z, i = k, s = ce, o = A, a = ae, f = De, u = e.f;
  q = /** @type {null | Value[]} */
  null, $ = 0, Z = null, k = (u & (ne | me)) === 0 ? e : null, ce = null, Xe(e.ctx), ae = !1, De = ++Re, e.ac !== null && (mt(() => {
    e.ac.abort(bt);
  }), e.ac = null);
  try {
    e.f |= Rt;
    var d = (
      /** @type {Function} */
      e.fn
    ), c = d();
    e.f |= Je;
    var _ = lr(e);
    if (et() && Z !== null && !ae && _ !== null && (e.f & (H | te | F)) === 0)
      for (var h = 0; h < /** @type {Source[]} */
      Z.length; h++)
        Gr(
          Z[h],
          /** @type {Effect} */
          e
        );
    if (i !== null && i !== e) {
      if (Re++, i.deps !== null)
        for (let v = 0; v < n; v += 1)
          i.deps[v].rv = Re;
      if (t !== null)
        for (const v of t)
          v.rv = Re;
      Z !== null && (r === null ? r = Z : r.push(.../** @type {Source[]} */
      Z));
    }
    return (e.f & Se) !== 0 && (e.f ^= Se), c;
  } catch (v) {
    return lr(e), Es(v);
  } finally {
    e.f ^= Rt, q = t, $ = n, Z = r, k = i, ce = s, Xe(o), ae = a, De = f;
  }
}
function lr(e) {
  var t = e.deps, n = S?.is_fork;
  if (q !== null) {
    var r;
    if (n || _t(e, $), t !== null && $ > 0)
      for (t.length = $ + q.length, r = 0; r < q.length; r++)
        t[$ + r] = q[r];
    else
      e.deps = t = q;
    if (Sn() && (e.f & ee) !== 0)
      for (r = $; r < t.length; r++)
        (t[r].reactions ??= []).push(e);
  } else !n && t !== null && $ < t.length && (_t(e, $), t.length = $);
  return t;
}
function Os(e, t) {
  let n = t.reactions;
  if (n !== null) {
    var r = Si.call(n, e);
    if (r !== -1) {
      var i = n.length - 1;
      i === 0 ? n = t.reactions = null : (n[r] = n[i], n.pop());
    }
  }
  if (n === null && (t.f & H) !== 0 && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (q === null || !Mt.call(q, t))) {
    var s = (
      /** @type {Derived} */
      t
    );
    (s.f & ee) !== 0 && (s.f ^= ee, s.f &= ~Ie), s.v !== I && mn(s), s.ac !== null && mt(() => {
      s.ac.abort(bt), s.ac = null, L(s, F);
    }), ds(s), _t(s, 0);
  }
}
function _t(e, t) {
  var n = e.deps;
  if (n !== null)
    for (var r = t; r < n.length; r++)
      Os(e, n[r]);
}
function je(e) {
  var t = e.f;
  if ((t & Y) === 0) {
    L(e, D);
    var n = y, r = xt;
    y = e, xt = (t & (ne | me)) === 0;
    try {
      (t & (se | gr)) !== 0 ? As(e) : xn(e), Ur(e);
      var i = Xr(e);
      e.teardown = typeof i == "function" ? i : null, e.wv = qr;
      var s;
    } finally {
      xt = r, y = n;
    }
  }
}
function l(e) {
  var t = e.f, n = (t & H) !== 0;
  if (k !== null && !ae) {
    var r = y !== null && (y.f & Y) !== 0;
    if (!r && (ce === null || !ce.has(e))) {
      var i = k.deps;
      if ((k.f & Rt) !== 0)
        e.rv < Re && (e.rv = Re, q === null && i !== null && i[$] === e ? $++ : q === null ? q = [e] : q.push(e));
      else {
        k.deps ??= [], Mt.call(k.deps, e) || k.deps.push(e);
        var s = e.reactions;
        s === null ? e.reactions = [k] : Mt.call(s, k) || s.push(k);
      }
    }
  }
  if (ye && ue.has(e))
    return ue.get(e);
  if (n) {
    var o = (
      /** @type {Derived} */
      e
    );
    if (ye) {
      var a = o.v;
      return ((o.f & D) === 0 && o.reactions !== null || Jr(o)) && (a = wn(o)), ue.set(o, a), a;
    }
    var f = (o.f & ee) === 0 && !ae && k !== null && (xt || (k.f & ee) !== 0), u = (o.f & Je) === 0;
    tt(o) && (f && (o.f |= ee), Ar(o)), f && !u && (Rr(o), $r(o));
  }
  if (le?.has(e))
    return le.get(e);
  if ((e.f & Se) !== 0)
    throw e.v;
  return e.v;
}
function $r(e) {
  if (e.f |= ee, e.deps !== null)
    for (const t of e.deps)
      (t.reactions ??= []).push(e), (t.f & H) !== 0 && (t.f & ee) === 0 && (Rr(
        /** @type {Derived} */
        t
      ), $r(
        /** @type {Derived} */
        t
      ));
}
function Jr(e) {
  if (e.v === I) return !0;
  if (e.deps === null) return !1;
  for (const t of e.deps)
    if (ue.has(t) || (t.f & H) !== 0 && Jr(
      /** @type {Derived} */
      t
    ))
      return !0;
  return !1;
}
function x(e) {
  var t = ae;
  try {
    return ae = !0, e();
  } finally {
    ae = t;
  }
}
function Zr(e) {
  if (!(typeof e != "object" || !e || e instanceof EventTarget)) {
    if (Le in e)
      cn(e);
    else if (!Array.isArray(e))
      for (let t in e) {
        const n = e[t];
        typeof n == "object" && n && Le in n && cn(n);
      }
  }
}
function cn(e, t = /* @__PURE__ */ new Set()) {
  if (typeof e == "object" && e !== null && // We don't want to traverse DOM elements
  !(e instanceof EventTarget) && !t.has(e)) {
    t.add(e), e instanceof Date && e.getTime();
    for (let r in e)
      try {
        cn(e[r], t);
      } catch {
      }
    const n = _n(e);
    if (n !== Object.prototype && n !== Array.prototype && n !== Map.prototype && n !== Set.prototype && n !== Date.prototype) {
      const r = pr(n);
      for (let i in r) {
        const s = r[i].get;
        if (s)
          try {
            s.call(e);
          } catch {
          }
      }
    }
  }
}
const Cs = ["touchstart", "touchmove"];
function Ds(e) {
  return Cs.includes(e);
}
const kt = /* @__PURE__ */ Symbol("events"), Is = /* @__PURE__ */ new Set(), ar = /* @__PURE__ */ new Set();
function Fs(e, t, n, r = {}) {
  function i(s) {
    if (r.capture || vn.call(t, s), !s.cancelBubble)
      return mt(() => n?.call(this, s));
  }
  return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? ke(() => {
    t.addEventListener(e, i, r);
  }) : t.addEventListener(e, i, r), i;
}
function V(e, t, n, r, i) {
  var s = { capture: r, passive: i }, o = Fs(e, t, n, s);
  (t === document.body || // @ts-ignore
  t === window || // @ts-ignore
  t === document || // Firefox has quirky behavior, it can happen that we still get "canplay" events when the element is already removed
  t instanceof HTMLMediaElement) && Tn(() => {
    t.removeEventListener(e, o, s);
  });
}
let Jt = null, Zt = !1;
function vn(e) {
  var t = this, n = (
    /** @type {Node} */
    t.ownerDocument
  ), r = e.type, i = e.composedPath?.() || [], s = (
    /** @type {null | Element} */
    i[0] || e.target
  );
  Jt = e, Zt || (Zt = !0, setTimeout(() => {
    Zt = !1, Jt = null;
  }));
  var o = 0, a = Jt === e && e[kt];
  if (a) {
    var f = i.indexOf(a);
    if (f !== -1 && (t === document || t === /** @type {any} */
    window)) {
      e[kt] = t;
      return;
    }
    var u = i.indexOf(t);
    if (u === -1)
      return;
    f <= u && (o = f);
  }
  if (s = /** @type {Element} */
  i[o] || e.target, s !== t) {
    hr(e, "currentTarget", {
      configurable: !0,
      get() {
        return s || n;
      }
    });
    var d = k, c = y;
    re(null), ie(null);
    try {
      for (var _, h = []; s !== null && s !== t; ) {
        try {
          var v = s[kt]?.[r];
          v != null && (!/** @type {any} */
          s.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
          // -> the target could not have been disabled because it emits the event in the first place
          e.target === s) && v.call(s, e);
        } catch (E) {
          _ ? h.push(E) : _ = E;
        }
        if (e.cancelBubble) break;
        o++, s = o < i.length ? (
          /** @type {Element} */
          i[o]
        ) : null;
      }
      if (_) {
        for (let E of h)
          queueMicrotask(() => {
            throw E;
          });
        throw _;
      }
    } finally {
      e[kt] = t, delete e.currentTarget, re(d), ie(c);
    }
  }
}
const js = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
    /** @param {string} html */
    createHTML: (e) => e
  })
);
function Bs(e) {
  return (
    /** @type {string} */
    js?.createHTML(e) ?? e
  );
}
function Hs(e) {
  var t = ws("template");
  return t.innerHTML = Bs(e.replaceAll("<!>", "<!---->")), t.content;
}
function or(e, t) {
  var n = (
    /** @type {Effect} */
    y
  );
  n.nodes === null && (n.nodes = { start: e, end: t, a: null, t: null });
}
// @__NO_SIDE_EFFECTS__
function Be(e, t) {
  var n = (t & Ui) !== 0, r = (t & Vi) !== 0, i, s = !e.startsWith("<!>");
  return () => {
    i === void 0 && (i = Hs(s ? e : "<!>" + e), n || (i = /** @type {TemplateNode} */
    /* @__PURE__ */ pt(i)));
    var o = (
      /** @type {TemplateNode} */
      r || Ir ? document.importNode(i, !0) : i.cloneNode(!0)
    );
    if (n) {
      var a = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ pt(o)
      ), f = (
        /** @type {TemplateNode} */
        o.lastChild
      );
      or(a, f);
    } else
      or(o, o);
    return o;
  };
}
function Ae(e, t) {
  e !== null && e.before(
    /** @type {Node} */
    t
  );
}
function Ws(e) {
  let t = 0, n = Fe(0), r;
  return () => {
    Sn() && (l(n), It(() => (t === 0 && (r = x(() => e(() => vt(n)))), t += 1, () => {
      ke(() => {
        t -= 1, t === 0 && (r?.(), r = void 0, vt(n));
      });
    })));
  };
}
var Us = Ge | Ze;
function Vs(e, t, n, r) {
  new zs(e, t, n, r);
}
class zs {
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
  #r;
  /** @type {Effect | null} */
  #s = null;
  /** @type {Effect | null} */
  #n = null;
  /** @type {Effect | null} */
  #a = null;
  /** @type {DocumentFragment | null} */
  #i = null;
  #p = 0;
  #f = 0;
  #u = !1;
  /** @type {Set<Effect>} */
  #v = /* @__PURE__ */ new Set();
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
  #m = Ws(() => (this.#c = Fe(this.#p), () => {
    this.#c = null;
  }));
  /**
   * @param {TemplateNode} node
   * @param {BoundaryProps} props
   * @param {((anchor: Node) => void)} children
   * @param {((error: unknown) => unknown) | undefined} [transform_error]
   */
  constructor(t, n, r, i) {
    this.#t = t, this.#e = n, this.#o = (s) => {
      var o = (
        /** @type {Effect} */
        y
      );
      o.b = this, o.f |= sn, r(s);
    }, this.parent = /** @type {Effect} */
    y.b, this.transform_error = i ?? this.parent?.transform_error ?? ((s) => s), this.#r = Ft(() => {
      this.#d();
    }, Us);
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
    const n = this.#e.failed, { reset: r, invoke_onerror: i } = this.#y(t);
    ke(i), n && (this.#a = Q(() => {
      n(
        this.#t,
        () => t,
        () => r
      );
    }));
  }
  /**
   * Creates the `reset` function for a failed boundary, along with a function
   * that invokes `onerror` with it (if provided)
   * @param {unknown} error
   * @returns {{ reset: () => void, invoke_onerror: () => void }}
   */
  #y(t) {
    var n = !1, r = !1;
    const i = () => {
      if (n) {
        qi();
        return;
      }
      n = !0, r && is(), this.#a !== null && Ce(this.#a, () => {
        this.#a = null;
      }), this.#h(() => {
        this.#d();
      });
    };
    return { reset: i, invoke_onerror: () => {
      try {
        r = !0, this.#e.onerror?.(t, i), r = !1;
      } catch (o) {
        fe(o, this.#r && this.#r.parent);
      }
    } };
  }
  #E() {
    const t = this.#e.pending;
    t && (this.is_pending = !0, this.#n = Q(() => t(this.#t)), ke(() => {
      var n = this.#i = document.createDocumentFragment(), r = Oe(), i = !1;
      if (n.append(r), this.#s = this.#h(() => {
        try {
          return Q(() => this.#o(r));
        } catch (s) {
          try {
            this.error(s), i = !0;
          } catch (o) {
            fe(o, this.#r.parent);
          }
          return null;
        }
      }), this.#s === null) {
        this.#i = null, i && this.#b(
          /** @type {Batch} */
          S
        );
        return;
      }
      this.#f === 0 && (this.#t.before(n), this.#i = null, Ce(
        /** @type {Effect} */
        this.#n,
        () => {
          this.#n = null;
        }
      ), this.#b(
        /** @type {Batch} */
        S
      ));
    }));
  }
  #d() {
    try {
      if (this.is_pending = this.has_pending_snippet(), this.#f = 0, this.#p = 0, this.#s = Q(() => {
        this.#o(this.#t);
      }), this.#f > 0) {
        var t = this.#i = document.createDocumentFragment();
        Mn(this.#s, t);
        const n = (
          /** @type {(anchor: Node) => void} */
          this.#e.pending
        );
        this.#n = Q(() => n(this.#t));
      } else
        this.#b(
          /** @type {Batch} */
          S
        );
    } catch (n) {
      this.error(n);
    }
  }
  /**
   * @param {Batch} batch
   */
  #b(t) {
    this.is_pending = !1, t.transfer_effects(this.#v, this.#_);
  }
  /**
   * Defer an effect inside a pending boundary until the boundary resolves
   * @param {Effect} effect
   */
  defer_effect(t) {
    Mr(t, this.#v, this.#_);
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
    var n = y, r = k, i = A;
    ie(this.#r), re(this.#r), Xe(this.#r.ctx);
    try {
      return Te.ensure(), t();
    } finally {
      ie(n), re(r), Xe(i);
    }
  }
  /**
   * Updates the pending count associated with the currently visible pending snippet,
   * if any, such that we can replace the snippet with content once work is done
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  #k(t, n) {
    if (!this.has_pending_snippet()) {
      this.parent && this.parent.#k(t, n);
      return;
    }
    this.#f += t, this.#f === 0 && (this.#b(n), this.#n && Ce(this.#n, () => {
      this.#n = null;
    }), this.#i && (this.#t.before(this.#i), this.#i = null));
  }
  /**
   * Update the source that powers `$effect.pending()` inside this boundary,
   * and controls when the current `pending` snippet (if any) is removed.
   * Do not call from inside the class
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  update_pending_count(t, n) {
    this.#k(t, n), this.#p += t, !(!this.#c || this.#u) && (this.#u = !0, ke(() => {
      this.#u = !1, this.#c && $e(this.#c, this.#p);
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
    S?.is_fork ? (this.#s && S.skip_effect(this.#s), this.#n && S.skip_effect(this.#n), this.#a && S.skip_effect(this.#a), S.oncommit(() => {
      this.#S(t);
    })) : this.#S(t);
  }
  /**
   * @param {unknown} error
   */
  #S(t) {
    this.#s && (G(this.#s), this.#s = null), this.#n && (G(this.#n), this.#n = null), this.#a && (G(this.#a), this.#a = null);
    let n = this.#e.failed;
    const r = (i) => {
      const { reset: s, invoke_onerror: o } = this.#y(i);
      o(), n && (this.#a = this.#h(() => {
        try {
          return Q(() => {
            var a = (
              /** @type {Effect} */
              y
            );
            a.b = this, a.f |= sn, n(
              this.#t,
              () => i,
              () => s
            );
          });
        } catch (a) {
          return fe(
            a,
            /** @type {Effect} */
            this.#r.parent
          ), null;
        }
      }));
    };
    ke(() => {
      var i;
      try {
        i = this.transform_error(t);
      } catch (s) {
        fe(s, this.#r && this.#r.parent);
        return;
      }
      i !== null && typeof i == "object" && typeof /** @type {any} */
      i.then == "function" ? i.then(
        r,
        /** @param {unknown} e */
        (s) => fe(s, this.#r && this.#r.parent)
      ) : r(i);
    });
  }
}
function pe(e, t) {
  var n = t == null ? "" : typeof t == "object" ? `${t}` : t;
  n !== /** @type {any} */
  (e[an] ??= e.nodeValue) && (e[an] = n, e.nodeValue = `${n}`);
}
function Ks(e, t) {
  return qs(e, t);
}
const St = /* @__PURE__ */ new Map();
function qs(e, { target: t, anchor: n, props: r = {}, events: i, context: s, intro: o = !0, transformError: a }) {
  bs();
  var f = void 0, u = Ts(() => {
    var d = n ?? t.appendChild(Oe());
    Vs(
      /** @type {TemplateNode} */
      d,
      {
        pending: () => {
        }
      },
      (h) => {
        Sr({});
        var v = (
          /** @type {ComponentContext} */
          A
        );
        s && (v.c = s), i && (r.$$events = i), f = e(h, r) || bn(), Tr();
      },
      a
    );
    var c = /* @__PURE__ */ new Set(), _ = (h) => {
      for (var v = 0; v < h.length; v++) {
        var E = h[v];
        if (!c.has(E)) {
          c.add(E);
          var j = Ds(E);
          for (const b of [t, document]) {
            var R = St.get(b);
            R === void 0 && (R = /* @__PURE__ */ new Map(), St.set(b, R));
            var w = R.get(E);
            w === void 0 ? (b.addEventListener(E, vn, { passive: j }), R.set(E, 1)) : R.set(E, w + 1);
          }
        }
      }
    };
    return _(Dt(Is)), ar.add(_), () => {
      for (var h of c)
        for (const j of [t, document]) {
          var v = (
            /** @type {Map<string, number>} */
            St.get(j)
          ), E = (
            /** @type {number} */
            v.get(h)
          );
          --E == 0 ? (j.removeEventListener(h, vn), v.delete(h), v.size === 0 && St.delete(j)) : v.set(h, E);
        }
      ar.delete(_), d !== n && d.parentNode?.removeChild(d);
    };
  });
  return dn.set(f, u), f;
}
let dn = /* @__PURE__ */ new WeakMap();
function Ys(e, t) {
  const n = dn.get(e);
  return n ? (dn.delete(e), n(t)) : Promise.resolve();
}
class Qr {
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
  #r = !0;
  /**
   * @param {TemplateNode} anchor
   * @param {boolean} transition
   */
  constructor(t, n = !0) {
    this.anchor = t, this.#r = n;
  }
  /**
   * @param {Batch} batch
   */
  #s = (t) => {
    if (this.#t.has(t)) {
      var n = (
        /** @type {Key} */
        this.#t.get(t)
      ), r = this.#l.get(n);
      if (r)
        Ot(r), this.#o.delete(n);
      else {
        var i = this.#e.get(n);
        i && (Ot(i.effect), this.#l.set(n, i.effect), this.#e.delete(n), i.fragment.lastChild.remove(), this.anchor.before(i.fragment), r = i.effect);
      }
      for (const [s, o] of this.#t) {
        if (this.#t.delete(s), s === t)
          break;
        const a = this.#e.get(o);
        a && (G(a.effect), this.#e.delete(o));
      }
      for (const [s, o] of this.#l) {
        if (s === n || this.#o.has(s)) continue;
        const a = () => {
          if (Array.from(this.#t.values()).includes(s)) {
            var u = document.createDocumentFragment();
            Mn(o, u), u.append(Oe()), this.#e.set(s, { effect: o, fragment: u });
          } else
            G(o);
          this.#o.delete(s), this.#l.delete(s);
        };
        this.#r || !r ? (this.#o.add(s), Ce(o, a, !1)) : a();
      }
    }
  };
  /**
   * @param {Batch} batch
   */
  #n = (t) => {
    this.#t.delete(t);
    const n = Array.from(this.#t.values());
    for (const [r, i] of this.#e)
      n.includes(r) || (G(i.effect), this.#e.delete(r));
  };
  /**
   *
   * @param {any} key
   * @param {null | ((target: TemplateNode) => void)} fn
   */
  ensure(t, n) {
    var r = (
      /** @type {Batch} */
      S
    ), i = Br();
    if (n && !this.#l.has(t) && !this.#e.has(t))
      if (i) {
        var s = document.createDocumentFragment(), o = Oe();
        s.append(o), this.#e.set(t, {
          effect: Q(() => n(o)),
          fragment: s
        });
      } else
        this.#l.set(
          t,
          Q(() => n(this.anchor))
        );
    if (this.#t.set(r, t), i) {
      for (const [a, f] of this.#l)
        a === t ? r.unskip_effect(f) : r.skip_effect(f);
      for (const [a, f] of this.#e)
        a === t ? r.unskip_effect(f.effect) : r.skip_effect(f.effect);
      r.oncommit(this.#s), r.ondiscard(this.#n);
    } else
      this.#s(r);
  }
}
function Qt(e, t, n = !1) {
  var r = new Qr(e), i = n ? Ge : 0;
  function s(o, a) {
    r.ensure(o, a);
  }
  Ft(() => {
    var o = !1;
    t((a, f = 0) => {
      o = !0, s(f, a);
    }), o || s(-1, null);
  }, i);
}
const Gs = /* @__PURE__ */ Symbol("NaN");
function Xs(e, t, n) {
  var r = new Qr(e), i = !et();
  Ft(() => {
    var s = t();
    s !== s && (s = /** @type {any} */
    Gs), i && s !== null && typeof s == "object" && (s = /** @type {V} */
    {}), r.ensure(s, n);
  });
}
function $s(e, t, n) {
  for (var r = [], i = t.length, s, o = t.length, a = 0; a < i; a++) {
    let c = t[a];
    Ce(
      c,
      () => {
        if (s) {
          if (s.pending.delete(c), s.done.add(c), s.pending.size === 0) {
            var _ = (
              /** @type {Set<EachOutroGroup>} */
              e.outrogroups
            );
            hn(e, Dt(s.done)), _.delete(s), _.size === 0 && (e.outrogroups = null);
          }
        } else
          o -= 1;
      },
      !1
    );
  }
  if (o === 0) {
    var f = r.length === 0 && n !== null && e.pending.size === 0;
    if (f) {
      var u = (
        /** @type {Element} */
        n
      ), d = (
        /** @type {Element} */
        u.parentNode
      );
      ys(d), d.append(u), e.items.clear();
    }
    hn(e, t, !f);
  } else
    s = {
      pending: new Set(t),
      done: /* @__PURE__ */ new Set()
    }, (e.outrogroups ??= /* @__PURE__ */ new Set()).add(s);
}
function hn(e, t, n = !0) {
  var r;
  if (e.pending.size > 0) {
    r = /* @__PURE__ */ new Set();
    for (const o of e.pending.values())
      for (const a of o)
        r.add(
          /** @type {EachItem} */
          e.items.get(a).e
        );
  }
  for (var i = 0; i < t.length; i++) {
    var s = t[i];
    if (r?.has(s)) {
      s.f |= ge;
      const o = document.createDocumentFragment();
      Mn(s, o);
    } else
      G(t[i], n);
  }
}
var fr;
function Js(e, t, n, r, i, s = null) {
  var o = e, a = /* @__PURE__ */ new Map();
  {
    var f = (
      /** @type {Element} */
      e
    );
    o = f.appendChild(Oe());
  }
  var u = null, d = /* @__PURE__ */ yn(() => {
    var w = n();
    return (
      /** @type {V[]} */
      dr(w) ? w : w == null ? [] : Dt(w)
    );
  }), c, _ = /* @__PURE__ */ new Map(), h = !0;
  function v(w) {
    (R.effect.f & Y) === 0 && (R.pending.delete(w), R.fallback = u, Zs(R, c, o, t, r), u !== null && (c.length === 0 ? (u.f & ge) === 0 ? Ot(u) : (u.f ^= ge, ct(u, null, o)) : Ce(u, () => {
      u = null;
    })));
  }
  function E(w) {
    R.pending.delete(w);
  }
  var j = Ft(() => {
    c = /** @type {V[]} */
    l(d);
    for (var w = c.length, b = /* @__PURE__ */ new Set(), g = (
      /** @type {Batch} */
      S
    ), M = Br(), O = 0; O < w; O += 1) {
      var X = c[O], B = r(X, O), U = h ? null : a.get(B);
      U ? (U.v && $e(U.v, X), U.i && $e(U.i, O), M && g.unskip_effect(U.e)) : (U = Qs(
        a,
        h ? o : fr ??= Oe(),
        X,
        B,
        O,
        i,
        t,
        n
      ), h || (U.e.f |= ge), a.set(B, U)), b.add(B);
    }
    if (w === 0 && s && !u && (h ? u = Q(() => s(o)) : (u = Q(() => s(fr ??= Oe())), u.f |= ge)), w > b.size && Xi(), !h)
      if (_.set(g, b), M) {
        for (const [oe, jt] of a)
          b.has(oe) || g.skip_effect(jt.e);
        g.oncommit(v), g.ondiscard(E);
      } else
        v(g);
    l(d);
  }), R = { effect: j, items: a, pending: _, outrogroups: null, fallback: u };
  h = !1;
}
function lt(e) {
  for (; e !== null && (e.f & ne) === 0; )
    e = e.next;
  return e;
}
function Zs(e, t, n, r, i) {
  var s = t.length, o = e.items, a = lt(e.effect.first), f, u = null, d = [], c = [], _, h, v, E;
  for (E = 0; E < s; E += 1) {
    if (_ = t[E], h = i(_, E), v = /** @type {EachItem} */
    o.get(h).e, e.outrogroups !== null)
      for (const B of e.outrogroups)
        B.pending.delete(v), B.done.delete(v);
    if ((v.f & K) !== 0 && Ot(v), (v.f & ge) !== 0)
      if (v.f ^= ge, v === a)
        ct(v, null, n);
      else {
        var j = u ? u.next : a;
        v === e.effect.last && (e.effect.last = v.prev), v.prev && (v.prev.next = v.next), v.next && (v.next.prev = v.prev), Ee(e, u, v), Ee(e, v, j), ct(v, j, n), u = v, d = [], c = [], a = lt(u.next);
        continue;
      }
    if (v !== a) {
      if (f !== void 0 && f.has(v)) {
        if (d.length < c.length) {
          var R = c[0], w;
          u = R.prev;
          var b = d[0], g = d[d.length - 1];
          for (w = 0; w < d.length; w += 1)
            ct(d[w], R, n);
          for (w = 0; w < c.length; w += 1)
            f.delete(c[w]);
          Ee(e, b.prev, g.next), Ee(e, u, b), Ee(e, g, R), a = R, u = g, E -= 1, d = [], c = [];
        } else
          f.delete(v), ct(v, a, n), Ee(e, v.prev, v.next), Ee(e, v, u === null ? e.effect.first : u.next), Ee(e, u, v), u = v;
        continue;
      }
      for (d = [], c = []; a !== null && a !== v; )
        (f ??= /* @__PURE__ */ new Set()).add(a), c.push(a), a = lt(a.next);
      if (a === null)
        continue;
    }
    (v.f & ge) === 0 && d.push(v), u = v, a = lt(v.next);
  }
  if (e.outrogroups !== null) {
    for (const B of e.outrogroups)
      B.pending.size === 0 && (hn(e, Dt(B.done)), e.outrogroups?.delete(B));
    e.outrogroups.size === 0 && (e.outrogroups = null);
  }
  if (a !== null || f !== void 0) {
    var M = [];
    if (f !== void 0)
      for (v of f)
        (v.f & K) === 0 && M.push(v);
    for (; a !== null; )
      (a.f & K) === 0 && a !== e.fallback && M.push(a), a = lt(a.next);
    var O = M.length;
    if (O > 0) {
      var X = s === 0 ? n : null;
      $s(e, M, X);
    }
  }
}
function Qs(e, t, n, r, i, s, o, a) {
  var f = (o & Ci) !== 0 ? (o & Ii) === 0 ? /* @__PURE__ */ C(n, !1, !1) : Fe(n) : null, u = (o & Di) !== 0 ? Fe(i) : null;
  return {
    v: f,
    i: u,
    e: Q(() => (s(t, f ?? n, u ?? i, a), () => {
      e.delete(r);
    }))
  };
}
function ct(e, t, n) {
  if (e.nodes)
    for (var r = e.nodes.start, i = e.nodes.end, s = t && (t.f & ge) === 0 ? (
      /** @type {EffectNodes} */
      t.nodes.start
    ) : n; r !== null; ) {
      var o = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ yt(r)
      );
      if (s.before(r), r === i)
        return;
      r = o;
    }
}
function Ee(e, t, n) {
  t === null ? e.effect.first = n : t.next = n, n === null ? e.effect.last = t : n.prev = t;
}
const ur = [...` 	
\r\f \v\uFEFF`];
function el(e, t, n) {
  var r = "" + e;
  if (n) {
    for (var i of Object.keys(n))
      if (n[i])
        r = r ? r + " " + i : i;
      else if (r.length)
        for (var s = i.length, o = 0; (o = r.indexOf(i, o)) >= 0; ) {
          var a = o + s;
          (o === 0 || ur.includes(r[o - 1])) && (a === r.length || ur.includes(r[a])) ? r = (o === 0 ? "" : r.substring(0, o)) + r.substring(a + 1) : o = a;
        }
  }
  return r === "" ? null : r;
}
function tl(e, t, n, r, i, s) {
  var o = (
    /** @type {any} */
    e[ln]
  );
  if (o !== n || o === void 0) {
    var a = el(n, r, s);
    a == null ? e.removeAttribute("class") : e.className = a, e[ln] = n;
  } else if (s && i !== s)
    for (var f in s) {
      var u = !!s[f];
      (i == null || u !== !!i[f]) && e.classList.toggle(f, u);
    }
  return s;
}
const nl = /* @__PURE__ */ Symbol("is custom element"), rl = /* @__PURE__ */ Symbol("is html"), il = Oi ? "progress" : "PROGRESS";
function at(e, t) {
  var n = Nn(e);
  n.value === (n.value = // treat null and undefined the same for the initial value
  t ?? void 0) || // @ts-expect-error
  // `progress` elements always need their value set when it's `0`
  e.value === t && (t !== 0 || e.nodeName !== il) || (e.value = t ?? "");
}
function en(e, t) {
  var n = Nn(e);
  n.checked !== (n.checked = // treat null and undefined the same for the initial value
  t ?? void 0) && (e.checked = t);
}
function tn(e, t, n, r) {
  var i = Nn(e);
  i[t] !== (i[t] = n) && (t === "loading" && (e[Pi] = n), n == null ? e.removeAttribute(t) : typeof n != "string" && sl(e).has(t) ? e[t] = n : e.setAttribute(t, n));
}
function Nn(e) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    /** @type {any} */
    e[yr] ??= {
      [nl]: e.nodeName.includes("-"),
      [rl]: e.namespaceURI === zi
    }
  );
}
var cr = /* @__PURE__ */ new Map();
function sl(e) {
  var t = e.getAttribute("is") || e.nodeName, n = cr.get(t);
  if (n) return n;
  cr.set(t, n = /* @__PURE__ */ new Set());
  for (var r, i = e, s = Element.prototype; s !== i; ) {
    r = pr(i);
    for (var o in r)
      r[o].set && // better safe than sorry, we don't want spread attributes to mess with HTML content
      o !== "innerHTML" && o !== "textContent" && o !== "innerText" && n.add(o);
    i = _n(i);
  }
  return n;
}
function ot(e, t, n) {
  var r = Pe(e, t);
  r && r.set && (e[t] = n, Tn(() => {
    e[t] = null;
  }));
}
function nn(e, t) {
  return e === t || e?.[Le] === t;
}
function ll(e = bn(), t, n, r) {
  var i = (
    /** @type {ComponentContext} */
    A.r
  ), s = (
    /** @type {Effect} */
    y
  );
  return xs(() => {
    var o, a;
    return It(() => {
      o = a, a = [], x(() => {
        nn(n(...a), e) || (t(e, ...a), o && nn(n(...o), e) && t(null, ...o));
      });
    }), () => {
      let f = s;
      for (; f !== i && f.parent !== null && f.parent.f & Nt; )
        f = f.parent;
      const u = () => {
        a && nn(n(...a), e) && t(null, ...a);
      }, d = f.teardown;
      f.teardown = () => {
        u(), d?.();
      };
    };
  }), e;
}
function al(e = !1) {
  const t = (
    /** @type {ComponentContextLegacy} */
    A
  ), n = t.l.u;
  if (!n) return;
  let r = () => Zr(t.s);
  if (e) {
    let i = 0, s = (
      /** @type {Record<string, any>} */
      {}
    );
    const o = /* @__PURE__ */ ht(() => {
      let a = !1;
      const f = t.s;
      for (const u in f)
        f[u] !== s[u] && (s[u] = f[u], a = !0);
      return a && i++, i;
    });
    r = () => l(o);
  }
  n.b.length && Ss(() => {
    vr(t, r), rn(n.b);
  }), un(() => {
    const i = x(() => n.m.map(Ni));
    return () => {
      for (const s of i)
        typeof s == "function" && s();
    };
  }), n.a.length && un(() => {
    vr(t, r), rn(n.a);
  });
}
function vr(e, t) {
  if (e.l.s)
    for (const n of e.l.s) l(n);
  t();
}
function ft(e, t, n, r) {
  var i = !Qe || (n & ji) !== 0, s = (n & Hi) !== 0, o = (n & Wi) !== 0, a = (
    /** @type {V} */
    r
  ), f = !0, u = (
    /** @type {Derived<V> | undefined} */
    void 0
  ), d = () => o && i ? (u ??= /* @__PURE__ */ ht(
    /** @type {() => V} */
    r
  ), l(u)) : (f && (f = !1, a = o ? x(
    /** @type {() => V} */
    r
  ) : (
    /** @type {V} */
    r
  )), a);
  let c;
  if (s) {
    var _ = Le in e || Ri in e;
    c = Pe(e, t)?.set ?? (_ && t in e ? (g) => e[t] = g : void 0);
  }
  var h, v = !1;
  s ? [h, v] = os(() => (
    /** @type {V} */
    e[t]
  )) : h = /** @type {V} */
  e[t], h === void 0 && r !== void 0 && (h = d(), c && (i && es(), c(h)));
  var E;
  if (i ? E = () => {
    var g = (
      /** @type {V} */
      e[t]
    );
    return g === void 0 ? d() : (f = !0, g);
  } : E = () => {
    var g = (
      /** @type {V} */
      e[t]
    );
    return g !== void 0 && (a = /** @type {V} */
    void 0), g === void 0 ? a : g;
  }, i && (n & Bi) === 0)
    return E;
  if (c) {
    var j = e.$$legacy;
    return (
      /** @type {() => V} */
      (function(g, M) {
        return arguments.length > 0 ? ((!i || !M || j || v) && c(M ? E() : g), g) : E();
      })
    );
  }
  var R = !1, w = ((n & Fi) !== 0 ? ht : yn)(() => (R = !1, E()));
  s && l(w);
  var b = (
    /** @type {Effect} */
    y
  );
  return (
    /** @type {() => V} */
    (function(g, M) {
      if (arguments.length > 0) {
        const O = M ? l(w) : i && s ? ze(g) : g;
        return m(w, O), R = !0, a !== void 0 && (a = O), g;
      }
      return ye && R || (b.f & Y) !== 0 ? w.v : l(w);
    })
  );
}
function ol(e) {
  A === null && kr(), Qe && A.l !== null ? ul(A).m.push(e) : un(() => {
    const t = x(e);
    if (typeof t == "function") return (
      /** @type {() => void} */
      t
    );
  });
}
function fl(e) {
  A === null && kr(), ol(() => () => x(e));
}
function ul(e) {
  var t = (
    /** @type {ComponentContextLegacy} */
    e.l
  );
  return t.u ??= { a: [], b: [], m: [] };
}
const cl = "5";
typeof window < "u" && ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add(cl);
ss();
const vl = 2, dt = 5, pn = 17, ei = 3592;
function be(e, t = 0) {
  const n = Number(e);
  return Number.isFinite(n) ? n : t;
}
function dl(e) {
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
function ti(e) {
  const t = Math.trunc(be(e, 0));
  if (t <= 0) return 0;
  const n = Math.min(ei, Math.max(dt, t));
  return dt + pn * Math.round((n - dt) / pn);
}
function xl(e) {
  const t = Number(e);
  return Number.isInteger(t) && (t === 0 || t >= dt && t <= ei && (t - dt) % pn === 0);
}
function hl(e) {
  const t = String(e || "").trim();
  if (!t) return "";
  const n = t.match(/^s?(\d+):r?(\d+)/i);
  return n ? `${Number(n[1])}:${Number(n[2])}` : "";
}
function Ml(e) {
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
function qe(e) {
  const t = dl(e), n = t.retry && typeof t.retry == "object" ? t.retry : t, r = t.options && typeof t.options == "object" ? t.options : t;
  return {
    version: vl,
    selectedTakeKey: hl(t.selectedTakeKey || t.selected_take_key || ""),
    retryPrompt: String(n.prompt ?? n.retryPrompt ?? ""),
    retrySeed: Math.trunc(be(n.seed ?? n.retrySeed, -1)),
    retryLength: ti(n.length ?? n.retryLength),
    assemblePartial: !!(r.assemblePartial ?? r.assemble_partial ?? !0),
    timeoutMinutes: Math.max(0, be(r.timeoutMinutes ?? r.timeout_minutes, 0)),
    unloadModels: !!(r.unloadModels ?? r.unload_models ?? !1),
    autoplay: !!(r.autoplay ?? !1)
  };
}
function pl(e) {
  const t = qe(e);
  return JSON.stringify({
    version: t.version,
    selectedTakeKey: t.selectedTakeKey,
    retry: {
      prompt: t.retryPrompt,
      seed: t.retrySeed,
      length: t.retryLength
    },
    options: {
      assemblePartial: t.assemblePartial,
      timeoutMinutes: t.timeoutMinutes,
      unloadModels: t.unloadModels,
      autoplay: t.autoplay
    }
  });
}
function We(e) {
  return !e || typeof e != "object" ? "" : `${Math.trunc(be(e.index, 0))}:${Math.trunc(be(e.revision, 1))}`;
}
function Ct(e) {
  const t = e && typeof e == "object" ? (
    /** @type {Record<string, any>} */
    e
  ) : {}, n = Array.isArray(t.history) ? t.history.filter((r) => r && typeof r == "object").map((r) => ({ ...r })) : [];
  return !n.length && (t.preview_clip || t.clip_path) && n.push({
    index: be(t.current_index, 0),
    revision: be(t.revision, 1),
    clip_path: String(t.preview_clip || t.clip_path),
    prompt: String(t.prompt || ""),
    seed: be(t.seed, -1),
    length: be(t.length, 0)
  }), { ...t, history: n };
}
function _l(e) {
  if (!e || typeof e != "object" || !Object.keys(e).length) return "waiting";
  if (e.awaiting_review) return "reviewing";
  const t = String(e.decision || "").toLowerCase();
  return t === "approve_stop" ? "stopped" : t === "retry" || t === "reroll" || t === "resume" ? "retrying" : t === "approve" ? "approved" : t === "error" ? "error" : "ready";
}
var gl = /* @__PURE__ */ Be('<button><strong class="svelte-ah6v1b"> </strong> <span class="svelte-ah6v1b"> </span></button>'), bl = /* @__PURE__ */ Be('<nav class="takes svelte-ah6v1b" aria-label="候选片段"></nav>'), ml = /* @__PURE__ */ Be('<video controls="" playsinline="" preload="metadata" class="svelte-ah6v1b"></video>', 2), yl = /* @__PURE__ */ Be('<!> <div class="scrubber svelte-ah6v1b"><time class="svelte-ah6v1b"> </time> <input aria-label="视频播放进度" type="range" min="0" step="0.01" class="svelte-ah6v1b"/> <time class="svelte-ah6v1b"> </time></div>', 1), wl = /* @__PURE__ */ Be('<div class="empty svelte-ah6v1b">等待循环生成候选片段…</div>'), El = /* @__PURE__ */ Be('<p class="summary svelte-ah6v1b"> </p>'), kl = /* @__PURE__ */ Be('<main class="review-workspace svelte-ah6v1b"><header class="svelte-ah6v1b"><div class="svelte-ah6v1b"><h3 class="svelte-ah6v1b">🦅 H3 审片工作台</h3> <p class="svelte-ah6v1b"> </p></div> <span class="phase svelte-ah6v1b"> </span></header> <!> <section class="player-card svelte-ah6v1b"><!></section> <!> <section class="form-card svelte-ah6v1b"><label class="prompt svelte-ah6v1b"><span class="svelte-ah6v1b">重试提示词</span> <textarea placeholder="只在重试时覆盖当前镜头提示词" class="svelte-ah6v1b"></textarea></label> <div class="grid svelte-ah6v1b"><label class="svelte-ah6v1b"><span class="svelte-ah6v1b">种子</span><input type="number" class="svelte-ah6v1b"/></label> <label class="svelte-ah6v1b"><span class="svelte-ah6v1b">H3 length（0 或 17k+5）</span><input type="number" min="0" max="3592" step="1" class="svelte-ah6v1b"/> <small class="svelte-ah6v1b"> </small></label> <label class="svelte-ah6v1b"><span class="svelte-ah6v1b">下次等待自动通过（分）</span><input type="number" min="0" max="1440" step="0.5" class="svelte-ah6v1b"/> <small class="svelte-ah6v1b">仅对下一次进入审片等待生效</small></label></div> <div class="toggles svelte-ah6v1b"><label class="svelte-ah6v1b"><input type="checkbox" class="svelte-ah6v1b"/> 停止时合成已批准片段</label> <label class="svelte-ah6v1b"><input type="checkbox" class="svelte-ah6v1b"/> 等待时卸载模型</label> <label class="svelte-ah6v1b"><input type="checkbox" class="svelte-ah6v1b"/> 切换候选时自动播放</label></div></section> <footer class="svelte-ah6v1b"><button class="approve svelte-ah6v1b">批准并继续</button> <button class="svelte-ah6v1b">按修改重试</button> <button class="svelte-ah6v1b">换种子</button> <button class="svelte-ah6v1b">从所选场景重做</button> <button class="stop svelte-ah6v1b">批准并停止</button></footer> <div class="status svelte-ah6v1b" aria-live="polite"> </div></main>');
function Sl(e, t) {
  Sr(t, !1);
  const n = /* @__PURE__ */ C(), r = /* @__PURE__ */ C(), i = /* @__PURE__ */ C(), s = /* @__PURE__ */ C(), o = /* @__PURE__ */ C(), a = /* @__PURE__ */ C(), f = /* @__PURE__ */ C(), u = /* @__PURE__ */ C(), d = /* @__PURE__ */ C(), c = /* @__PURE__ */ C(), _ = /* @__PURE__ */ C(), h = /* @__PURE__ */ C();
  let v = ft(t, "initialReview", 24, () => ({})), E = ft(t, "initialWorkspace", 24, () => ({})), j = ft(t, "resolveVideoUrl", 8, (p) => String(p || "")), R = ft(t, "onWorkspaceChange", 8, () => {
  }), w = ft(t, "onDecision", 8, async () => {
  }), b = /* @__PURE__ */ C(Ct(v())), g = /* @__PURE__ */ C(qe(E())), M = /* @__PURE__ */ C(!1), O = /* @__PURE__ */ C(), X = /* @__PURE__ */ C(0), B = /* @__PURE__ */ C(0), U = /* @__PURE__ */ C(""), oe = /* @__PURE__ */ C("");
  function jt(p, T) {
    return p.find((P) => We(P) === T) || p.at(-1) || null;
  }
  function An(p) {
    const T = Ct(p), P = String(T.token || "");
    if (l(oe) && (T.awaiting_review === !1 || P && P !== l(oe)) && (m(oe, ""), m(U, "")), m(b, T), l(b).awaiting_review) {
      const z = (
        /** @type {Array<Record<string, any>>} */
        (l(b).history || []).at(-1)
      );
      m(g, {
        ...l(g),
        selectedTakeKey: We(z),
        retryPrompt: String(l(b).prompt ?? z?.prompt ?? l(g).retryPrompt ?? ""),
        retrySeed: Number(l(b).seed ?? z?.seed ?? l(g).retrySeed ?? -1),
        retryLength: Number(l(b).length ?? z?.length ?? l(g).retryLength ?? 0)
      }), Ht();
    }
    m(M, !1);
  }
  function Rn(p) {
    m(g, qe(p));
  }
  function Pn(p) {
    m(M, !!p);
  }
  function Ln(p) {
    m(oe, String(p || ""));
  }
  function Bt() {
    const p = l(O);
    if (p) {
      try {
        p.pause();
      } catch {
      }
      p.removeAttribute("src");
      try {
        p.load();
      } catch {
      }
      m(O, void 0);
    }
  }
  fl(Bt);
  function Ht() {
    R()?.(pl(l(g)));
  }
  function ni(p) {
    m(g, { ...l(g), selectedTakeKey: We(p) }), m(X, 0), m(B, 0), Ht();
  }
  function xe(p) {
    m(g, qe({ ...l(g), ...p })), Ht();
  }
  function ri() {
    const p = l(O);
    m(B, p && Number.isFinite(p.duration) ? p.duration : 0), m(X, p && Number.isFinite(p.currentTime) ? p.currentTime : 0), l(g).autoplay && p?.play?.().catch(() => {
    });
  }
  function ii() {
    const p = l(O);
    m(X, p && Number.isFinite(p.currentTime) ? p.currentTime : 0);
  }
  function si(p) {
    const T = (
      /** @type {HTMLInputElement} */
      p.currentTarget
    ), P = Number(T.value || 0);
    l(O) && Number.isFinite(P) && _s(O, l(O).currentTime = P), m(X, P);
  }
  function On(p) {
    const T = Math.max(0, Number(p) || 0), P = Math.floor(T / 60), z = (T - P * 60).toFixed(2).padStart(5, "0");
    return `${String(P).padStart(2, "0")}:${z}`;
  }
  async function nt(p) {
    if (!(l(M) || l(d))) {
      m(M, !0), m(U, "正在提交决策…");
      try {
        const T = await w()?.(p, {
          retry_prompt: l(g).retryPrompt,
          retry_seed: Number(l(g).retrySeed ?? -1),
          retry_length: Number(l(g).retryLength || 0),
          resume_scene: p === "resume" ? l(s) : 0,
          assemble_partial_on_stop: !!l(g).assemblePartial,
          auto_continue_timeout_minutes: Number(l(g).timeoutMinutes || 0),
          unload_models_while_waiting: !!l(g).unloadModels,
          token: String(l(b).token || ""),
          run_name: String(l(b).run_name || "")
        }), P = String(T?.lockedToken || l(b).token || "");
        P && m(oe, P), m(U, p === "approve" ? "已批准，等待下一片段…" : p === "approve_stop" ? "已批准并请求停止" : "已提交重试，等待新版本…");
      } catch (T) {
        m(U, `提交失败：${T instanceof Error ? T.message : String(T)}`);
      } finally {
        m(M, !1);
      }
    }
  }
  J(() => l(b), () => {
    m(n, l(b).history || []);
  }), J(() => (l(n), l(g)), () => {
    m(r, jt(l(n), l(g).selectedTakeKey));
  }), J(() => l(r), () => {
    m(i, We(l(r)));
  }), J(() => (l(r), l(b)), () => {
    m(s, l(r) ? Number(l(r).index || 0) + 1 : Number(l(b).current_index || 0) + 1);
  }), J(() => l(r), () => {
    m(o, Number(l(r)?.revision || 1));
  }), J(() => (l(r), l(b)), () => {
    m(a, l(r)?.clip_path || l(b).preview_clip || l(b).clip_path || "");
  }), J(() => (Zr(j()), l(a)), () => {
    m(f, j()(l(a)));
  }), J(() => l(b), () => {
    m(u, _l(l(b)));
  }), J(() => (l(oe), l(b)), () => {
    m(d, !!(l(oe) && l(oe) === String(l(b).token || "")));
  }), J(() => l(b), () => {
    m(c, Math.max(1, Number(l(b).fps || l(b).output_fps || 24)));
  }), J(() => (l(g), l(c)), () => {
    m(_, l(g).retryLength > 0 ? l(g).retryLength / l(c) : 0);
  }), J(() => l(u), () => {
    m(h, {
      waiting: "等待片段",
      ready: "片段已就绪",
      reviewing: "等待审片",
      approved: "已批准",
      retrying: "正在重试",
      stopped: "已停止",
      error: "发生错误"
    }[l(u)] || l(u));
  }), Ms();
  var li = {
    setReview: An,
    setWorkspace: Rn,
    setBusy: Pn,
    setLockedToken: Ln,
    disposeMedia: Bt
  };
  al();
  var Wt = kl(), Cn = W(Wt), Dn = W(Cn), ai = N(W(Dn), 2), oi = he(ai), fi = N(Dn, 2), ui = he(fi, !0), In = N(Cn, 2);
  {
    var ci = (p) => {
      var T = bl();
      Js(T, 5, () => l(n), (P) => We(P), (P, z) => {
        var Me = gl();
        let wt;
        var Ne = W(Me), Yt = he(Ne), Gt = N(Ne, 2), rt = he(Gt);
        st(
          (de, it, ki) => {
            wt = tl(Me, 1, "svelte-ah6v1b", null, wt, { active: de }), pe(Yt, `S${it ?? ""}`), pe(rt, `r${ki ?? ""}`);
          },
          [
            () => We(l(z)) === l(i),
            () => (l(z), x(() => Number(l(z).index || 0) + 1)),
            () => (l(z), x(() => String(Number(l(z).revision || 1)).padStart(4, "0")))
          ]
        ), V("click", Me, () => ni(l(z))), Ae(P, Me);
      }), Ae(p, T);
    };
    Qt(In, (p) => {
      l(n), x(() => l(n).length > 0) && p(ci);
    });
  }
  var Fn = N(In, 2), vi = W(Fn);
  {
    var di = (p) => {
      var T = yl(), P = ms(T);
      Xs(P, () => l(f), (rt) => {
        var de = ml();
        ll(de, (it) => m(O, it), () => l(O)), st(() => tn(de, "src", l(f))), V("loadedmetadata", de, ri), V("timeupdate", de, ii), Ae(rt, de);
      });
      var z = N(P, 2), Me = W(z), wt = he(Me, !0), Ne = N(Me, 2), Yt = N(Ne, 2), Gt = he(Yt, !0);
      st(
        (rt, de, it) => {
          pe(wt, rt), tn(Ne, "max", de), at(Ne, l(X)), pe(Gt, it);
        },
        [
          () => (l(X), x(() => On(l(X)))),
          () => (l(B), x(() => Math.max(0.01, l(B)))),
          () => (l(B), x(() => On(l(B))))
        ]
      ), V("input", Ne, si), Ae(p, T);
    }, hi = (p) => {
      var T = wl();
      Ae(p, T);
    };
    Qt(vi, (p) => {
      l(f) ? p(di) : p(hi, -1);
    });
  }
  var jn = N(Fn, 2);
  {
    var pi = (p) => {
      var T = El(), P = he(T, !0);
      st(() => pe(P, (l(b), x(() => l(b).summary)))), Ae(p, T);
    };
    Qt(jn, (p) => {
      l(b), x(() => l(b).summary) && p(pi);
    });
  }
  var Bn = N(jn, 2), Hn = W(Bn), Wn = N(W(Hn), 2), Un = N(Hn, 2), Vn = W(Un), zn = N(W(Vn)), Kn = N(Vn, 2), Ut = N(W(Kn)), _i = N(Ut, 2), gi = he(_i, !0), bi = N(Kn, 2), qn = N(W(bi)), mi = N(Un, 2), Yn = W(mi), Gn = W(Yn), Xn = N(Yn, 2), $n = W(Xn), yi = N(Xn, 2), Jn = W(yi), Zn = N(Bn, 2), Vt = W(Zn), zt = N(Vt, 2), Kt = N(zt, 2), qt = N(Kt, 2), Qn = N(qt, 2), wi = N(Zn, 2), Ei = he(wi, !0);
  return st(
    (p, T) => {
      tn(Wt, "data-phase", l(u)), pe(oi, `场景 ${l(s) ?? ""} · r${p ?? ""}`), pe(ui, l(h)), at(Wn, (l(g), x(() => l(g).retryPrompt))), at(zn, (l(g), x(() => l(g).retrySeed))), at(Ut, (l(g), x(() => l(g).retryLength))), pe(gi, T), at(qn, (l(g), x(() => l(g).timeoutMinutes))), en(Gn, (l(g), x(() => l(g).assemblePartial))), en($n, (l(g), x(() => l(g).unloadModels))), en(Jn, (l(g), x(() => l(g).autoplay))), Vt.disabled = (l(M), l(d), l(b), x(() => l(M) || l(d) || !l(b).awaiting_review)), zt.disabled = (l(M), l(d), l(b), x(() => l(M) || l(d) || !l(b).awaiting_review)), Kt.disabled = (l(M), l(d), l(b), x(() => l(M) || l(d) || !l(b).awaiting_review)), qt.disabled = (l(M), l(d), l(b), l(r), x(() => l(M) || l(d) || !l(b).awaiting_review || !l(r))), Qn.disabled = (l(M), l(d), l(b), x(() => l(M) || l(d) || !l(b).awaiting_review)), pe(Ei, (l(U), l(d), l(b), x(() => l(U) || (l(d) ? "该版本已提交，等待新 token 或审片状态更新" : l(b).awaiting_review ? "检查视频后选择下一步" : "等待运行状态更新"))));
    },
    [
      () => (l(o), x(() => String(l(o)).padStart(4, "0"))),
      () => (l(g), l(_), l(c), x(() => l(g).retryLength ? `约 ${l(_).toFixed(2)} 秒 @ ${l(c)}fps` : "0 = 不覆盖模型帧长"))
    ]
  ), V("input", Wn, (p) => xe({ retryPrompt: p.currentTarget.value })), V("change", zn, (p) => xe({ retrySeed: Number(p.currentTarget.value) })), V("change", Ut, (p) => xe({ retryLength: ti(p.currentTarget.value) })), V("change", qn, (p) => xe({ timeoutMinutes: Number(p.currentTarget.value) })), V("change", Gn, (p) => xe({ assemblePartial: p.currentTarget.checked })), V("change", $n, (p) => xe({ unloadModels: p.currentTarget.checked })), V("change", Jn, (p) => xe({ autoplay: p.currentTarget.checked })), V("click", Vt, () => nt("approve")), V("click", zt, () => nt("retry")), V("click", Kt, () => nt("reroll")), V("click", qt, () => nt("resume")), V("click", Qn, () => nt("approve_stop")), Ae(e, Wt), ot(t, "setReview", An), ot(t, "setWorkspace", Rn), ot(t, "setBusy", Pn), ot(t, "setLockedToken", Ln), ot(t, "disposeMedia", Bt), Tr(li);
}
function Nl(e, t = {}) {
  if (!(e instanceof Element)) throw new TypeError("A DOM target is required");
  const n = Ks(Sl, {
    target: e,
    props: {
      initialReview: Ct(t.review),
      initialWorkspace: qe(t.workspace),
      resolveVideoUrl: t.resolveVideoUrl,
      onWorkspaceChange: t.onWorkspaceChange,
      onDecision: t.onDecision
    }
  });
  return {
    /** @param {unknown} value */
    setReview(r) {
      n.setReview?.(Ct(r));
    },
    /** @param {unknown} value */
    setWorkspace(r) {
      n.setWorkspace?.(qe(r));
    },
    /** @param {unknown} value */
    setBusy(r) {
      n.setBusy?.(!!r);
    },
    /** @param {unknown} value */
    setLockedToken(r) {
      n.setLockedToken?.(r);
    },
    disposeMedia() {
      n.disposeMedia?.();
    },
    destroy() {
      return Ys(n);
    }
  };
}
export {
  vl as REVIEW_WORKSPACE_SCHEMA_VERSION,
  Ml as assertResolvedDecision,
  xl as isValidRetryLength,
  Nl as mountH3ReviewWorkspace,
  Ct as normalizeReview,
  qe as normalizeWorkspace,
  pl as serializeWorkspace,
  ti as snapRetryLength
};

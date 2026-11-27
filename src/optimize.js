// Rigorous global minimisation by interval branch and bound (Moore Skelboe with
// Hansen's monotonicity test).
//
// Invariant: the true global minimum f* over the domain satisfies
//     lower <= f* <= upper
// where upper is a verified upper bound on f at some evaluated point, and lower
// is the smallest interval lower bound among the boxes not yet discarded. A box
// is discarded only when it provably cannot contain a global minimiser:
//   * its lower bound exceeds the best verified upper bound, or
//   * some partial derivative has constant sign on it and it does not touch the
//     domain boundary in that direction (then it is reduced to the boundary face).

import { Interval } from './interval.js';
import { compile } from './expr.js';
import * as B from './box.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].lb <= a[i].lb) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < a.length && a[l].lb < a[s].lb) s = l;
        if (r < a.length && a[r].lb < a[s].lb) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]]; i = s;
      }
    }
    return top;
  }
  peek() { return this.a[0]; }
}

/**
 * @param {string} expr      objective
 * @param {string[]} vars    variable order
 * @param {Interval[]} domain search box
 * @param {object} [opts]    { tol: minimiser box width, ftol: stop early once
 *                           upper - lower <= ftol (0 = off), maxBoxes }
 * @returns {{lower, upper, argmin, minimizers, stats}}
 */
export function minimize(expr, vars, domain, opts = {}) {
  const f = compile(expr, vars);
  const tol = opts.tol ?? 1e-6;
  const ftol = opts.ftol ?? 0;
  const maxBoxes = opts.maxBoxes ?? 500000;
  const stats = { boxes: 0, bisections: 0, cutoff: 0, monotone: 0 };

  let upper = Infinity, argmin = null;
  const tryPoint = (box) => {
    const x = B.mid(box);
    const v = f.interval(x.map((t) => Interval.point(t)));
    if (!v.isEmpty() && v.hi < upper) { upper = v.hi; argmin = x; }
  };

  const heap = new MinHeap();
  const done = [];
  const enqueue = (box) => {
    const F = f.enclose(box);
    if (F.isEmpty()) return; // outside the natural domain everywhere
    stats.boxes++;
    tryPoint(box);
    if (F.lo > upper) { stats.cutoff++; return; }
    heap.push({ box, lb: F.lo });
  };
  enqueue(domain);

  while (heap.size) {
    if (stats.boxes > maxBoxes) break;
    if (ftol > 0 && upper - heap.peek().lb <= ftol) break; // bounds already tight enough
    let { box, lb } = heap.pop();
    if (lb > upper) { stats.cutoff++; continue; }

    // monotonicity test
    const total = f.isTotal(box);
    const g = total ? f.dual(box).d : null;
    let discard = false;
    box = box.map((x, i) => {
      if (!total || discard || x.width() === 0 || g[i].isEmpty()) return x;
      if (g[i].lo > 0) {
        if (x.lo === domain[i].lo) { stats.monotone++; return Interval.point(x.lo); }
        discard = true;
      } else if (g[i].hi < 0) {
        if (x.hi === domain[i].hi) { stats.monotone++; return Interval.point(x.hi); }
        discard = true;
      }
      return x;
    });
    if (discard) { stats.monotone++; continue; }

    const F = f.enclose(box);
    if (F.isEmpty() || F.lo > upper) { stats.cutoff++; continue; }
    if (B.width(box) <= tol) {
      done.push({ box, lb: F.lo });
      continue;
    }
    stats.bisections++;
    for (const child of B.bisect(box)) enqueue(child);
  }

  // boxes still in the heap (box limit or ftol stop) keep the lower bound honest
  const remaining = [...done, ...heap.a];
  const live = remaining.filter((r) => r.lb <= upper);
  const lower = live.length ? Math.min(...live.map((r) => r.lb)) : upper;
  return {
    lower,
    upper,
    argmin,
    minimizers: clusterBoxes(live.filter((r) => done.includes(r)).map((r) => r.box)),
    complete: heap.size === 0,
    stats,
  };
}

/** Group touching boxes so a minimiser is reported once, not as 40 slivers. */
function clusterBoxes(boxes) {
  const touches = (a, b) => a.every((x, i) => x.lo <= b[i].hi && b[i].lo <= x.hi);
  const clusters = [];
  for (const b of boxes) {
    const hits = clusters.filter((c) => c.members.some((m) => touches(m, b)));
    if (!hits.length) { clusters.push({ members: [b], hull: b }); continue; }
    const merged = { members: [b], hull: b };
    for (const h of hits) {
      merged.members.push(...h.members);
      merged.hull = B.hull(merged.hull, h.hull);
      clusters.splice(clusters.indexOf(h), 1);
    }
    clusters.push(merged);
  }
  return clusters.map((c) => c.hull);
}

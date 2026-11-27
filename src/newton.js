// Univariate root isolation with the interval Newton method.
//
// For a box X, a point m in X and an enclosure F'(X) of the derivative over X,
//
//     N(X) = m - f(m) / F'(X)
//
// contains every root of f in X (mean value theorem). Three outcomes matter:
//
//   N(X) and X disjoint            -> X provably has no root, discard it
//   N(X) inside the interior of X  -> X provably has exactly one root
//                                     (Brouwer plus strict monotonicity)
//   otherwise                      -> contract to N(X) ∩ X, or bisect
//
// When F'(X) contains zero, extended division splits N(X) into two pieces, which
// lets one step separate two nearby roots without bisection.

import { Interval } from './interval.js';
import { compile } from './expr.js';

/**
 * Find every root of f in X.
 * @param {string|object} f   expression text or compiled function of one variable
 * @param {Interval} X        search interval (bounded)
 * @param {object} [opts]
 * @returns {{roots: Array<{box: Interval, status: 'unique'|'possible'}>, stats: object}}
 *
 * 'unique' boxes each contain exactly one root (a proof, not a heuristic).
 * 'possible' boxes are narrower than tol and could not be decided, which is
 * what happens at multiple roots such as x^2 = 0, where no method based on
 * floating point can certify uniqueness.
 */
/** Off centre split ratio, see Interval.bisect. */
const SPLIT = 0.4870605;

export function isolateRoots(f, X, opts = {}) {
  const fn = typeof f === 'string' || f.tree === undefined ? compile(f) : f;
  if (fn.vars.length > 1) throw new Error('isolateRoots expects a function of one variable');
  const tol = opts.tol ?? 1e-12;
  const maxIter = opts.maxIter ?? 200000;
  const stats = { boxes: 0, newtonSteps: 0, bisections: 0, excluded: 0 };
  const found = [];
  const stack = [X];

  const F = (Y) => fn.interval([Y]);
  const Fsharp = (Y) => fn.enclose([Y]); // natural ∩ mean value form, for exclusion
  const D = (Y) => fn.dual([Y]).d[0];

  while (stack.length) {
    if (++stats.boxes > maxIter) throw new Error('isolateRoots: iteration limit reached');
    let Y = stack.pop();
    const FY = Fsharp(Y);
    if (FY.isEmpty() || !FY.contains(0)) { stats.excluded++; continue; }

    if (!fn.isTotal([Y])) {
      // f is not continuous on all of Y (pole, domain edge): no mean value
      // theorem, so only exclusion and bisection are sound here
      if (Y.width() <= tol) { found.push({ box: Y, status: 'possible' }); continue; }
      pushHalves(Y);
      continue;
    }
    const DY = D(Y);
    const m = Y.mid();
    const fm = F(Interval.point(m));
    if (fm.isEmpty() || DY.isEmpty()) {
      // midpoint outside the natural domain, fall back to bisection
      pushHalves(Y);
      continue;
    }
    stats.newtonSteps++;
    const pieces = fm.divExtended(DY).map((q) => Interval.point(m).sub(q).intersect(Y)).filter((p) => !p.isEmpty());

    if (pieces.length === 0) { stats.excluded++; continue; }

    if (pieces.length === 1 && !DY.contains(0)) {
      const N = Interval.point(m).sub(fm.div(DY));
      if (Y.interiorContains(N)) {
        found.push({ box: polish(fn, N, tol), status: 'unique' });
        continue;
      }
    }

    if (Y.width() <= tol) {
      found.push({ box: Y, status: 'possible' });
      continue;
    }

    const shrunk = pieces.reduce((s, p) => s + p.width(), 0);
    if (shrunk < 0.75 * Y.width()) {
      for (const p of pieces) stack.push(p);
    } else {
      pushHalves(Y);
    }
  }

  function pushHalves(Y) {
    stats.bisections++;
    const [a, b] = Y.bisect(SPLIT);
    if (a.width() === 0 || b.width() === 0 || a.width() >= Y.width()) {
      found.push({ box: Y, status: 'possible' });
      return;
    }
    stack.push(b, a);
  }

  found.sort((a, b) => a.box.lo - b.box.lo);
  return { roots: mergePossible(found, opts.clusterGap ?? 100 * tol), stats };
}

/**
 * Keep iterating Newton on a box already known to hold a unique root. Each step
 * stays valid (N(X) ∩ X still contains the root) and converges quadratically
 * until the width is down to a few ulps.
 */
function polish(fn, X, tol) {
  for (let i = 0; i < 100; i++) {
    if (!fn.isTotal([X])) break;
    const DX = fn.dual([X]).d[0];
    if (DX.contains(0)) break;
    const m = X.mid();
    const fm = fn.interval([Interval.point(m)]);
    if (fm.isEmpty()) break;
    const N = Interval.point(m).sub(fm.div(DX)).intersect(X);
    if (N.isEmpty() || N.equals(X)) break;
    const done = N.width() >= X.width();
    X = N;
    if (done || X.width() <= tol * 1e-3) break;
  }
  return X;
}

/**
 * Undecided boxes near a multiple root come out as a scatter of slivers with
 * small gaps between them (the gaps were excluded). Report each such cluster
 * once, as its hull, which is still a valid (if slightly larger) enclosure.
 */
function mergePossible(list, gap) {
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && last.status === 'possible' && r.status === 'possible' && r.box.lo - last.box.hi <= gap) {
      last.box = Interval.hull(last.box, r.box);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

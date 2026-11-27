// Verified solution of square nonlinear systems f(x) = 0 with the Krawczyk
// operator and branch and bound.
//
//     K(X) = y - Y f(y) + (I - Y F'(X)) (X - y)
//
// y is the midpoint of X, F'(X) the interval Jacobian over X (from interval
// forward mode AD) and Y any real matrix, normally an approximate inverse of
// mid F'(X). Krawczyk's theorem: every root of f in X lies in K(X), and if
// K(X) is contained in the interior of X then X holds exactly one root.
// Y is computed in plain floating point; it does not need to be accurate, only
// the interval evaluation of K has to be rigorous, and it is.

import { Interval } from './interval.js';
import { compile } from './expr.js';
import * as B from './box.js';

/** Approximate inverse with partial pivoting. Returns null when singular. */
export function invert(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  const inv = M.map((row) => row.slice(n));
  return inv.every((row) => row.every(Number.isFinite)) ? inv : null;
}

/** Compile "f1; f2; ..." (or an array of strings) into a system over vars. */
export function compileSystem(equations, vars) {
  const list = Array.isArray(equations) ? equations : equations.split(';').map((s) => s.trim()).filter(Boolean);
  const fs = list.map((e) => compile(e, vars));
  return {
    vars,
    size: fs.length,
    interval: (box) => fs.map((f) => f.interval(box)),
    isTotal: (box) => fs.every((f) => f.isTotal(box)),
    jacobian: (box) => fs.map((f) => f.dual(box).d),
  };
}

/**
 * One Krawczyk evaluation. Returns { K, unique, empty } or null when the
 * preconditioner cannot be formed.
 */
export function krawczykStep(sys, X) {
  const n = X.length;
  if (!sys.isTotal(X)) return null;
  const y = B.mid(X);
  const yI = y.map((v) => Interval.point(v));
  const fy = sys.interval(yI);
  if (fy.some((v) => v.isEmpty())) return null;
  const J = sys.jacobian(X);
  if (J.some((row) => row.some((v) => v.isEmpty() || !v.isBounded()))) return null;
  const Y = invert(J.map((row) => row.map((v) => v.mid())));
  if (!Y) return null;

  const dx = X.map((x, i) => x.sub(yI[i]));
  const K = [];
  for (let i = 0; i < n; i++) {
    // y_i - (Y f(y))_i
    let acc = yI[i];
    for (let j = 0; j < n; j++) acc = acc.sub(Interval.point(Y[i][j]).mul(fy[j]));
    // + sum_k (I - Y J)_{ik} (X_k - y_k)
    for (let k = 0; k < n; k++) {
      let c = Interval.point(i === k ? 1 : 0);
      for (let j = 0; j < n; j++) c = c.sub(Interval.point(Y[i][j]).mul(J[j][k]));
      acc = acc.add(c.mul(dx[k]));
    }
    K.push(acc);
  }
  const unique = B.interiorContains(X, K);
  const empty = B.isEmpty(B.intersect(K, X));
  return { K, unique, empty };
}

/**
 * Enclose every solution of the square system in the box.
 * @returns {{solutions: Array<{box, status: 'unique'|'possible'}>, stats}}
 */
export function solveSystem(equations, vars, box, opts = {}) {
  const sys = compileSystem(equations, vars);
  if (sys.size !== vars.length) throw new Error(`system has ${sys.size} equations in ${vars.length} unknowns`);
  const tol = opts.tol ?? 1e-10;
  const maxBoxes = opts.maxBoxes ?? 200000;
  const stats = { boxes: 0, krawczyk: 0, excluded: 0, bisections: 0 };
  const out = [];
  const stack = [box];

  while (stack.length) {
    if (++stats.boxes > maxBoxes) throw new Error('solveSystem: box limit reached');
    const X = stack.pop();
    const FX = sys.interval(X);
    if (FX.some((v) => v.isEmpty() || !v.contains(0))) { stats.excluded++; continue; }

    const step = krawczykStep(sys, X);
    if (step) {
      stats.krawczyk++;
      if (step.empty) { stats.excluded++; continue; }
      if (step.unique) { out.push({ box: tighten(sys, step.K, tol), status: 'unique' }); continue; }
      const C = B.intersect(step.K, X);
      if (B.width(C) < 0.75 * B.width(X)) { stack.push(C); continue; }
    }
    if (B.width(X) <= tol) { out.push({ box: X, status: 'possible' }); continue; }
    stats.bisections++;
    const [a, b] = B.bisect(X, 0.4870605);
    stack.push(b, a);
  }
  out.sort((p, q) => p.box[0].lo - q.box[0].lo || p.box[1 % p.box.length].lo - q.box[1 % q.box.length].lo);
  return { solutions: out, stats };
}

/** Iterate X <- K(X) ∩ X on a box with a proven unique root. */
function tighten(sys, X, tol) {
  for (let i = 0; i < 60; i++) {
    const step = krawczykStep(sys, X);
    if (!step) break;
    const C = B.intersect(step.K, X);
    if (B.isEmpty(C)) break; // cannot happen in exact arithmetic, keep X to stay safe
    const w0 = B.width(X);
    X = C;
    if (B.width(C) >= w0 || B.width(C) <= tol * 1e-3) break;
  }
  return X;
}

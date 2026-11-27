// Closed real intervals [lo, hi] with outward rounded endpoints.
//
// Fundamental guarantee (inclusion property): for every operation op and every
// real x in X, y in Y, the exact real op(x, y) lies in op(X, Y). Every function in
// this file is written so that this holds even though the endpoints are doubles.

import {
  nextUp, nextDown, addDown, addUp, subDown, subUp,
  mulDown, mulUp, divDown, divUp, sqrtDown, sqrtUp,
} from './round.js';

export class Interval {
  constructor(lo, hi = lo) {
    if (Number.isNaN(lo) || Number.isNaN(hi)) throw new RangeError('interval endpoint is NaN');
    if (lo > hi) throw new RangeError(`invalid interval [${lo}, ${hi}]`);
    // normalise -0 so that printing and equality checks are predictable
    this.lo = lo === 0 ? 0 : lo;
    this.hi = hi === 0 ? 0 : hi;
  }

  static point(x) { return new Interval(x, x); }
  static entire() { return ENTIRE; }
  static empty() { return EMPTY; }

  /** Smallest interval containing every given number or interval. */
  static hull(...items) {
    let lo = Infinity, hi = -Infinity;
    for (const it of items) {
      if (it instanceof Interval) {
        if (it.isEmpty()) continue;
        lo = Math.min(lo, it.lo); hi = Math.max(hi, it.hi);
      } else {
        lo = Math.min(lo, it); hi = Math.max(hi, it);
      }
    }
    return lo > hi ? EMPTY : new Interval(lo, hi);
  }

  isEmpty() { return this === EMPTY; }
  isPoint() { return !this.isEmpty() && this.lo === this.hi; }
  isBounded() { return Number.isFinite(this.lo) && Number.isFinite(this.hi); }

  width() { return this.isEmpty() ? 0 : subUp(this.hi, this.lo); }
  /** A double inside the interval, close to the midpoint. */
  mid() {
    if (this.isEmpty()) return NaN;
    const { lo, hi } = this;
    if (lo === -Infinity && hi === Infinity) return 0;
    if (lo === -Infinity) return -Number.MAX_VALUE;
    if (hi === Infinity) return Number.MAX_VALUE;
    const m = lo / 2 + hi / 2; // avoids overflow of lo + hi
    return Math.min(Math.max(m, lo), hi);
  }
  /** Magnitude: max |x| over the interval. */
  mag() { return Math.max(Math.abs(this.lo), Math.abs(this.hi)); }
  /** Mignitude: min |x| over the interval. */
  mig() { return this.contains(0) ? 0 : Math.min(Math.abs(this.lo), Math.abs(this.hi)); }

  contains(x) {
    if (this.isEmpty()) return false;
    if (x instanceof Interval) return x.isEmpty() || (this.lo <= x.lo && x.hi <= this.hi);
    return this.lo <= x && x <= this.hi;
  }
  /** True when Y lies in the topological interior of this interval. */
  interiorContains(y) {
    if (y.isEmpty()) return true;
    if (this.isEmpty()) return false;
    return this.lo < y.lo && y.hi < this.hi;
  }
  intersect(y) {
    if (this.isEmpty() || y.isEmpty()) return EMPTY;
    const lo = Math.max(this.lo, y.lo), hi = Math.min(this.hi, y.hi);
    return lo > hi ? EMPTY : new Interval(lo, hi);
  }
  equals(y) {
    if (this.isEmpty() || y.isEmpty()) return this.isEmpty() && y.isEmpty();
    return this.lo === y.lo && this.hi === y.hi;
  }
  /**
   * Split in two. The default ratio is deliberately not 1/2: solvers bisect
   * recursively, and with exact halving a root at a "nice" point such as 0 or
   * 1 lands on a box edge forever, where no interior based existence test can
   * ever succeed. An off centre split moves such roots into a box interior.
   */
  bisect(ratio = 0.5) {
    let m = ratio === 0.5 || !this.isBounded() ? this.mid() : this.lo + (this.hi - this.lo) * ratio;
    if (!(m >= this.lo && m <= this.hi)) m = this.mid();
    return [new Interval(this.lo, m), new Interval(m, this.hi)];
  }

  // ---- arithmetic --------------------------------------------------------

  add(y) {
    y = toInterval(y);
    if (this.isEmpty() || y.isEmpty()) return EMPTY;
    return new Interval(addDown(this.lo, y.lo), addUp(this.hi, y.hi));
  }
  sub(y) {
    y = toInterval(y);
    if (this.isEmpty() || y.isEmpty()) return EMPTY;
    return new Interval(subDown(this.lo, y.hi), subUp(this.hi, y.lo));
  }
  neg() {
    if (this.isEmpty()) return EMPTY;
    return new Interval(-this.hi, -this.lo);
  }
  mul(y) {
    y = toInterval(y);
    if (this.isEmpty() || y.isEmpty()) return EMPTY;
    const a = this.lo, b = this.hi, c = y.lo, d = y.hi;
    const lo = Math.min(mulDown(a, c), mulDown(a, d), mulDown(b, c), mulDown(b, d));
    const hi = Math.max(mulUp(a, c), mulUp(a, d), mulUp(b, c), mulUp(b, d));
    return new Interval(lo, hi);
  }
  /** Reciprocal. Division by an interval containing zero yields the entire line. */
  recip() {
    if (this.isEmpty()) return EMPTY;
    if (this.lo === 0 && this.hi === 0) return EMPTY;
    if (this.contains(0)) {
      if (this.lo === 0) return new Interval(divDown(1, this.hi), Infinity);
      if (this.hi === 0) return new Interval(-Infinity, divUp(1, this.lo));
      return ENTIRE;
    }
    return new Interval(divDown(1, this.hi), divUp(1, this.lo));
  }
  div(y) {
    y = toInterval(y);
    if (this.isEmpty() || y.isEmpty()) return EMPTY;
    if (y.lo === 0 && y.hi === 0) return EMPTY;
    if (y.contains(0)) {
      // use the hull of the extended division
      return Interval.hull(...this.divExtended(y));
    }
    const a = this.lo, b = this.hi, c = y.lo, d = y.hi;
    const lo = Math.min(divDown(a, c), divDown(a, d), divDown(b, c), divDown(b, d));
    const hi = Math.max(divUp(a, c), divUp(a, d), divUp(b, c), divUp(b, d));
    return new Interval(lo, hi);
  }
  /**
   * Extended (Kahan) division: { x / y : x in X, y in Y, y != 0 } as a list of
   * at most two intervals. This is what makes the interval Newton step able to
   * split a box in two around a double root of the derivative.
   */
  divExtended(y) {
    y = toInterval(y);
    if (this.isEmpty() || y.isEmpty()) return [];
    if (!y.contains(0)) return [this.div(y)];
    const a = this.lo, b = this.hi, c = y.lo, d = y.hi;
    if (this.contains(0)) return [ENTIRE];
    if (c === 0 && d === 0) return [];
    if (b < 0) {
      if (c === 0) return [new Interval(-Infinity, divUp(b, d))];
      if (d === 0) return [new Interval(divDown(b, c), Infinity)];
      return [new Interval(-Infinity, divUp(b, d)), new Interval(divDown(b, c), Infinity)];
    }
    // a > 0
    if (c === 0) return [new Interval(divDown(a, d), Infinity)];
    if (d === 0) return [new Interval(-Infinity, divUp(a, c))];
    return [new Interval(-Infinity, divUp(a, c)), new Interval(divDown(a, d), Infinity)];
  }

  sqr() {
    if (this.isEmpty()) return EMPTY;
    const m = this.mig(), M = this.mag();
    return new Interval(mulDown(m, m), mulUp(M, M));
  }

  /** x^n for an integer n, exploiting monotonicity and parity. */
  powi(n) {
    if (!Number.isInteger(n)) throw new RangeError('powi expects an integer exponent');
    if (this.isEmpty()) return EMPTY;
    if (n === 0) return ONE;
    if (n < 0) return this.powi(-n).recip();
    if (n === 1) return this;
    if (n % 2 === 1) {
      return new Interval(powPoint(this.lo, n).lo, powPoint(this.hi, n).hi);
    }
    const m = this.mig(), M = this.mag();
    return new Interval(powPoint(m, n).lo, powPoint(M, n).hi);
  }

  abs() {
    if (this.isEmpty()) return EMPTY;
    return new Interval(this.mig(), this.mag());
  }

  sqrt() {
    if (this.isEmpty() || this.hi < 0) return EMPTY;
    return new Interval(sqrtDown(Math.max(this.lo, 0)), sqrtUp(this.hi));
  }

  // Transcendental functions. Math.exp, Math.log, Math.sin and Math.cos are not
  // correctly rounded, but the fdlibm derived implementations used by V8 and
  // SpiderMonkey are accurate to better than one ulp. We therefore widen by one
  // ulp on each side, which covers the true value. See README, "Assumptions".

  exp() {
    if (this.isEmpty()) return EMPTY;
    const lo = this.lo === -Infinity ? 0 : Math.max(0, nextDown(Math.exp(this.lo)));
    const hi = this.hi === Infinity ? Infinity : nextUp(Math.exp(this.hi));
    return new Interval(lo, hi);
  }

  log() {
    if (this.isEmpty() || this.hi <= 0) return EMPTY;
    const lo = this.lo <= 0 ? -Infinity : nextDown(Math.log(this.lo));
    const hi = this.hi === Infinity ? Infinity : nextUp(Math.log(this.hi));
    return new Interval(lo, hi);
  }

  sin() { return trig(this, Math.sin, 0.5); }
  cos() { return trig(this, Math.cos, 0); }

  toString(digits) {
    if (this.isEmpty()) return '[empty]';
    const f = (v) => (digits === undefined ? String(v) : v.toPrecision(digits));
    return `[${f(this.lo)}, ${f(this.hi)}]`;
  }
}

const EMPTY = Object.create(Interval.prototype);
EMPTY.lo = Infinity; EMPTY.hi = -Infinity;
Object.freeze(EMPTY);
const ENTIRE = Object.freeze(new Interval(-Infinity, Infinity));
const ONE = Object.freeze(new Interval(1, 1));

export function toInterval(v) {
  if (v instanceof Interval) return v;
  if (typeof v === 'number') return Interval.point(v);
  throw new TypeError(`cannot convert ${v} to an interval`);
}

/** Enclosure of x^n for a double x and integer n >= 1 by binary powering. */
function powPoint(x, n) {
  let result = ONE;
  let base = Interval.point(x);
  let k = n;
  while (k > 0) {
    if (k & 1) result = result.mul(base);
    k >>= 1;
    if (k > 0) base = base.mul(base);
  }
  return result;
}

const TWO_PI_LOWER = 6.283185307179586; // a double below 2 pi
const PI = Math.PI;

/**
 * Range of sin or cos over X. Extremes occur at (k + phase) * pi; for cos the
 * maxima are at even k and minima at odd k with phase 0, for sin the phase is
 * 1/2 and maxima are at even k. An extremum is included if it *might* lie in X,
 * using a slack that dominates the error of computing (k + phase) * pi in
 * floating point. Including a spurious extremum only widens the result, so the
 * test is safe in the direction that matters.
 */
function trig(x, fn, phase) {
  if (x.isEmpty()) return EMPTY;
  const FULL = new Interval(-1, 1);
  if (!x.isBounded() || x.width() >= TWO_PI_LOWER || x.mag() > 1e9) return FULL;
  const ends = [fn(x.lo), fn(x.hi)];
  let lo = nextDown(Math.min(...ends));
  let hi = nextUp(Math.max(...ends));
  const kStart = Math.floor(x.lo / PI - phase) - 1;
  const kEnd = Math.ceil(x.hi / PI - phase) + 1;
  for (let k = kStart; k <= kEnd; k++) {
    const t = (k + phase) * PI;
    const slack = Math.abs(t) * 4e-16 + 1e-300;
    if (t + slack >= x.lo && t - slack <= x.hi) {
      // sin: even k is a maximum. cos: even k is a maximum too.
      if (((k % 2) + 2) % 2 === 0) hi = 1; else lo = -1;
    }
  }
  return new Interval(Math.max(lo, -1), Math.min(hi, 1));
}

export { EMPTY, ENTIRE };

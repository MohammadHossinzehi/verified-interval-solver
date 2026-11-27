// Directed rounding for IEEE 754 binary64 without access to the FPU rounding mode.
//
// JavaScript only exposes round to nearest. To get correctly rounded *downward*
// and *upward* results we compute the round to nearest result and then use an
// error free transformation (TwoSum, Dekker TwoProduct) to find the sign of the
// rounding error exactly. If the true result lies below the rounded value we
// step one ulp down, and so on. The result is the tightest double bound, not a
// blanket "widen by one ulp" approximation.
//
// When the error free transformations are not valid (overflow, results deep in
// the subnormal range) we fall back to a one ulp widening, which is always safe.

const buf = new DataView(new ArrayBuffer(8));

/** Smallest double strictly greater than x. */
export function nextUp(x) {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  buf.setFloat64(0, x);
  let bits = buf.getBigInt64(0);
  bits += x > 0 ? 1n : -1n;
  buf.setBigInt64(0, bits);
  const y = buf.getFloat64(0);
  return y === 0 ? 0 : y; // never hand out -0
}

/** Largest double strictly smaller than x. */
export function nextDown(x) {
  const y = -nextUp(-x);
  return y === 0 ? 0 : y;
}

// Veltkamp splitting constant 2^27 + 1.
const SPLITTER = 134217729;
// Below this magnitude Dekker products can lose bits to underflow.
const TINY = 2 ** -969;
// Above this magnitude the splitting step can overflow.
const HUGE = 2 ** 995;

/** Exact a + b = s + e (Knuth TwoSum). Valid whenever s is finite. */
export function twoSum(a, b) {
  const s = a + b;
  const bb = s - a;
  const e = (a - (s - bb)) + (b - bb);
  return [s, e];
}

function split(a) {
  const c = SPLITTER * a;
  const hi = c - (c - a);
  return [hi, a - hi];
}

/** Exact a * b = p + e (Dekker TwoProduct) for operands in the safe range. */
export function twoProduct(a, b) {
  const p = a * b;
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  const e = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return [p, e];
}

function safeForProduct(a, b, p) {
  const aa = Math.abs(a), ab = Math.abs(b), ap = Math.abs(p);
  return ap >= TINY && aa < HUGE && ab < HUGE && ap < HUGE;
}

// Infinity handling convention: an operation on finite inputs that overflows to
// +Infinity rounds down to MAX_VALUE, because the true value is finite.
function overflowDown(r, finiteInputs) {
  if (r === Infinity && finiteInputs) return Number.MAX_VALUE;
  return r;
}
function overflowUp(r, finiteInputs) {
  if (r === -Infinity && finiteInputs) return -Number.MAX_VALUE;
  return r;
}

export function addDown(a, b) {
  const s = a + b;
  if (!Number.isFinite(s)) {
    return Number.isNaN(s) ? s : overflowDown(s, Number.isFinite(a) && Number.isFinite(b));
  }
  const e = twoSum(a, b)[1];
  return e < 0 ? nextDown(s) : s;
}

export function addUp(a, b) {
  const s = a + b;
  if (!Number.isFinite(s)) {
    return Number.isNaN(s) ? s : overflowUp(s, Number.isFinite(a) && Number.isFinite(b));
  }
  const e = twoSum(a, b)[1];
  return e > 0 ? nextUp(s) : s;
}

export function subDown(a, b) { return addDown(a, -b); }
export function subUp(a, b) { return addUp(a, -b); }

// Interval convention: 0 * Infinity = 0, which keeps unbounded intervals usable.
export function mulDown(a, b) {
  if (a === 0 || b === 0) return 0;
  const p = a * b;
  if (!Number.isFinite(p)) return overflowDown(p, Number.isFinite(a) && Number.isFinite(b));
  if (p === 0) return Math.sign(a) * Math.sign(b) > 0 ? 0 : -Number.MIN_VALUE;
  if (!safeForProduct(a, b, p)) return nextDown(p);
  const e = twoProduct(a, b)[1];
  return e < 0 ? nextDown(p) : p;
}

export function mulUp(a, b) {
  if (a === 0 || b === 0) return 0;
  const p = a * b;
  if (!Number.isFinite(p)) return overflowUp(p, Number.isFinite(a) && Number.isFinite(b));
  if (p === 0) return Math.sign(a) * Math.sign(b) > 0 ? Number.MIN_VALUE : 0;
  if (!safeForProduct(a, b, p)) return nextUp(p);
  const e = twoProduct(a, b)[1];
  return e > 0 ? nextUp(p) : p;
}

// Sign of the exact residual a - q*b, used to decide which side of q the true
// quotient a / b lies on. Returns null when the transformation is unsafe.
function quotientErrorSign(a, b, q) {
  if (!safeForProduct(q, b, q * b) || Math.abs(a) < TINY || Math.abs(q) < TINY) return null;
  const [p, e] = twoProduct(q, b);
  const r = (a - p) - e; // a - p is exact because p is within a factor 2 of a
  // a / b - q = r / b
  return Math.sign(r) * Math.sign(b);
}

export function divDown(a, b) {
  const q = a / b;
  if (Number.isNaN(q)) return q;
  if (!Number.isFinite(q)) return overflowDown(q, Number.isFinite(a) && b !== 0);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return q; // finite / inf is exactly 0
  if (a === 0) return q;
  if (q === 0) return Math.sign(a) * Math.sign(b) > 0 ? 0 : -Number.MIN_VALUE;
  const s = quotientErrorSign(a, b, q);
  if (s === null) return nextDown(q);
  return s < 0 ? nextDown(q) : q;
}

export function divUp(a, b) {
  const q = a / b;
  if (Number.isNaN(q)) return q;
  if (!Number.isFinite(q)) return overflowUp(q, Number.isFinite(a) && b !== 0);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return q;
  if (a === 0) return q;
  if (q === 0) return Math.sign(a) * Math.sign(b) > 0 ? Number.MIN_VALUE : 0;
  const s = quotientErrorSign(a, b, q);
  if (s === null) return nextUp(q);
  return s > 0 ? nextUp(q) : q;
}

function sqrtErrorSign(a, s) {
  // sign of a - s^2, which equals the sign of sqrt(a) - s
  if (!safeForProduct(s, s, s * s)) return null;
  const [p, e] = twoProduct(s, s);
  const d = (a - p) - e;
  return Math.sign(d);
}

export function sqrtDown(a) {
  if (a < 0 || Number.isNaN(a)) return NaN;
  if (a === 0 || a === Infinity) return Math.sqrt(a);
  const s = Math.sqrt(a);
  const sg = sqrtErrorSign(a, s);
  if (sg === null) return nextDown(s);
  return sg < 0 ? nextDown(s) : s;
}

export function sqrtUp(a) {
  if (a < 0 || Number.isNaN(a)) return NaN;
  if (a === 0 || a === Infinity) return Math.sqrt(a);
  const s = Math.sqrt(a);
  const sg = sqrtErrorSign(a, s);
  if (sg === null) return nextUp(s);
  return sg > 0 ? nextUp(s) : s;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as r from '../src/round.js';
import { R, radd, rsub, rmul, rdiv, isTightLower, isTightUpper, rng, randomDouble } from './oracle.js';

test('nextUp and nextDown step exactly one ulp', () => {
  assert.equal(r.nextUp(1), 1 + Number.EPSILON);
  assert.equal(r.nextDown(1), 1 - Number.EPSILON / 2);
  assert.equal(r.nextUp(0), Number.MIN_VALUE);
  assert.equal(r.nextDown(0), -Number.MIN_VALUE);
  assert.equal(r.nextUp(-Number.MIN_VALUE), 0);
  assert.equal(r.nextUp(Number.MAX_VALUE), Infinity);
  assert.equal(r.nextDown(-Number.MAX_VALUE), -Infinity);
  assert.equal(r.nextUp(Infinity), Infinity);
  assert.ok(Number.isNaN(r.nextUp(NaN)));
});

test('exact results are not widened', () => {
  assert.equal(r.addDown(1, 2), 3);
  assert.equal(r.addUp(1, 2), 3);
  assert.equal(r.mulDown(3, 0.5), 1.5);
  assert.equal(r.divUp(1, 4), 0.25);
  assert.equal(r.sqrtDown(9), 3);
  assert.equal(r.sqrtUp(2.25), 1.5);
});

test('classic 0.1 + 0.2 is bracketed tightly', () => {
  const q = radd(R(0.1), R(0.2));
  assert.ok(isTightLower(r.addDown(0.1, 0.2), q));
  assert.ok(isTightUpper(r.addUp(0.1, 0.2), q));
  assert.equal(r.addUp(0.1, 0.2) , r.nextUp(r.addDown(0.1, 0.2)));
});

// The central guarantee of the whole library: directed operations return the
// tightest double bound of the exact real result, verified against BigInt
// rational arithmetic on thousands of random operands.
for (const [name, down, up, exact] of [
  ['add', r.addDown, r.addUp, radd],
  ['sub', r.subDown, r.subUp, rsub],
  ['mul', r.mulDown, r.mulUp, rmul],
  ['div', r.divDown, r.divUp, rdiv],
]) {
  test(`${name}Down / ${name}Up are the tightest bounds (rational oracle)`, () => {
    const rand = rng(name.length * 7919);
    for (let i = 0; i < 3000; i++) {
      const a = randomDouble(rand), b = randomDouble(rand);
      const q = exact(R(a), R(b));
      const lo = down(a, b), hi = up(a, b);
      assert.ok(isTightLower(lo, q), `${name}Down(${a}, ${b}) = ${lo}`);
      assert.ok(isTightUpper(hi, q), `${name}Up(${a}, ${b}) = ${hi}`);
    }
  });
}

test('sqrtDown / sqrtUp bracket the exact square root tightly', () => {
  const rand = rng(99);
  for (let i = 0; i < 3000; i++) {
    const a = Math.abs(randomDouble(rand));
    const lo = r.sqrtDown(a), hi = r.sqrtUp(a);
    const A = R(a);
    // lo^2 <= a <= hi^2 and the neighbours violate it
    assert.ok(cmpSq(lo, A) <= 0 && cmpSq(r.nextUp(lo), A) > 0, `sqrtDown(${a})`);
    assert.ok(cmpSq(hi, A) >= 0 && cmpSq(r.nextDown(hi), A) < 0, `sqrtUp(${a})`);
  }
});

function cmpSq(x, A) {
  const X = R(x);
  const [n, d] = rmul(X, X);
  const l = n * A[1], rr = A[0] * d;
  return l < rr ? -1 : l > rr ? 1 : 0;
}

test('extreme ranges stay safe: overflow, underflow, subnormals', () => {
  assert.equal(r.addDown(Number.MAX_VALUE, Number.MAX_VALUE), Number.MAX_VALUE);
  assert.equal(r.addUp(Number.MAX_VALUE, Number.MAX_VALUE), Infinity);
  assert.equal(r.mulDown(1e-200, 1e-200), 0);
  assert.equal(r.mulUp(1e-200, 1e-200), Number.MIN_VALUE);
  assert.equal(r.mulDown(-1e-200, 1e-200), -Number.MIN_VALUE);
  const rand = rng(5);
  for (let i = 0; i < 2000; i++) {
    const a = randomDouble(rand, 1000), b = randomDouble(rand, 1000);
    for (const [down, up, exact] of [[r.mulDown, r.mulUp, rmul], [r.divDown, r.divUp, rdiv]]) {
      const lo = down(a, b), hi = up(a, b);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      const q = exact(R(a), R(b));
      assert.ok(isTightLower(lo, q) || cmpLe(lo, q), `down(${a}, ${b})`);
      assert.ok(isTightUpper(hi, q) || cmpGe(hi, q), `up(${a}, ${b})`);
    }
  }
});

// in the fallback ranges we only promise validity, not tightness
const cmpLe = (d, q) => { const [n, m] = R(d); return n * q[1] <= q[0] * m; };
const cmpGe = (d, q) => { const [n, m] = R(d); return n * q[1] >= q[0] * m; };

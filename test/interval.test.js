import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interval } from '../src/interval.js';
import { R, radd, rsub, rmul, rdiv, cmp, rng } from './oracle.js';

const I = (a, b = a) => new Interval(a, b);

function randomInterval(rand, scale = 10) {
  const a = (rand() * 2 - 1) * scale, b = (rand() * 2 - 1) * scale;
  return I(Math.min(a, b), Math.max(a, b));
}
const sample = (X, rand) => X.lo + (X.hi - X.lo) * rand();

test('construction and basic queries', () => {
  assert.throws(() => I(2, 1));
  assert.throws(() => I(NaN, 1));
  const X = I(-1, 3);
  assert.equal(X.width(), 4);
  assert.equal(X.mid(), 1);
  assert.equal(X.mag(), 3);
  assert.equal(X.mig(), 0);
  assert.equal(I(2, 5).mig(), 2);
  assert.ok(X.contains(0) && !X.contains(3.5));
  assert.ok(X.interiorContains(I(0, 2)) && !X.interiorContains(I(-1, 2)));
  assert.ok(X.intersect(I(5, 6)).isEmpty());
  assert.deepEqual(Interval.hull(I(1, 2), 7, I(-3)).toString(), '[-3, 7]');
  assert.equal(Interval.entire().mid(), 0);
});

// Inclusion property against the exact rational oracle: for random intervals
// and random points inside them, the exact result must lie in the interval
// result. This is the property every algorithm in the library depends on.
for (const [name, op, exact] of [
  ['add', (a, b) => a.add(b), radd],
  ['sub', (a, b) => a.sub(b), rsub],
  ['mul', (a, b) => a.mul(b), rmul],
  ['div', (a, b) => a.div(b), rdiv],
]) {
  test(`inclusion property for ${name} (rational oracle)`, () => {
    const rand = rng(name.charCodeAt(0));
    for (let i = 0; i < 1500; i++) {
      const X = randomInterval(rand), Y = randomInterval(rand);
      if (name === 'div' && Y.contains(0)) continue;
      const Z = op(X, Y);
      for (let k = 0; k < 4; k++) {
        const x = sample(X, rand), y = sample(Y, rand);
        const q = exact(R(x), R(y));
        assert.ok(cmp(R(Z.lo), q) <= 0 && cmp(q, R(Z.hi)) <= 0, `${X} ${name} ${Y} = ${Z} misses ${x},${y}`);
      }
    }
  });
}

test('multiplication covers all sign cases and 0 * inf = 0', () => {
  assert.equal(I(-2, 3).mul(I(-5, 4)).toString(), '[-15, 12]');
  assert.equal(I(-2, -1).mul(I(-3, -2)).toString(), '[2, 6]');
  assert.equal(I(0).mul(Interval.entire()).toString(), '[0, 0]');
});

test('division by an interval containing zero', () => {
  assert.ok(I(1, 2).div(I(-1, 1)).equals(Interval.entire()));
  assert.equal(I(1, 2).div(I(0, 4)).toString(), '[0.25, Infinity]');
  assert.ok(I(1, 2).div(I(0)).isEmpty());
  // extended division keeps the gap
  const parts = I(1, 2).divExtended(I(-1, 4));
  assert.equal(parts.length, 2);
  assert.equal(parts[0].toString(), '[-Infinity, -1]');
  assert.equal(parts[1].toString(), '[0.25, Infinity]');
  assert.equal(I(-2, -1).divExtended(I(-4, 1)).map(String).join(' '), '[-Infinity, -1] [0.25, Infinity]');
  assert.ok(I(-1, 1).divExtended(I(-1, 1))[0].equals(Interval.entire()));
});

test('sqr and even powers are never negative, unlike x*x', () => {
  const X = I(-2, 3);
  assert.equal(X.sqr().toString(), '[0, 9]');
  assert.equal(X.mul(X).toString(), '[-6, 9]');
  assert.equal(X.powi(2).toString(), '[0, 9]');
  assert.equal(X.powi(3).toString(), '[-8, 27]');
  assert.equal(I(-3, -2).powi(4).toString(), '[16, 81]');
  assert.equal(I(2, 4).powi(-1).toString(), '[0.25, 0.5]');
  assert.equal(I(1, 5).powi(0).toString(), '[1, 1]');
});

test('powi encloses exact powers (rational oracle)', () => {
  const rand = rng(3);
  for (let i = 0; i < 500; i++) {
    const X = randomInterval(rand, 3);
    const n = 1 + Math.floor(rand() * 9);
    const P = X.powi(n);
    const x = sample(X, rand);
    let q = [1n, 1n];
    for (let k = 0; k < n; k++) q = rmul(q, R(x));
    assert.ok(cmp(R(P.lo), q) <= 0 && cmp(q, R(P.hi)) <= 0, `${X}^${n}`);
  }
});

test('sqrt, log, exp respect domains', () => {
  assert.equal(I(4, 9).sqrt().toString(), '[2, 3]');
  assert.equal(I(-4, 9).sqrt().toString(), '[0, 3]');
  assert.ok(I(-4, -1).sqrt().isEmpty());
  assert.ok(I(-4, 0).log().isEmpty());
  assert.equal(I(0, 1).log().lo, -Infinity);
  assert.ok(I(0, 1).log().hi >= 0);
  assert.ok(I(-Infinity, 0).exp().contains(I(0, 1)));
  assert.ok(I(1).exp().contains(Math.E));
});

test('transcendental functions contain the sampled values', () => {
  const rand = rng(77);
  const fns = ['exp', 'log', 'sin', 'cos', 'sqrt', 'abs'];
  for (let i = 0; i < 4000; i++) {
    const fn = fns[i % fns.length];
    const X = randomInterval(rand, fn === 'exp' ? 30 : 20);
    const Y = X[fn]();
    const x = sample(X, rand);
    const y = Math[fn](x);
    if (Number.isNaN(y)) continue;
    assert.ok(Y.contains(y), `${fn}(${X}) = ${Y} misses ${fn}(${x}) = ${y}`);
  }
});

test('sin and cos find interior extrema', () => {
  assert.equal(I(1, 2).sin().hi, 1); // contains pi/2
  assert.ok(I(1, 2).sin().lo < Math.sin(1) && I(1, 2).sin().lo > 0.84);
  assert.equal(I(3, 3.5).cos().lo, -1); // contains pi
  assert.ok(I(0.1, 0.2).sin().hi < 0.2); // monotone piece, no spurious extrema
  assert.equal(I(-100, 100).sin().toString(), '[-1, 1]');
  // a tiny interval right at pi/2 must still include the maximum
  const h = Math.PI / 2;
  assert.equal(I(h, h).sin().hi, 1);
});

test('empty propagates through every operation', () => {
  const E = Interval.empty();
  for (const r of [E.add(I(1)), I(1).mul(E), E.div(I(2)), E.sqrt(), E.sin(), E.powi(3)]) {
    assert.ok(r.isEmpty());
  }
});

test('bisect with an off centre ratio keeps both halves inside', () => {
  const [a, b] = I(-1, 1).bisect(0.4870605);
  assert.equal(a.lo, -1); assert.equal(b.hi, 1); assert.equal(a.hi, b.lo);
  assert.ok(a.hi < 0);
});

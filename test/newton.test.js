import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateRoots } from '../src/newton.js';
import { Interval } from '../src/interval.js';

const I = (a, b) => new Interval(a, b);
const unique = (res) => res.roots.filter((r) => r.status === 'unique');

test('cubic with one real root', () => {
  const { roots } = isolateRoots('x^3 - 2*x - 5', I(-10, 10));
  assert.equal(roots.length, 1);
  assert.equal(roots[0].status, 'unique');
  assert.ok(roots[0].box.contains(2.0945514815423265));
  assert.ok(roots[0].box.width() < 1e-14);
});

test('Wilkinson style product: all eight roots proven, none missed', () => {
  const f = '(x-1)*(x-2)*(x-3)*(x-4)*(x-5)*(x-6)*(x-7)*(x-8)';
  const res = isolateRoots(f, I(-20, 20));
  const u = unique(res);
  assert.equal(u.length, 8);
  u.forEach((r, k) => assert.ok(r.box.contains(k + 1), `root ${k + 1} in ${r.box}`));
});

test('sin(x) on [-10, 10] has exactly 7 roots, each enclosing k pi', () => {
  const res = isolateRoots('sin(x)', I(-10, 10));
  const u = unique(res);
  assert.equal(u.length, 7);
  u.forEach((r, i) => {
    const k = i - 3;
    // the box encloses the real k*pi, so it is within an ulp or two of the double
    assert.ok(Math.abs(r.box.mid() - k * Math.PI) <= 4e-15 * Math.max(1, Math.abs(k * Math.PI)));
  });
});

test('no roots is a proof, not a failure to find one', () => {
  const res = isolateRoots('x^2 + 1', I(-100, 100));
  assert.equal(res.roots.length, 0);
  assert.equal(isolateRoots('exp(x)', I(-50, 50)).roots.length, 0);
});

test('transcendental root: exp(x) = 2', () => {
  const [r] = unique(isolateRoots('exp(x) - 2', I(-5, 5)));
  assert.ok(r.box.contains(Math.LN2));
});

test('double root cannot be certified and is reported as possible', () => {
  const { roots } = isolateRoots('x^2 - 2*x + 1', I(-3, 3), { tol: 1e-10 });
  assert.equal(roots.length, 1);
  assert.equal(roots[0].status, 'possible');
  assert.ok(roots[0].box.contains(1));
});

test('two roots 1e-6 apart are separated and both proven', () => {
  const u = unique(isolateRoots('(x - 1)*(x - 1.000001)', I(0, 2)));
  assert.equal(u.length, 2);
  assert.ok(u[0].box.contains(1));
  assert.ok(u[1].box.hi >= 1.000001 - 1e-15 && u[1].box.lo <= 1.000001 + 1e-15);
  assert.ok(u[0].box.hi < u[1].box.lo);
});

test('roots at bisection friendly points such as 0 are still proven', () => {
  const u = unique(isolateRoots('x^3 - x', I(-2, 2)));
  assert.equal(u.length, 3);
  assert.ok(u[1].box.contains(0));
});

test('poles are never mistaken for proven roots', () => {
  const { roots } = isolateRoots('1/x - 1', I(-1, 2));
  const u = roots.filter((r) => r.status === 'unique');
  assert.equal(u.length, 1);
  assert.ok(u[0].box.contains(1));
  // the pole at 0 shows up at most as an undecided sliver
  for (const r of roots.filter((r) => r.status === 'possible')) assert.ok(r.box.contains(0));
});

test('functions with a restricted domain', () => {
  const [r] = unique(isolateRoots('log(x) - 1', I(-5, 5)));
  assert.ok(r.box.contains(Math.E));
  const [s] = unique(isolateRoots('sqrt(x) - 0.5', I(-1, 1)));
  assert.ok(s.box.contains(0.25));
});

test('many roots: sin(1/x) style oscillation is fully counted', () => {
  // roots of sin(10*x) on [0.05, 3]: x = k pi / 10 for k = 1 .. 9
  const u = unique(isolateRoots('sin(10*x)', I(0.05, 3)));
  assert.equal(u.length, 9);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minimize } from '../src/optimize.js';
import { Interval } from '../src/interval.js';

const I = (a, b) => new Interval(a, b);
const inBox = (box, pt) => box.every((x, i) => x.lo - 1e-12 <= pt[i] && pt[i] <= x.hi + 1e-12);

test('six hump camel: known global minimum is bracketed, both minimisers found', () => {
  const f = '4*x^2 - 2.1*x^4 + x^6/3 + x*y - 4*y^2 + 4*y^4';
  const r = minimize(f, ['x', 'y'], [I(-3, 3), I(-2, 2)]);
  const fstar = -1.0316284534898774;
  assert.ok(r.lower <= fstar && fstar <= r.upper, `${r.lower} .. ${r.upper}`);
  assert.ok(r.upper - r.lower < 1e-8);
  assert.equal(r.minimizers.length, 2);
  assert.ok(r.minimizers.some((b) => inBox(b, [0.0898420131003, -0.7126564030207])));
  assert.ok(r.minimizers.some((b) => inBox(b, [-0.0898420131003, 0.7126564030207])));
});

test('Rosenbrock valley', () => {
  const r = minimize('100*(y - x^2)^2 + (1 - x)^2', ['x', 'y'], [I(-2, 2), I(-1, 3)]);
  assert.ok(r.lower <= 0 && r.upper >= 0 && r.upper < 1e-10);
  assert.equal(r.minimizers.length, 1);
  assert.ok(inBox(r.minimizers[0], [1, 1]));
});

test('minimum on the domain boundary is found through the monotonicity test', () => {
  const r = minimize('x + y^2', ['x', 'y'], [I(1, 2), I(-1, 1)]);
  assert.ok(r.lower <= 1 && r.upper >= 1 && r.upper - r.lower < 1e-9);
  assert.ok(r.stats.monotone > 0);
  assert.ok(inBox(r.minimizers[0], [1, 0]));
});

test('many local minima: Rastrigin in 2D', () => {
  const f = '20 + x^2 - 10*cos(2*pi*x) + y^2 - 10*cos(2*pi*y)';
  const r = minimize(f, ['x', 'y'], [I(-5.12, 5.12), I(-5.12, 5.12)], { tol: 1e-5 });
  assert.ok(r.lower <= 0 && 0 <= r.upper && r.upper < 1e-6);
  assert.equal(r.minimizers.length, 1);
  assert.ok(inBox(r.minimizers[0], [0, 0]));
});

test('natural domain edge: the minimiser of sqrt is not discarded', () => {
  const r = minimize('sqrt(x) + 1', ['x'], [I(-1, 1)]);
  assert.ok(r.lower <= 1 && r.upper >= 1);
  assert.ok(r.minimizers.some((b) => b[0].contains(0)));
});

test('ftol stops early but keeps the bounds valid', () => {
  const f = '4*x^2 - 2.1*x^4 + x^6/3 + x*y - 4*y^2 + 4*y^4';
  const r = minimize(f, ['x', 'y'], [I(-3, 3), I(-2, 2)], { ftol: 1e-2 });
  assert.equal(r.complete, false);
  const fstar = -1.0316284534898774;
  assert.ok(r.lower <= fstar && fstar <= r.upper);
  assert.ok(r.upper - r.lower <= 1e-2);
});

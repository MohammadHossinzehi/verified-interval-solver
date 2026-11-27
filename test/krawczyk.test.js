import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveSystem, invert, krawczykStep, compileSystem } from '../src/krawczyk.js';
import { Interval } from '../src/interval.js';

const I = (a, b) => new Interval(a, b);
const contains = (box, pt) => box.every((x, i) => x.contains(pt[i]));

test('approximate inverse', () => {
  const inv = invert([[4, 7], [2, 6]]);
  const expected = [[0.6, -0.7], [-0.2, 0.4]];
  inv.forEach((row, i) => row.forEach((v, j) => assert.ok(Math.abs(v - expected[i][j]) < 1e-12)));
  assert.equal(invert([[1, 2], [2, 4]]), null);
});

test('single Krawczyk step proves existence on a good box', () => {
  const sys = compileSystem('x^2 + y^2 - 1; x - y', ['x', 'y']);
  const r = Math.SQRT1_2;
  const step = krawczykStep(sys, [I(r - 0.01, r + 0.01), I(r - 0.01, r + 0.01)]);
  assert.ok(step.unique);
  const away = krawczykStep(sys, [I(0.1, 0.2), I(0.4, 0.5)]);
  assert.ok(!away.unique);
});

test('circle intersect line: two proven solutions', () => {
  const { solutions } = solveSystem('x^2 + y^2 - 1; x - y', ['x', 'y'], [I(-2, 2), I(-2, 2)]);
  assert.equal(solutions.length, 2);
  for (const s of solutions) assert.equal(s.status, 'unique');
  const r = Math.SQRT1_2;
  assert.ok(contains(solutions[0].box, [-r, -r]));
  assert.ok(contains(solutions[1].box, [r, r]));
  assert.ok(solutions[1].box[0].width() < 1e-13);
});

test('two circles meeting in two points', () => {
  // (x-1)^2 + y^2 = 4 and (x+1)^2 + y^2 = 4 meet at (0, +-sqrt 3)
  const { solutions } = solveSystem('(x-1)^2 + y^2 - 4; (x+1)^2 + y^2 - 4', ['x', 'y'], [I(-3, 3), I(-3, 3)]);
  const u = solutions.filter((s) => s.status === 'unique');
  assert.equal(u.length, 2);
  assert.ok(u.some((s) => contains(s.box, [0, Math.sqrt(3)])));
  assert.ok(u.some((s) => contains(s.box, [0, -Math.sqrt(3)])));
});

test('three unknowns with a transcendental equation', () => {
  const eqs = 'x^2 + y^2 + z^2 - 3; x*y - z; exp(x - 1) - y';
  const { solutions } = solveSystem(eqs, ['x', 'y', 'z'], [I(0.5, 1.5), I(0.5, 1.5), I(0.5, 1.5)]);
  const u = solutions.filter((s) => s.status === 'unique');
  assert.ok(u.length >= 1);
  assert.ok(u.some((s) => contains(s.box, [1, 1, 1])));
});

test('inconsistent system is proven to have no solutions', () => {
  const { solutions } = solveSystem('x^2 + y^2 - 1; x^2 + y^2 - 4', ['x', 'y'], [I(-3, 3), I(-3, 3)], { maxBoxes: 50000 });
  assert.equal(solutions.length, 0);
});

test('wrong number of equations is rejected', () => {
  assert.throws(() => solveSystem('x + y', ['x', 'y'], [I(0, 1), I(0, 1)]), /1 equations in 2 unknowns/);
});

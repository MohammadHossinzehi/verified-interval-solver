import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, compile, variables, literalEnclosure } from '../src/expr.js';
import { Interval } from '../src/interval.js';
import { rng } from './oracle.js';

const I = (a, b = a) => new Interval(a, b);

test('precedence and associativity', () => {
  const f = compile('1 + 2 * 3 ^ 2 - 8 / 4 / 2', []);
  assert.equal(f.float([]), 1 + 2 * 9 - 1);
  assert.equal(compile('-x^2', ['x']).float([3]), -9);
  assert.equal(compile('2^-1', []).float([]), 0.5);
  assert.equal(compile('(1 + 2) * 3', []).float([]), 9);
  assert.equal(compile('+x - -x', ['x']).float([2]), 4);
});

test('functions, constants and variables', () => {
  const f = compile('sin(pi/2) + exp(0) + log(e) + sqrt(16) + abs(-2) + sqr(3)', []);
  assert.ok(Math.abs(f.float([]) - (1 + 1 + 1 + 4 + 2 + 9)) < 1e-12);
  assert.deepEqual(variables(parse('y*x + z - x')), ['y', 'x', 'z']);
  assert.deepEqual(compile('y + x').vars, ['x', 'y']);
});

test('helpful syntax errors', () => {
  assert.throws(() => parse('1 +'), /unexpected 'end of input'/);
  assert.throws(() => parse('foo(1)'), /unknown function 'foo'/);
  assert.throws(() => parse('x ^ 1.5'), /exponent must be an integer/);
  assert.throws(() => parse('(1'), /expected '\)'/);
  assert.throws(() => parse('2 $ 3'), /unexpected character/);
  assert.throws(() => compile('x + y', ['x']), /variable 'y'/);
});

test('decimal literals are enclosed, not rounded', () => {
  const tenth = literalEnclosure('0.1');
  assert.equal(tenth.width() > 0, true);
  assert.equal(tenth.lo, 0.09999999999999999); // nextDown(0.1): 0.1 is above one tenth
  assert.equal(tenth.hi, 0.1);
  assert.ok(literalEnclosure('0.5').isPoint());
  assert.ok(literalEnclosure('1e3').isPoint());
  assert.ok(literalEnclosure('3').isPoint());
  assert.ok(!literalEnclosure('1e-5').isPoint());
  // 10 * 0.1 - 1 is not exactly zero in doubles, but the enclosure must contain 0
  assert.ok(compile('10 * 0.1 - 1', []).interval([]).contains(0));
  // pi enclosure brackets the true value
  const p = compile('pi', []).interval([]);
  assert.ok(p.lo === Math.PI && p.hi > Math.PI);
});

test('interval evaluation encloses float evaluation at sampled points', () => {
  const rand = rng(1);
  const f = compile('x^3 - 2*x*y + sin(x*y) / (1 + y^2) + exp(-x^2)', ['x', 'y']);
  for (let i = 0; i < 500; i++) {
    const a = rand() * 4 - 2, b = rand() * 4 - 2, w = rand();
    const box = [I(Math.min(a, a + w), a + w), I(b, b + w)];
    const F = f.interval(box);
    const x = box[0].lo + rand() * w, y = box[1].lo + rand() * w;
    assert.ok(F.contains(f.float([x, y])));
  }
});

test('interval AD gradients enclose finite difference estimates', () => {
  const f = compile('x^2*y + sin(x) - log(y) + sqrt(x*y) + abs(x - 3)', ['x', 'y']);
  const rand = rng(2);
  for (let i = 0; i < 200; i++) {
    const x = 0.5 + rand() * 2, y = 0.5 + rand() * 2;
    const { v, d } = f.dual([I(x), I(y)]);
    assert.ok(v.contains(f.float([x, y])));
    const h = 1e-6;
    const gx = (f.float([x + h, y]) - f.float([x - h, y])) / (2 * h);
    const gy = (f.float([x, y + h]) - f.float([x, y - h])) / (2 * h);
    assert.ok(Math.abs(gx - d[0].mid()) < 1e-5, `d/dx at ${x},${y}`);
    assert.ok(Math.abs(gy - d[1].mid()) < 1e-5, `d/dy at ${x},${y}`);
  }
  // over a box, the derivative enclosure contains the pointwise derivative
  const g = compile('x^3', ['x']);
  assert.ok(g.dual([I(-1, 2)]).d[0].contains(I(0, 12)));
});

test('mean value form defeats the dependency problem', () => {
  const f = compile('x - x', ['x']);
  assert.equal(f.interval([I(0, 1)]).toString(), '[-1, 1]');
  assert.equal(f.enclose([I(0, 1)]).toString(), '[0, 0]');
  const g = compile('x*(1 - x)', ['x']);
  const nat = g.interval([I(0.4, 0.6)]), mv = g.enclose([I(0.4, 0.6)]);
  assert.ok(mv.width() < nat.width());
  assert.ok(mv.contains(0.25) && mv.contains(0.24));
});

test('isTotal detects poles and domain edges', () => {
  const f = compile('1/x + log(y)', ['x', 'y']);
  assert.equal(f.isTotal([I(1, 2), I(1, 2)]), true);
  assert.equal(f.isTotal([I(-1, 2), I(1, 2)]), false);
  assert.equal(f.isTotal([I(1, 2), I(0, 2)]), false);
  assert.equal(compile('sqrt(x)', ['x']).isTotal([I(0, 1)]), true);
  assert.equal(compile('x^-2', ['x']).isTotal([I(-1, 1)]), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.js';
import { parseBox } from '../src/box.js';

function capture(argv) {
  const lines = [];
  const code = run(argv, (s) => lines.push(s));
  return { code, out: lines.join('\n') };
}

test('box parsing', () => {
  const { vars, box } = parseBox('x=-1.5..2, y = 0..1e3');
  assert.deepEqual(vars, ['x', 'y']);
  assert.equal(box[0].lo, -1.5);
  assert.equal(box[1].hi, 1000);
  assert.throws(() => parseBox('x=2..1'), /bad bounds/);
  assert.throws(() => parseBox('x:1..2'), /expected name=lo..hi/);
});

test('roots command', () => {
  const { code, out } = capture(['roots', 'x^2 - 2', 'x=-3..3']);
  assert.equal(code, 0);
  assert.match(out, /2 root box\(es\)/);
  assert.match(out, /unique\s+\[1\.41421356237309/);
});

test('json output is machine readable', () => {
  const { out } = capture(['roots', 'x^2 - 2', 'x=0..3', '--json']);
  const data = JSON.parse(out);
  assert.equal(data.roots.length, 1);
  assert.ok(data.roots[0].lo <= Math.SQRT2 && Math.SQRT2 <= data.roots[0].hi);
});

test('solve, minimize and eval commands', () => {
  assert.match(capture(['solve', 'x^2 + y^2 - 1; x - y', 'x=-2..2, y=-2..2']).out, /2 solution box/);
  assert.match(capture(['minimize', '(x - 1)^2 + 3', 'x=-5..5']).out, /<= min f <=/);
  assert.match(capture(['eval', 'x - x', 'x=0..1']).out, /mean value.*\[0\.0+, 0\.0+\]/);
  assert.match(capture(['roots', 'x^2 + 1', 'x=-1..1']).out, /proven: no roots/);
});

test('usage on bad input', () => {
  assert.equal(capture([]).code, 2);
  assert.equal(capture(['frobnicate', 'x', 'x=0..1']).code, 2);
});

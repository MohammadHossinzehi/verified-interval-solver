// Boxes are arrays of Intervals, one per variable.

import { Interval } from './interval.js';

export const width = (box) => Math.max(...box.map((x) => x.width()));
export const mid = (box) => box.map((x) => x.mid());
export const isEmpty = (box) => box.some((x) => x.isEmpty());
export const intersect = (a, b) => a.map((x, i) => x.intersect(b[i]));
export const interiorContains = (outer, inner) => outer.every((x, i) => x.interiorContains(inner[i]));
export const hull = (a, b) => a.map((x, i) => Interval.hull(x, b[i]));

/** Bisect along the widest coordinate. */
export function bisect(box, ratio = 0.5) {
  let k = 0;
  for (let i = 1; i < box.length; i++) if (box[i].width() > box[k].width()) k = i;
  const [a, b] = box[k].bisect(ratio);
  const left = box.slice(), right = box.slice();
  left[k] = a; right[k] = b;
  return [left, right];
}

export const toString = (box, digits) => box.map((x) => x.toString(digits)).join(' x ');

/**
 * Parse "x=-1..2, y=0..3" (or an array of such strings) into { vars, box }.
 * Bounds may be any JS numeric literal.
 */
export function parseBox(spec) {
  const parts = (Array.isArray(spec) ? spec : String(spec).split(','))
    .map((s) => s.trim()).filter(Boolean);
  const vars = [], box = [];
  for (const p of parts) {
    const m = /^([A-Za-z_]\w*)\s*=\s*(\S+?)\s*\.\.\s*(\S+)$/.exec(p);
    if (!m) throw new SyntaxError(`bad box component '${p}', expected name=lo..hi`);
    const lo = Number(m[2]), hi = Number(m[3]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
      throw new RangeError(`bad bounds in '${p}'`);
    }
    vars.push(m[1]);
    box.push(new Interval(lo, hi));
  }
  return { vars, box };
}

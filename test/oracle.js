// Exact rational arithmetic used as a ground truth oracle in the tests.
import { doubleToRational, cmpRational } from '../src/expr.js';
import { nextUp, nextDown } from '../src/round.js';

export const R = (x) => doubleToRational(x);
const norm = ([n, d]) => (d < 0n ? [-n, -d] : [n, d]);
export const radd = ([a, b], [c, d]) => [a * d + c * b, b * d];
export const rsub = ([a, b], [c, d]) => [a * d - c * b, b * d];
export const rmul = ([a, b], [c, d]) => [a * c, b * d];
export const rdiv = ([a, b], [c, d]) => norm([a * d, b * c]);
export const cmp = cmpRational;

/** d is the largest double <= q */
export function isTightLower(d, q) {
  return cmp(R(d), q) <= 0 && (nextUp(d) === Infinity || cmp(R(nextUp(d)), q) > 0);
}
/** d is the smallest double >= q */
export function isTightUpper(d, q) {
  return cmp(R(d), q) >= 0 && (nextDown(d) === -Infinity || cmp(R(nextDown(d)), q) < 0);
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
export function rng(seed = 12345) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random doubles spread over many binades and both signs. */
export function randomDouble(rand, maxExp = 60) {
  const e = Math.floor(rand() * 2 * maxExp) - maxExp;
  const s = rand() < 0.5 ? -1 : 1;
  return s * (1 + rand()) * 2 ** e;
}

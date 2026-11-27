// Expression language: a small parser that produces an AST, plus one generic
// evaluator that is parameterised by an "algebra". The same tree can be
// evaluated in plain doubles, in interval arithmetic, or in interval forward
// mode automatic differentiation without duplicating the tree walking code.
//
// Grammar
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-' unary | '+' unary | power
//   power   := primary ('^' signedInt)?
//   primary := number | name | name '(' expr ')' | '(' expr ')'
//
// Literals are enclosed rigorously: "0.1" is not a double, so it becomes the
// tightest interval around one tenth instead of being silently rounded.

import { Interval } from './interval.js';
import { nextUp, nextDown } from './round.js';

export const FUNCTIONS = ['sin', 'cos', 'exp', 'log', 'sqrt', 'abs', 'sqr'];
export const CONSTANTS = {
  // Math.PI < pi < nextUp(Math.PI), Math.E < e < nextUp(Math.E)
  pi: { approx: Math.PI, enclosure: new Interval(Math.PI, nextUp(Math.PI)) },
  e: { approx: Math.E, enclosure: new Interval(Math.E, nextUp(Math.E)) },
};

// ---- tokenizer -------------------------------------------------------------

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(\S))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m) break;
    if (m[1] !== undefined) tokens.push({ type: 'num', text: m[1], pos: start });
    else if (m[2] !== undefined) tokens.push({ type: 'name', text: m[2], pos: start });
    else if (m[3] !== undefined) {
      if (!'+-*/^(),'.includes(m[3])) throw new SyntaxError(`unexpected character '${m[3]}' at ${start}`);
      tokens.push({ type: 'op', text: m[3], pos: start });
    }
  }
  tokens.push({ type: 'eof', text: '', pos: src.length });
  return tokens;
}

// ---- exact decimal literal enclosure ---------------------------------------

const pow10 = (k) => 10n ** BigInt(k);

/** Exact rational value of a double as [numerator, denominator] BigInts. */
export function doubleToRational(x) {
  if (!Number.isFinite(x)) throw new RangeError('not finite');
  if (x === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const bits = dv.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const exp = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & ((1n << 52n) - 1n);
  let e2;
  if (exp === 0) e2 = -1074; else { mant |= 1n << 52n; e2 = exp - 1075; }
  if (e2 >= 0) return [sign * mant * (1n << BigInt(e2)), 1n];
  return [sign * mant, 1n << BigInt(-e2)];
}

/** Compare rationals a/b and c/d with positive denominators. */
export function cmpRational([a, b], [c, d]) {
  const l = a * d, r = c * b;
  return l < r ? -1 : l > r ? 1 : 0;
}

function decimalToRational(text) {
  const [mantissa, expPart] = text.toLowerCase().split('e');
  const [intPart, fracPart = ''] = mantissa.split('.');
  let num = BigInt((intPart || '0') + fracPart);
  let exp = (expPart ? parseInt(expPart, 10) : 0) - fracPart.length;
  if (exp >= 0) return [num * pow10(exp), 1n];
  return [num, pow10(-exp)];
}

/** Tightest interval of doubles around the decimal literal. */
export function literalEnclosure(text) {
  const approx = Number(text);
  if (!Number.isFinite(approx)) return new Interval(Number.MAX_VALUE, Infinity);
  const exact = decimalToRational(text);
  const c = cmpRational(doubleToRational(approx), exact);
  if (c === 0) return Interval.point(approx);
  return c < 0 ? new Interval(approx, nextUp(approx)) : new Interval(nextDown(approx), approx);
}

// ---- parser ---------------------------------------------------------------

export function parse(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (text) => {
    const t = next();
    if (t.text !== text) throw new SyntaxError(`expected '${text}' at ${t.pos}, found '${t.text || 'end of input'}'`);
  };

  function expr() {
    let node = term();
    while (peek().text === '+' || peek().text === '-') {
      const op = next().text;
      node = { type: op === '+' ? 'add' : 'sub', a: node, b: term() };
    }
    return node;
  }
  function term() {
    let node = unary();
    while (peek().text === '*' || peek().text === '/') {
      const op = next().text;
      node = { type: op === '*' ? 'mul' : 'div', a: node, b: unary() };
    }
    return node;
  }
  function unary() {
    if (peek().text === '-') { next(); return { type: 'neg', a: unary() }; }
    if (peek().text === '+') { next(); return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek().text !== '^') return base;
    next();
    let sign = 1;
    if (peek().text === '-') { next(); sign = -1; }
    const t = next();
    if (t.type !== 'num' || !/^\d+$/.test(t.text)) {
      throw new SyntaxError(`exponent must be an integer literal at ${t.pos}`);
    }
    return { type: 'pow', a: base, n: sign * parseInt(t.text, 10) };
  }
  function primary() {
    const t = next();
    if (t.type === 'num') {
      return { type: 'const', value: Number(t.text), enclosure: literalEnclosure(t.text), text: t.text };
    }
    if (t.type === 'name') {
      if (peek().text === '(') {
        if (!FUNCTIONS.includes(t.text)) throw new SyntaxError(`unknown function '${t.text}' at ${t.pos}`);
        next();
        const arg = expr();
        expect(')');
        return { type: 'call', fn: t.text, a: arg };
      }
      if (t.text in CONSTANTS) {
        const c = CONSTANTS[t.text];
        return { type: 'const', value: c.approx, enclosure: c.enclosure, text: t.text };
      }
      return { type: 'var', name: t.text };
    }
    if (t.text === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    throw new SyntaxError(`unexpected '${t.text || 'end of input'}' at ${t.pos}`);
  }

  const tree = expr();
  if (peek().type !== 'eof') throw new SyntaxError(`unexpected '${peek().text}' at ${peek().pos}`);
  return tree;
}

/** Variable names in order of first appearance. */
export function variables(tree) {
  const seen = [];
  (function walk(n) {
    if (n.type === 'var') { if (!seen.includes(n.name)) seen.push(n.name); return; }
    if (n.a) walk(n.a);
    if (n.b) walk(n.b);
  })(tree);
  return seen;
}

// ---- algebras ---------------------------------------------------------------

export const FloatAlgebra = {
  constant: (node) => node.value,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  neg: (a) => -a,
  pow: (a, n) => a ** n,
  call: (fn, a) => (fn === 'sqr' ? a * a : Math[fn](a)),
};

export const IntervalAlgebra = {
  constant: (node) => node.enclosure,
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  div: (a, b) => a.div(b),
  neg: (a) => a.neg(),
  pow: (a, n) => a.powi(n),
  call: (fn, a) => a[fn](),
};

/**
 * Interval forward mode AD: values are { v: Interval, d: Interval[] }. The d
 * components enclose every partial derivative over the box, i.e. this produces
 * an interval Jacobian row, which is exactly what Newton and Krawczyk need.
 * For abs we use the Clarke generalised derivative, the hull of {-1, 1} at 0.
 */
export function makeDualAlgebra(nvars) {
  const zero = () => new Array(nvars).fill(Interval.point(0));
  const map = (d, f) => d.map(f);
  return {
    constant: (node) => ({ v: node.enclosure, d: zero() }),
    add: (a, b) => ({ v: a.v.add(b.v), d: a.d.map((x, i) => x.add(b.d[i])) }),
    sub: (a, b) => ({ v: a.v.sub(b.v), d: a.d.map((x, i) => x.sub(b.d[i])) }),
    mul: (a, b) => ({
      v: a.v.mul(b.v),
      d: a.d.map((x, i) => x.mul(b.v).add(a.v.mul(b.d[i]))),
    }),
    div: (a, b) => {
      const q = a.v.div(b.v);
      return { v: q, d: a.d.map((x, i) => x.sub(q.mul(b.d[i])).div(b.v)) };
    },
    neg: (a) => ({ v: a.v.neg(), d: map(a.d, (x) => x.neg()) }),
    pow: (a, n) => {
      if (n === 0) return { v: Interval.point(1), d: zero() };
      const k = a.v.powi(n - 1).mul(Interval.point(n));
      return { v: a.v.powi(n), d: map(a.d, (x) => x.mul(k)) };
    },
    call: (fn, a) => {
      const v = a.v[fn]();
      let k;
      switch (fn) {
        case 'sin': k = a.v.cos(); break;
        case 'cos': k = a.v.sin().neg(); break;
        case 'exp': k = v; break;
        case 'log': k = a.v.recip(); break;
        case 'sqrt': k = v.mul(Interval.point(2)).recip(); break;
        case 'sqr': k = a.v.mul(Interval.point(2)); break;
        case 'abs':
          k = a.v.lo > 0 ? Interval.point(1) : a.v.hi < 0 ? Interval.point(-1) : new Interval(-1, 1);
          break;
        default: throw new Error(`no derivative rule for ${fn}`);
      }
      return { v, d: map(a.d, (x) => x.mul(k)) };
    },
  };
}

/**
 * True when every operation in the tree is applied to an argument that lies
 * entirely inside its domain over the box (no division by an interval that
 * contains zero, no log of a nonpositive number, ...). Interval evaluation is
 * always a valid enclosure of the range over the *defined* part of a box, but
 * mean value arguments (Newton, Krawczyk, monotonicity) additionally need f to
 * be continuous on the whole box, which is exactly what this certifies.
 */
export function isTotalOn(tree, env) {
  let ok = true;
  const A = {
    ...IntervalAlgebra,
    div: (a, b) => { if (b.contains(0)) ok = false; return a.div(b); },
    pow: (a, n) => { if (n < 0 && a.contains(0)) ok = false; return a.powi(n); },
    call: (fn, a) => {
      if (fn === 'log' && !(a.lo > 0)) ok = false;
      if (fn === 'sqrt' && !(a.lo >= 0)) ok = false;
      return a[fn]();
    },
  };
  const v = evaluate(tree, A, env);
  return ok && !v.isEmpty();
}

/** Evaluate a tree in an algebra. env maps variable names to algebra values. */
export function evaluate(tree, algebra, env) {
  function ev(n) {
    switch (n.type) {
      case 'const': return algebra.constant(n);
      case 'var':
        if (!(n.name in env)) throw new ReferenceError(`unbound variable '${n.name}'`);
        return env[n.name];
      case 'add': return algebra.add(ev(n.a), ev(n.b));
      case 'sub': return algebra.sub(ev(n.a), ev(n.b));
      case 'mul': return algebra.mul(ev(n.a), ev(n.b));
      case 'div': return algebra.div(ev(n.a), ev(n.b));
      case 'neg': return algebra.neg(ev(n.a));
      case 'pow': return algebra.pow(ev(n.a), n.n);
      case 'call': return algebra.call(n.fn, ev(n.a));
      default: throw new Error(`unknown node ${n.type}`);
    }
  }
  return ev(tree);
}

/**
 * Compile source text into a function object over a fixed variable order:
 *   f.float(xs)      double evaluation
 *   f.interval(box)  interval enclosure of the range over the box
 *   f.dual(box)      { v, d } enclosure of value and gradient over the box
 */
export function compile(src, vars) {
  const tree = typeof src === 'string' ? parse(src) : src;
  const names = vars ?? variables(tree).sort();
  for (const v of variables(tree)) {
    if (!names.includes(v)) throw new ReferenceError(`variable '${v}' is not in [${names.join(', ')}]`);
  }
  const dual = makeDualAlgebra(names.length);
  const envOf = (values) => Object.fromEntries(names.map((n, i) => [n, values[i]]));
  const dualEnv = (box) => envOf(box.map((x, i) => ({
    v: x,
    d: names.map((_, j) => Interval.point(i === j ? 1 : 0)),
  })));

  /**
   * Natural extension intersected with the mean value form
   *     f(X) ⊆ f(m) + sum_i F_i'(X) (X_i - m_i).
   * The natural extension suffers from the dependency problem (x - x over
   * [0, 1] gives [-1, 1]); the mean value form overestimates by O(w^2)
   * instead of O(w), so on small boxes it is dramatically tighter.
   */
  function enclose(box) {
    const nat = evaluate(tree, IntervalAlgebra, envOf(box));
    if (nat.isEmpty() || !isTotalOn(tree, envOf(box))) return nat;
    const m = box.map((x) => Interval.point(x.mid()));
    const fm = evaluate(tree, IntervalAlgebra, envOf(m));
    const g = evaluate(tree, dual, dualEnv(box)).d;
    if (fm.isEmpty() || g.some((gi) => gi.isEmpty() || !gi.isBounded())) return nat;
    let mv = fm;
    for (let i = 0; i < box.length; i++) mv = mv.add(g[i].mul(box[i].sub(m[i])));
    const both = nat.intersect(mv);
    return both.isEmpty() ? nat : both;
  }

  return {
    source: typeof src === 'string' ? src : '<tree>',
    tree,
    vars: names,
    float: (xs) => evaluate(tree, FloatAlgebra, envOf(xs)),
    interval: (box) => evaluate(tree, IntervalAlgebra, envOf(box)),
    isTotal: (box) => isTotalOn(tree, envOf(box)),
    enclose: (box) => enclose(box),
    dual: (box) => evaluate(tree, dual, dualEnv(box)),
  };
}

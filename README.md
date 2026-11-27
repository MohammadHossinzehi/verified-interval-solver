# verified-interval-solver

Root finding, nonlinear systems and global optimisation whose answers are **proofs**, not guesses. Written in plain JavaScript with zero dependencies.

Ordinary numerical solvers return a number and hope. Newton's method can jump past a root, `fsolve` can converge to the same solution twice and miss a third, and a local optimiser happily reports a local minimum as the answer. This library uses outward rounded interval arithmetic so that every claim it makes is mathematically guaranteed, including the claims about what is *not* there:

```
$ node src/cli.js roots "sin(x)" "x=-10..10"
7 root box(es) for sin(x) on [-10, 10]
  unique   [-9.4247779607693811, -9.4247779607693793]  width 1.78e-15
  unique   [-6.2831853071795871, -6.2831853071795862]  width 8.88e-16
  unique   [-3.1415926535897936, -3.1415926535897931]  width 4.44e-16
  unique   [-8.2718061255302767e-25, 1.6543612251060553e-24]  width 2.48e-24
  unique   [3.1415926535897931, 3.1415926535897936]  width 4.44e-16
  unique   [6.2831853071795862, 6.2831853071795871]  width 8.88e-16
  unique   [9.4247779607693793, 9.4247779607693811]  width 1.78e-15
```

Each `unique` box provably contains exactly one root, and the union of the reported boxes provably contains every root in the search interval. The output above is a theorem: sin has exactly seven zeros in [-10, 10], and the true value of 3π lies between those two doubles.

## What is inside

| Module | What it does |
| --- | --- |
| `src/round.js` | Correctly rounded *directed* `+ − × ÷ √` on top of JavaScript's round to nearest, using TwoSum and Dekker's TwoProduct to detect the sign of the rounding error exactly. |
| `src/interval.js` | Interval type with the inclusion property for arithmetic, integer powers, `sqrt`, `exp`, `log`, `sin`, `cos`, `abs`, and Kahan's extended division (division by an interval containing zero returns two pieces). |
| `src/expr.js` | Expression parser plus a single evaluator parameterised by an *algebra*: the same tree runs in doubles, in intervals, or in interval forward mode automatic differentiation. Also the mean value form and a domain totality check. |
| `src/newton.js` | Univariate interval Newton with extended division, root existence and uniqueness proofs, quadratic polishing, and clustering of undecidable multiple roots. |
| `src/krawczyk.js` | Krawczyk operator with branch and bound for square nonlinear systems in any number of unknowns. |
| `src/optimize.js` | Global minimisation by interval branch and bound (Moore Skelboe with Hansen's monotonicity test) with guaranteed lower and upper bounds on the global minimum. |
| `src/cli.js` | Command line front end with human and `--json` output. |
| `demo/index.html` | Browser demo that plots a function, its interval enclosures and the certified roots. |

## Running it

Requires Node 18 or newer. There is nothing to install.

```bash
git clone https://github.com/MohammadHossinzehi/verified-interval-solver
cd verified-interval-solver
npm test                      # 61 tests, about 2 seconds

# every root of a function on an interval
node src/cli.js roots "x^3 - 2*x - 5" "x=-10..10"

# every solution of a system (equations separated by ';')
node src/cli.js solve "x^2 + y^2 - 1; x - y" "x=-2..2, y=-2..2"

# certified global minimum
node src/cli.js minimize "4*x^2 - 2.1*x^4 + x^6/3 + x*y - 4*y^2 + 4*y^4" "x=-3..3, y=-2..2"

# range enclosure, natural form versus mean value form
node src/cli.js eval "x*(1 - x)" "x=0.4..0.6"
```

Add `--json` to any command for machine readable output, `--tol` to change the target box width, and for `minimize`, `--ftol` to stop as soon as the gap between the bounds is small enough.

The demo uses ES modules, so serve the folder rather than opening the file directly:

```bash
npm run demo          # or any static server
# then open http://localhost:8000/demo/
```

### Library use

```js
import { isolateRoots, solveSystem, minimize, Interval, compile } from './src/index.js';

const { roots } = isolateRoots('exp(x) - 2', new Interval(-5, 5));
roots[0].status;          // 'unique'
roots[0].box.contains(Math.LN2); // true, and the box is a few ulps wide

const f = compile('x - x', ['x']);
f.interval([new Interval(0, 1)]).toString(); // '[-1, 1]'  natural extension
f.enclose([new Interval(0, 1)]).toString();  // '[0, 0]'   with mean value form

const r = minimize('100*(y - x^2)^2 + (1 - x)^2', ['x', 'y'],
                   [new Interval(-2, 2), new Interval(-1, 3)]);
// r.lower <= global minimum <= r.upper, r.minimizers encloses (1, 1)
```

Expressions support `+ − * / ^` (integer exponents), parentheses, the functions `sin cos exp log sqrt abs sqr`, and the constants `pi` and `e`.

## How the guarantees are earned

**Directed rounding without a rounding mode.** JavaScript has no `fesetround`. Instead of blindly widening every result by one ulp, `round.js` computes the round to nearest result and then recovers the exact rounding error with an error free transformation: TwoSum for addition, Veltkamp splitting plus Dekker's TwoProduct for multiplication, and the exact residual `a − q·b` for division and `a − s²` for square roots. Only the *sign* of the error is needed to decide whether to step one ulp, and that sign is always exact. The result is the tightest double bound, and the tests check this against an exact BigInt rational oracle on thousands of random operands across 120 binades. Near overflow or deep in the subnormal range, where the transformations break down, the code falls back to a safe one ulp widening.

**Literals are enclosed too.** `0.1` is not a double, so the parser turns it into the two doubles that bracket one tenth, decided exactly by comparing the decimal literal and the double as rationals. Likewise `pi` is `[Math.PI, nextUp(Math.PI)]`. A verified solver that silently rounded its own input would not be verified.

**Interval Newton.** For a box X with midpoint m, `N(X) = m − f(m) / F'(X)` contains every root of f in X. If `N(X) ∩ X` is empty the box is root free. If `N(X)` lies strictly inside X, Brouwer's fixed point theorem gives existence and the derivative enclosure excluding zero gives uniqueness. When `F'(X)` contains zero, extended division splits N(X) into two pieces, which separates neighbouring roots without blind bisection. Once a root is proven, further Newton steps contract the box quadratically down to a few ulps.

**Krawczyk for systems.** `K(X) = y − Y f(y) + (I − Y F'(X))(X − y)` with `Y` an approximate inverse of the midpoint Jacobian. The preconditioner is computed in ordinary floating point because it does not need to be accurate: only the interval evaluation of K has to be rigorous. `K(X)` strictly inside X proves a unique solution in X.

**Branch and bound optimisation.** Boxes sit in a priority queue ordered by their lower bound. The best verified function value at any box midpoint gives an upper bound, every box whose lower bound exceeds it is discarded, and a box on which some partial derivative has constant sign is either discarded or collapsed onto the domain face where the minimum must lie. Lower bounds use the natural extension intersected with the mean value form, so they converge quadratically as boxes shrink.

## Design decisions worth calling out

**One evaluator, three algebras.** The expression tree is walked by a single `evaluate` function that delegates every operation to an algebra object. Doubles, intervals and interval dual numbers are each about a dozen lines. Adding a new function means adding one case to each algebra rather than touching three tree walkers.

**Totality checks before mean value arguments.** Interval evaluation is valid over the defined part of a box, but Newton, Krawczyk and the monotonicity test rely on the mean value theorem, which needs continuity over the whole box. `isTotal` certifies that no division, `log`, `sqrt` or negative power touches the edge of its domain. Without it, `1/x − 1` on `[−1, 2]` would let a Newton step jump straight across the pole, and `sqrt(x)` on `[−1, 1]` would have its true minimiser at 0 discarded by the monotonicity test. Both cases are in the test suite.

**Off centre bisection.** Solvers bisect at ratio 0.4870605 instead of 0.5. With exact halving, a root at a round number such as 0 sits on a box edge forever and no interior test can certify it. With the off centre split the root of `x³ − x` at 0 is proven like any other.

**Honest failure.** A double root such as `(x − 1)²` cannot be certified by any method that works with floating point enclosures, because arbitrarily small perturbations split it or remove it. The solver reports a `possible` box of width about 1e-9 that is guaranteed to contain it, rather than pretending to a precision it does not have. Clusters of undecided slivers are merged into one hull before reporting.

## Assumptions

Arithmetic and `sqrt` are rigorous by construction. `exp`, `log`, `sin` and `cos` rely on the platform's math library being accurate to within one ulp, which holds for the fdlibm derived implementations in V8 and SpiderMonkey; results are widened by one ulp on each side to cover that error. Range reduction for `sin` and `cos` includes an extremum whenever it *might* be inside the interval, so floating point error in locating multiples of π can only widen a result, never shrink it. Box bounds given on the command line are taken as doubles, which defines the searched box exactly.

## Testing

`npm test` runs 61 tests using the built in `node:test` runner.

The heart of the suite is oracle testing against exact BigInt rational arithmetic (`test/oracle.js`). Directed operations are checked to be the *tightest* bound, not merely a valid one, and interval operations are checked for the inclusion property at random points of random intervals. On top of that the solvers are tested on problems with known answers: a Wilkinson style product with eight roots, all seven zeros of sin on [−10, 10], roots 1e-6 apart, poles, restricted domains, a double root, circle and line intersections, a three unknown transcendental system, an inconsistent system proven empty, and the six hump camel, Rosenbrock and Rastrigin optimisation benchmarks where the known global minimum must fall between the reported bounds. Gradients from the AD algebra are cross checked against central finite differences.

## License

MIT

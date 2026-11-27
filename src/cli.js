#!/usr/bin/env node
// Command line front end.
//
//   node src/cli.js eval     "<expr>" "x=lo..hi, ..."
//   node src/cli.js roots    "<expr>" "x=lo..hi"        [--tol 1e-12]
//   node src/cli.js solve    "<f1>; <f2>" "x=..,y=.."   [--tol 1e-10]
//   node src/cli.js minimize "<expr>" "x=..,y=.."       [--tol 1e-6]
//   add --json for machine readable output

import { compile } from './expr.js';
import { isolateRoots } from './newton.js';
import { solveSystem } from './krawczyk.js';
import { minimize } from './optimize.js';
import { parseBox, toString as boxString } from './box.js';

const USAGE = `usage:
  verified eval     "<expr>" "x=lo..hi, y=lo..hi"
  verified roots    "<expr>" "x=lo..hi"            [--tol T]
  verified solve    "<f1>; <f2>" "x=lo..hi, y=..." [--tol T]
  verified minimize "<expr>" "x=lo..hi, y=..."     [--tol T] [--ftol T]
options: --json  --digits N`;

export function run(argv, log = console.log) {
  const args = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--tol' || a === '--ftol' || a === '--digits') flags[a.slice(2)] = Number(argv[++i]);
    else if (a === '-h' || a === '--help') { log(USAGE); return 0; }
    else args.push(a);
  }
  const [cmd, expr, boxSpec] = args;
  if (!cmd || !expr || !boxSpec) { log(USAGE); return 2; }
  const { vars, box } = parseBox(boxSpec);
  const digits = flags.digits ?? 17;
  const ivl = (x) => ({ lo: x.lo, hi: x.hi });

  switch (cmd) {
    case 'eval': {
      const f = compile(expr, vars);
      const r = f.interval(box);
      const mv = f.enclose(box);
      if (flags.json) log(JSON.stringify({ natural: ivl(r), meanValue: ivl(mv) }));
      else {
        log(`natural extension   f(${boxString(box)}) ⊆ ${r.toString(digits)}`);
        log(`with mean value     f(${boxString(box)}) ⊆ ${mv.toString(digits)}`);
      }
      return 0;
    }
    case 'roots': {
      if (vars.length !== 1) throw new Error('roots expects exactly one variable');
      const { roots, stats } = isolateRoots(compile(expr, vars), box[0], { tol: flags.tol });
      if (flags.json) { log(JSON.stringify({ roots: roots.map((r) => ({ ...ivl(r.box), status: r.status })), stats })); return 0; }
      log(`${roots.length} root box(es) for ${expr} on ${box[0]}`);
      for (const r of roots) log(`  ${r.status.padEnd(8)} ${r.box.toString(digits)}  width ${r.box.width().toExponential(2)}`);
      if (!roots.length) log('  proven: no roots in the interval');
      log(`  (${stats.boxes} boxes, ${stats.newtonSteps} Newton steps, ${stats.bisections} bisections)`);
      return 0;
    }
    case 'solve': {
      const { solutions, stats } = solveSystem(expr, vars, box, { tol: flags.tol });
      if (flags.json) { log(JSON.stringify({ vars, solutions: solutions.map((s) => ({ box: s.box.map(ivl), status: s.status })), stats })); return 0; }
      log(`${solutions.length} solution box(es) in ${vars.join(', ')}`);
      for (const s of solutions) log(`  ${s.status.padEnd(8)} ${boxString(s.box, digits)}`);
      if (!solutions.length) log('  proven: no solutions in the box');
      log(`  (${stats.boxes} boxes, ${stats.krawczyk} Krawczyk steps, ${stats.bisections} bisections)`);
      return 0;
    }
    case 'minimize': {
      const r = minimize(expr, vars, box, { tol: flags.tol, ftol: flags.ftol });
      if (flags.json) {
        log(JSON.stringify({ lower: r.lower, upper: r.upper, argmin: r.argmin, minimizers: r.minimizers.map((b) => b.map(ivl)), complete: r.complete, stats: r.stats }));
        return 0;
      }
      log(`global minimum of ${expr}`);
      log(`  ${r.lower.toPrecision(digits)} <= min f <= ${r.upper.toPrecision(digits)}`);
      log(`  best point (${r.argmin.map((v) => v.toPrecision(12)).join(', ')})`);
      log(`  ${r.minimizers.length} candidate minimiser region(s):`);
      for (const b of r.minimizers) log(`    ${boxString(b, 10)}`);
      if (!r.complete) log('  note: search stopped early (ftol or box limit); the bounds are still valid');
      return 0;
    }
    default:
      log(USAGE);
      return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('verified')) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  }
}

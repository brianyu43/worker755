// Entry point. Before any other module loads, switch V8 to its linear-time regex engine whenever a
// pattern backtracks too much: players type grep patterns, SQL LIKE/GLOB and globs, and one
// catastrophic pattern would otherwise freeze the single thread every game shares.
import v8 from 'node:v8';

v8.setFlagsFromString('--enable-experimental-regexp-engine-on-excessive-backtracks');

await import('./main.ts');

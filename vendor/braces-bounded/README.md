# Bounded braces fork (MIT)

This is an actual source fork of `braces@3.0.3`, not a package-name-only audit
workaround. Upstream author/contributors and MIT LICENSE are retained. Local
security modifications are maintained by the GarageFlows repository, not upstream.

## Provenance

- Registry archive: https://registry.npmjs.org/braces/-/braces-3.0.3.tgz
- Upstream: https://github.com/micromatch/braces
- Archive SHA-1: `490332f40919452272d55a8480adc0c441358789`
- Registry SRI: `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`
- Advisory addressed: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- `upstream-hashes.json` records SHA-256 for the original archive source files.

## Changes and compatibility boundary

1. Parser nesting is capped at 64 before recursive upstream cleanup/walkers.
2. Caller-provided ASTs are checked iteratively: maximum depth 64, 65,536
   scheduled/visited nodes, bounded value lengths/bytes and acyclic parent chains.
   Expected `parent`/`prev` back-references are not traversed as child nodes.
3. Expansion and top-level pattern arrays are bounded to 10,000 strings and 8 MiB at flatten/append/aggregate boundaries.
   Nested results and early-return branches are included in accounting.
4. Range operations cap generated cardinality at 1,000, including descending,
   character and stepped ranges. Unsafe integer endpoints/steps are rejected.
   The explicit third range argument is accounted for, not displaced by the
   options argument. `rangeLimit: false` cannot remove the security cap.
5. Iterative bounded flatten replaces the recursive flatten helper; upstream's
   stray diagnostic logging is removed.

These are intentional restrictions: deeply nested or large otherwise-valid
patterns now throw RangeError. Existing upstream input-length restrictions stay
in place. This is not unlimited API compatibility and not an independent security
certification. Inputs beyond the bounds must not be silently caught or retried
with the vulnerable implementation.

## Reproduce

`npm ci --ignore-scripts` then `npm run test:audit` tests JS dependency integrity
without requiring Electron/Prisma downloads. Normal installation/build/integration
jobs still run their install hooks; this command does not replace their validation.
The fork is an explicit local dev dependency **and** a global braces override so
npm installs `fill-range` for linked packages in clean installs.

`tests/fixtures/braces-upstream.json` contains 4,653 output/error vectors generated
from the pristine archive, using 517 fixed/seeded patterns, three public operations
and three option sets. Node tests compare this fork with those fixed results and
exercise nesting, cyclic ASTs, Cartesian growth, bytes, descending/stepped/Unicode
ranges and unsafe numbers. Regression tests exposed and corrected a stepped-range
limit bypass during development. Tests of inputs capable of exhausting memory
should always run under a process-level memory/time budget.

Tailwind/ESLint run on the real repository as additional compatibility checks.
New advisories for this private name will not be mapped by npm automatically:
upstream braces advisories must also be monitored manually. Replace this fork with
an independently reviewed maintained upstream fix when one becomes available.

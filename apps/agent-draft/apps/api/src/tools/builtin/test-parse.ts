export interface TestSummary {
  framework: string;
  total: number | null;
  passed: number | null;
  failed: number | null;
  text: string;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replace(ANSI, '');

/** Best-effort parse of common test runner summaries. Unknown formats fall back to the exit code. */
export function parseTestSummary(rawOutput: string, exitCode: number | null): TestSummary {
  const out = strip(rawOutput);
  let m: RegExpExecArray | null;

  // Vitest: "Tests  3 passed | 1 failed (4)" / "Tests  4 passed (4)"
  if ((m = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?.*?\((\d+)\)/.exec(out))) {
    const failed = Number(m[1] ?? m[3] ?? 0);
    const total = Number(m[4]);
    return done('vitest', total, Number(m[2]), failed);
  }
  // Jest: "Tests:       1 failed, 3 passed, 4 total"
  if ((m = /Tests:\s+(?:(\d+)\s+failed,\s+)?(?:\d+\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/.exec(out))) {
    return done('jest', Number(m[3]), Number(m[2] ?? 0), Number(m[1] ?? 0));
  }
  // node --test: "# pass 3" "# fail 1"
  const np = /^# pass (\d+)/m.exec(out);
  const nf = /^# fail (\d+)/m.exec(out);
  if (np && nf) {
    const p = Number(np[1]);
    const f = Number(nf[1]);
    return done('node:test', p + f, p, f);
  }
  // pytest: "=== 3 passed, 1 failed in 0.12s ===" (any order)
  if ((m = /=+ (.*?(?:passed|failed|error).*?) in [\d.]+s/.exec(out)) && m[1]) {
    const passed = Number(/(\d+) passed/.exec(m[1])?.[1] ?? 0);
    const failed = Number(/(\d+) failed/.exec(m[1])?.[1] ?? 0) + Number(/(\d+) errors?/.exec(m[1])?.[1] ?? 0);
    return done('pytest', passed + failed, passed, failed);
  }
  // Mocha: "3 passing" "1 failing"
  const mp = /(\d+) passing/.exec(out);
  if (mp) {
    const p = Number(mp[1]);
    const f = Number(/(\d+) failing/.exec(out)?.[1] ?? 0);
    return done('mocha', p + f, p, f);
  }
  return {
    framework: 'unknown',
    total: null,
    passed: null,
    failed: null,
    text: exitCode === 0 ? 'Tests passed (exit code 0; runner output not recognised).' : `Tests failed (exit code ${exitCode ?? 'unknown'}).`,
  };

  function done(framework: string, total: number, passed: number, failed: number): TestSummary {
    return { framework, total, passed, failed, text: `${framework}: ${passed} passed, ${failed} failed, ${total} total.` };
  }
}

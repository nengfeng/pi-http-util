/**
 * test-harness.ts — Shared test infrastructure for pi-http-util tests.
 *
 * Each test file imports this module to get `describe`, `test`, and helpers.
 * The harness uses module-level counters shared across all test files
 * so a single runner can print a unified summary.
 */

import assert from "node:assert/strict";
import { tokenize } from "../../.pi/extensions/pi-http-util/core.ts";

// ── Counters (shared across all test files via module singleton) ─────

export let passed = 0;
export let failed = 0;
export let total = 0;

// Collect test promises so describe can await them all
export const pendingTests: Promise<void>[] = [];

// ── Test API ─────────────────────────────────────────────────────────

export { assert };

export function test(name: string, fn: () => void | Promise<void>): void {
  total++;
  const p = new Promise<void>(async (resolve) => {
    const timeout = setTimeout(() => {
      console.error(`  ⏱ TIMEOUT (${name})`);
      failed++;
      resolve();
    }, 5000);

    try {
      await fn();
      clearTimeout(timeout);
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      clearTimeout(timeout);
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
    resolve();
  });
  pendingTests.push(p);
}

export async function describe(name: string, fn: () => void | Promise<void>) {
  console.log(`\n${name}`);
  const beforeCount = pendingTests.length;
  await fn();
  await Promise.all(pendingTests.slice(beforeCount));
}

// ── Helpers ──────────────────────────────────────────────────────────

export function collectTokens(html: string): ReturnType<typeof tokenize>[yield] {
  return [...tokenize(html)];
}

// ── Runner ───────────────────────────────────────────────────────────

/**
 * Await all pending tests and print the summary.
 * Call this at the end of your test runner entry point.
 */
export async function runSummary(): Promise<boolean> {
  await Promise.all(pendingTests);

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ""}`);
  console.log(`─────────────────────────────────────────────`);
  return failed === 0;
}

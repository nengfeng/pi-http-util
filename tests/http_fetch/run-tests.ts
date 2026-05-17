/**
 * run-tests.ts — Master test runner for http_fetch extension.
 *
 * Imports all test modules (which register tests via the shared harness),
 * runs integration test suites, then prints a unified summary.
 *
 * Run with:
 *   node --experimental-strip-types tests/http_fetch/run-tests.ts
 */

import { runSummary } from "./test-harness.ts";

// Import unit test modules (side-effect: they register tests immediately)
await import("./tokenizer.test.ts");
await import("./entities.test.ts");
await import("./whitespace.test.ts");
await import("./md_emitter.test.ts");
await import("./md_handler.test.ts");
await import("./strip.test.ts");

// Run integration test suites (each manages its own HTTP server)
const { runTests: runIntegrationTests } = await import("./integration.test.ts");
await runIntegrationTests();

const { runTests: runInPageSearchTests } = await import("./in_page_search.test.ts");
await runInPageSearchTests();

const { runTests: runToolTests } = await import("./tool.test.ts");
await runToolTests();

// Print unified summary and exit
const ok = await runSummary();
if (!ok) process.exit(1);

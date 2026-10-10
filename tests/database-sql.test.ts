import { test, expect } from "bun:test";
import {
  sqlSummary,
  assertStatement,
} from "../system/server/src/modules/database/runner";
test("SQL audit removes ordinary, escaped, dollar-quoted literals and nested comments", () => {
  const samples = [
    "select 'private-value', 123, $$private-value$$, $tag$private-value$tag$",
    "select E'private\\'value', 'private-value'",
    "select '\\' as slash, 'private-value' as value",
    "/* outer /* private-value */ private-value */ select 'private-value' -- private-value",
    'select "private-value"',
  ];
  for (const sql of samples) expect(sqlSummary(sql)).not.toContain("private");
  expect(sqlSummary("select 'it''s secret'")).toBe("select '?'");
});
test("transaction control, scripts and empty input are refused before execution", () => {
  for (const sql of [
    "BEGIN",
    "/*a*/ COMMIT",
    "--a\nROLLBACK",
    "COPY x TO STDOUT",
    "SET statement_timeout=0",
    "DO $$begin end$$",
    "",
  ])
    expect(() => assertStatement(sql)).toThrow();
  expect(() => assertStatement("/* a /* b */ c */ SELECT 1")).not.toThrow();
});

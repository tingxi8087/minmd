import { expect, test } from "bun:test";
import { startupErrorMessage } from "../system/server/src/index";

test("reports nested Drizzle authentication errors without leaking SQL or credentials", () => {
  const driver = Object.assign(new Error("password secret"), { code: "28P01" });
  const error = new Error("Failed query: secret SQL parameters", {
    cause: driver,
  });
  const message = startupErrorMessage(error);
  expect(message).toContain("28P01");
  expect(message).toContain("DATABASE_URL");
  expect(message).not.toContain("secret");
  expect(message).not.toContain("SQL parameters");
});

test("provides migration and port hints, and safely handles unknown or cyclic errors", () => {
  expect(startupErrorMessage({ cause: { code: "42P01" } })).toContain(
    "bun run db:sync",
  );
  expect(startupErrorMessage({ code: "EADDRINUSE" })).toContain("PORT");
  const error = { cause: null as unknown, message: "secret" };
  error.cause = error;
  expect(startupErrorMessage(error)).not.toContain("secret");
  expect(startupErrorMessage(new Error("secret"))).not.toContain("secret");
});

test("缺少前台构建时输出可执行的构建提示", () => {
  expect(
    startupErrorMessage(
      new Error("Web frontend build missing: run bun run build first"),
    ),
  ).toBe("Web frontend build missing: run bun run build first");
});

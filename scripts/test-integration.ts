if (!process.env.TEST_DATABASE_URL) {
  console.error(
    "Set TEST_DATABASE_URL to a dedicated PostgreSQL database ending in _test, or explicitly use the local mas_backend debug database.",
  );
  process.exit(1);
}
const child = Bun.spawn(["bun", "test", "tests/integration"], {
  env: {
    ...process.env,
    AUTH_TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    DEBUG_TEST_DATABASE_URL: process.env.TEST_DATABASE_URL?.endsWith("_test")
      ? process.env.TEST_DATABASE_URL
      : undefined,
  },
  stdout: "inherit",
  stderr: "inherit",
});
process.exitCode = await child.exited;
export {};

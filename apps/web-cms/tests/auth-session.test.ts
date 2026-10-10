import { beforeEach, expect, test, vi } from "vitest";
let session: typeof import("@/http/authSession");
beforeEach(async () => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear();
  session = await import("@/http/authSession");
});
test("memory token is lost when the page module is recreated", async () => {
  session.setAuthConfig({transport: "bearer", tokenStorage: "memory", environment: "development"});
  session.saveToken("memory-token"); expect(session.readToken()).toBe("memory-token");
  expect(localStorage.length + sessionStorage.length).toBe(0);
  vi.resetModules(); const fresh = await import("@/http/authSession");
  fresh.setAuthConfig({transport: "bearer", tokenStorage: "memory", environment: "development"});
  expect(fresh.readToken()).toBeUndefined();
});
for (const storage of ["sessionStorage", "localStorage"] as const) {
  test(`${storage} survives module reload and logout clears it`, async () => {
    const config = {transport: "bearer" as const, tokenStorage: storage, environment: "development"};
    session.setAuthConfig(config); session.saveToken("persisted-token");
    vi.resetModules(); const fresh = await import("@/http/authSession"); fresh.setAuthConfig(config);
    expect(fresh.readToken()).toBe("persisted-token"); fresh.clearSession();
    expect(fresh.readToken()).toBeUndefined(); expect(localStorage.length + sessionStorage.length).toBe(0);
  });
}
test("cookie transport discards bearer storage and exposes only CSRF in memory", () => {
  session.setAuthConfig({transport: "bearer", tokenStorage: "localStorage", environment: "development"}); session.saveToken("old-token");
  session.setAuthConfig({transport: "cookie", tokenStorage: null, environment: "development"}); session.saveToken(undefined, "csrf");
  expect(session.readToken()).toBeUndefined(); expect(localStorage.length).toBe(0); expect(session.readCsrf()).toBe("csrf");
  session.clearSession(); expect(session.readCsrf()).toBeUndefined();
});
test("changing storage cannot reuse the previous storage token", () => {
  session.setAuthConfig({transport: "bearer", tokenStorage: "sessionStorage", environment: "development"}); session.saveToken("old-token");
  session.setAuthConfig({transport: "bearer", tokenStorage: "localStorage", environment: "development"}); expect(session.readToken()).toBeUndefined(); expect(sessionStorage.length).toBe(0);
});

import { expect, test } from "bun:test";
import { readDevPort } from "../config/dev";

test("开发端口支持默认值和显式设置", () => {
  expect(readDevPort(undefined, 5173)).toBe(5173);
  expect(readDevPort("15174", 5174)).toBe(15174);
});

test("拒绝无效端口，不隐式切换服务地址", () => {
  for (const value of ["0", "65536", "5173.5", "abc", "-1"])
    expect(() => readDevPort(value, 5173)).toThrow();
});

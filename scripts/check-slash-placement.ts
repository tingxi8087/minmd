import assert from "node:assert/strict";
import { slashPlacement } from "../src/views/Document/utils/slashPlacement";
for (const [top, bottom, viewport, content] of [
  [390, 412, 720, 720],
  [630, 652, 720, 720],
  [100, 122, 720, 720],
  [390, 412, 720, 90],
]) {
  const result = slashPlacement(top, bottom, viewport, content);
  assert.ok(result.y >= 8);
  assert.ok(result.y + result.maxHeight <= viewport - 8);
  assert.ok(result.y >= bottom + 8 || result.y + result.maxHeight <= top - 8);
}
assert.ok(slashPlacement(390, 412, 720, 720).y < 390);
assert.equal(slashPlacement(390, 412, 720, 90).y, 420);
console.log("插入菜单定位检查通过：上下空间、短菜单、视口边界与光标行避让");

/** HTTP IP 直连没有 Clipboard API，复制退回到用户手势内的浏览器命令。 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 权限拒绝时仍尝试兼容路径。
    }
  }
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("复制失败");
  } finally {
    input.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
export function readClipboardText(): Promise<string> {
  return navigator.clipboard?.readText
    ? navigator.clipboard.readText()
    : Promise.reject(new Error("请使用键盘快捷键粘贴"));
}

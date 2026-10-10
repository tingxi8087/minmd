import type { AccessCode } from "@/.utils/access";
import { accessStore } from "@/store/sys";

export const useAccess = (code: AccessCode) => {
  const { list } = accessStore;
  if (!code) return true;
  const codeList = Array.isArray(code) ? code : [code];
  return codeList.some((item) => list.includes(item));
};

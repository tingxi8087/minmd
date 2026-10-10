import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 400;
export const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));

export const useLayout = create<{
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
}>()(
  persist(
    (set) => ({
      sidebarWidth: 208,
      sidebarCollapsed: false,
      setSidebarWidth: (width) =>
        set({ sidebarWidth: clampSidebarWidth(width) }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    { name: "minmd-layout-v1" },
  ),
);

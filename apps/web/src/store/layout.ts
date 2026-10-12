import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 400;
export const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));

export const useLayout = create<{
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  themeDialogOpen: boolean;
  setThemeDialogOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
}>()(
  persist(
    (set) => ({
      sidebarWidth: 260,
      sidebarCollapsed: false,
      themeDialogOpen: false,
      setThemeDialogOpen: (themeDialogOpen) => set({ themeDialogOpen }),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: clampSidebarWidth(width) }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: "minmd-layout-v1",
      version: 1,
      partialize: ({ sidebarWidth, sidebarCollapsed }) => ({
        sidebarWidth,
        sidebarCollapsed,
      }),
      migrate: (persisted) => {
        const state = persisted as {
          sidebarWidth?: number;
          sidebarCollapsed?: boolean;
        };
        return {
          ...state,
          sidebarWidth:
            state.sidebarWidth === 208 ? 260 : (state.sidebarWidth ?? 260),
        };
      },
    },
  ),
);

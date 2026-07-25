import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kw.workspace.layout";

type WorkspaceLayout = {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};

const DEFAULTS: WorkspaceLayout = {
  leftWidth: 280,
  rightWidth: 360,
  leftCollapsed: false,
  rightCollapsed: false,
};

function readLayout(): WorkspaceLayout {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>;
    return {
      leftWidth:
        typeof parsed.leftWidth === "number"
          ? parsed.leftWidth
          : DEFAULTS.leftWidth,
      rightWidth:
        typeof parsed.rightWidth === "number"
          ? parsed.rightWidth
          : DEFAULTS.rightWidth,
      leftCollapsed: Boolean(parsed.leftCollapsed),
      rightCollapsed: Boolean(parsed.rightCollapsed),
    };
  } catch {
    return DEFAULTS;
  }
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayout>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLayout(readLayout());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout, ready]);

  const setLeftWidth = useCallback((leftWidth: number) => {
    setLayout((prev) => ({ ...prev, leftWidth }));
  }, []);

  const setRightWidth = useCallback((rightWidth: number) => {
    setLayout((prev) => ({ ...prev, rightWidth }));
  }, []);

  const setLeftCollapsed = useCallback((leftCollapsed: boolean) => {
    setLayout((prev) => ({ ...prev, leftCollapsed }));
  }, []);

  const setRightCollapsed = useCallback((rightCollapsed: boolean) => {
    setLayout((prev) => ({ ...prev, rightCollapsed }));
  }, []);

  return {
    ...layout,
    setLeftWidth,
    setRightWidth,
    setLeftCollapsed,
    setRightCollapsed,
  };
}

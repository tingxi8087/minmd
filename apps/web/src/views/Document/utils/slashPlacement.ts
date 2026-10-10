export function slashPlacement(
  top: number,
  bottom: number,
  viewportHeight: number,
  contentHeight: number,
) {
  const gap = 8;
  const above = Math.max(0, top - gap - 8);
  const below = Math.max(0, viewportHeight - bottom - gap - 8);
  const desired = Math.min(420, contentHeight);
  const openAbove = below < desired && above > below;
  const height = Math.min(desired, openAbove ? above : below);
  return {
    y: openAbove ? top - gap - height : bottom + gap,
    maxHeight: height,
  };
}

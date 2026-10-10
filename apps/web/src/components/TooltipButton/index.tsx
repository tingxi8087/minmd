import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "antd";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  tooltip?: ReactNode;
};

const TooltipButton = forwardRef<HTMLButtonElement, Props>(
  ({ tooltip, children, ...props }, ref) => (
    <Tooltip
      title={tooltip ?? props["aria-label"]}
      trigger={["hover", "focus"]}
      mouseEnterDelay={0.1}
      mouseLeaveDelay={0.05}
      color="var(--text)"
      styles={{
        body: { color: "var(--bg)", fontSize: 12, padding: "4px 8px" },
      }}
    >
      <button {...props} ref={ref}>
        {children}
      </button>
    </Tooltip>
  ),
);
TooltipButton.displayName = "TooltipButton";
export default TooltipButton;

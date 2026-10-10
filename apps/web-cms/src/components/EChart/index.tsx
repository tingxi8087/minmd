import { useEffect, useRef } from "react";
import { init, use, ECharts, EChartsCoreOption } from "echarts/core";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useDomChange } from "@/hooks/useDomChange";
use([LineChart, BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, CanvasRenderer]);
export default function EChart({ option, label, height = 280 }: { option: EChartsCoreOption; label: string; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts>();
  useEffect(() => {
    if (!container.current) return;
    const instance = init(container.current);
    chart.current = instance;
    return () => { chart.current = undefined; instance.dispose(); };
  }, []);
  useEffect(() => { chart.current?.setOption(option, { notMerge: true }); }, [option]);
  useDomChange([container], { observeMutation: false, onChange: () => chart.current?.resize() });
  return <div role="img" aria-label={label} style={{ width: "100%", height, minWidth: 0 }}><div ref={container} style={{ width: "100%", height: "100%" }} /></div>;
}

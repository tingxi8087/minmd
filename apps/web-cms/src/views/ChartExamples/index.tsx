import { useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Segmented, Space, Spin, Switch, Tag } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { EChartsCoreOption } from "echarts/core";
import EChart from "@/components/EChart";
import { useResource } from "@/hooks/useResource";
import { getChartData } from "@/mock/charts";
import styles from "./index.module.less";
const colors = ["#1677ff", "#13a8a8", "#faad14", "#8695ac"];
export default function ChartExamples() {
  const [days, setDays] = useState(7);
  const [empty, setEmpty] = useState(false);
  const resource = useResource(() => getChartData(days), [days]);
  const options = useMemo<EChartsCoreOption[]>(() => {
    const data = resource.data;
    if (!data) return [];
    const base = { color: colors, aria: { enabled: true }, tooltip: { trigger: "axis" }, grid: { left: 45, right: 20, top: 42, bottom: 35 } };
    return [
      { ...base, xAxis: { type: "category", data: data.trend.map(row => row.date), boundaryGap: false }, yAxis: { type: "value", minInterval: 1 }, series: [{ name: "访问量", type: "line", smooth: true, showSymbol: false, areaStyle: { opacity: 0.08 }, data: data.trend.map(row => row.visits) }] },
      { ...base, xAxis: { type: "category", data: data.departments.map(row => row.name) }, yAxis: { type: "value", minInterval: 1 }, series: [{ name: "用户数", type: "bar", barMaxWidth: 36, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: data.departments.map(row => row.value) }] },
      { color: [colors[1], colors[3]], aria: { enabled: true }, tooltip: { trigger: "item" }, legend: { bottom: 0 }, series: [{ name: "用户状态", type: "pie", radius: ["46%", "68%"], center: ["50%", "45%"], label: { formatter: "{b} {c} 人" }, data: data.statuses }] },
      { ...base, legend: { top: 0 }, grid: { left: 75, right: 20, top: 42, bottom: 35 }, xAxis: { type: "value", minInterval: 1 }, yAxis: { type: "category", data: data.departments.map(row => row.name) }, series: data.roles.map(role => ({ name: role.name, type: "bar", stack: "roles", barMaxWidth: 24, data: role.values })) },
    ];
  }, [resource.data]);
  const titles = ["访问趋势", "部门用户分布", "用户状态占比", "部门角色构成"];
  return <div className={styles.page}>
    <Card size="small"><div className={styles.toolbar}>
      <Space wrap><Tag color="blue">本地 Mock</Tag><span>趋势范围</span><Segmented aria-label="趋势范围" value={days} options={[{ label: "近 7 天", value: 7 }, { label: "近 30 天", value: 30 }]} onChange={value => setDays(Number(value))} /></Space>
      <Space><span>空数据演示</span><Switch aria-label="空数据演示" checked={empty} onChange={setEmpty} /><Button icon={<ReloadOutlined aria-hidden />} loading={resource.loading} onClick={resource.reload}>刷新数据</Button></Space>
    </div></Card>
    {resource.error ? <Alert type="error" message="图表数据读取失败" action={<Button onClick={resource.reload}>重试</Button>} /> :
      <div className={styles.grid}>{titles.map((title, index) => <Card key={title} size="small" title={title} extra={<Tag>{["折线图", "柱状图", "环形图", "堆叠条形图"][index]}</Tag>}>
        <Spin spinning={resource.loading} aria-label="图表加载中"><div className={styles.chart}>
          {empty || resource.data?.total === 0 && index > 0 ? <div className={styles.empty}><Empty description="暂无数据" /></div> : options[index] ? <EChart label={title} option={options[index]} /> : <div style={{ height: 280 }} />}
        </div></Spin>
      </Card>)}</div>}
    <Alert type="info" showIcon message="访问趋势为模拟序列；用户分布读取用户管理的内存数据，修改后点击刷新。多角色用户会分别计入对应角色，角色合计可能超过用户总数。" />
  </div>;
}

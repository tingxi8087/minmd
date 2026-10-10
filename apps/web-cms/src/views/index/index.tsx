import { Button, Card, Col, Descriptions, List, Row, Space, Tag, Typography } from "antd";
import { useRef } from "react";
import conventions from "../../../AGENTS.md?raw";
import DocumentModal, { type DocumentModalRef } from "./components/DocumentModal";
import { Link } from "react-router-dom";
import { ArrowRightOutlined, BarChartOutlined, DatabaseOutlined, SafetyOutlined, TeamOutlined } from "@ant-design/icons";
import styles from "./index.module.less";
const entries = [
  { name: "用户管理", path: "/curd/users", icon: <TeamOutlined />, text: "查询、字段设置、资料编辑与批量操作" },
  { name: "图表展示", path: "/charts", icon: <BarChartOutlined />, text: "趋势、分布与构成，四类常用图表" },
  { name: "状态管理", path: "/eBoxUse", icon: <DatabaseOutlined />, text: "e-boxes 多组件同步与批量更新" },
  { name: "权限控制", path: "/accessPage", icon: <SafetyOutlined />, text: "页面与组件的访问控制示例" },
];
const source = "https://github.com/tingxi8087/mas-cms";
export default function Index() {
  const documentModalRef = useRef<DocumentModalRef>(null);
  const documents: Record<string, string> = { "AGENTS.md": conventions };
  return <div className={styles.page}>
    <Card size="small" title="关于 mas-cms" extra={<Typography.Link href={source} target="_blank" rel="noreferrer">项目源码</Typography.Link>}>
      <p className={styles.intro}>一个基于 React 的开源后台开发示例，集中展示表格、表单、图表与通用开发能力。可以从现有页面出发，复用组件和 hooks 构建业务功能。</p>
      <Space wrap>{["React 18", "TypeScript", "Vite", "Ant Design", "e-boxes", "ECharts"].map(name => <Tag key={name}>{name}</Tag>)}</Space>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }} className={styles.facts}>
        <Descriptions.Item label="数据方式">浏览器内存 Mock，刷新后恢复初始数据</Descriptions.Item>
        <Descriptions.Item label="路由模式">Hash Router，示例地址可直接打开</Descriptions.Item>
        <Descriptions.Item label="样式组织">Less + CSS Modules</Descriptions.Item>
        <Descriptions.Item label="开发原则">优先复用现有能力，基础 UI 使用 Ant Design</Descriptions.Item>
      </Descriptions>
    </Card>
    <Row gutter={[12, 12]}>{entries.map(entry => <Col xs={24} sm={12} xl={6} key={entry.path}>
      <Card size="small" className={styles.entry}><span className={styles.icon}>{entry.icon}</span><h3>{entry.name}</h3><p>{entry.text}</p><Link to={entry.path}>打开示例 <ArrowRightOutlined aria-hidden /></Link></Card>
    </Col>)}</Row>
    <Row gutter={[12, 12]}>
      <Col xs={24} lg={14}><Card size="small" title="开发从这里开始"><List size="small" dataSource={[
        { title: "先看现有页面", text: "用户管理包含查询 Card、表格 Card 和 ref 弹窗，适合作为列表页参考。" },
        { title: "再找组件与 hooks", text: "SearchTableForm 处理查询；useBasePageTable 处理分页；useTableChecked 从行数据派生选中状态。" },
        { title: "按职责放置代码", text: "页面放 views，通用组件放 components，状态放 store，请求沿用 http。" },
      ]} renderItem={(item, index) => <List.Item><List.Item.Meta avatar={<Tag>{String(index + 1).padStart(2, "0")}</Tag>} title={item.title} description={item.text} /></List.Item>} /></Card></Col>
      <Col xs={24} lg={10}><Card size="small" title="项目文档"><List size="small" dataSource={[
        ["开发约定", "AGENTS.md", "组件选择、目录归属与验收要求"],
      ]} renderItem={item => <List.Item><List.Item.Meta title={<Button type="link" style={{ padding: 0 }} onClick={() => documentModalRef.current?.open({ document: { title: item[0], text: documents[item[1]], path: item[1] }, documents })}>{item[0]}</Button>} description={item[2]} /></List.Item>} /></Card></Col>
    </Row>
    <DocumentModal ref={documentModalRef} />
  </div>;
}

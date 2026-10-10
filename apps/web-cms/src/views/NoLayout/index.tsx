import { Button, Card, Descriptions } from "antd";
import { Link } from "react-router-dom";
export default function NoLayout() {
  return <Card title="独立布局" style={{ maxWidth: 720, margin: "48px auto" }} extra={<Link to="/index"><Button>返回首页</Button></Link>}>
    <p>此页面通过现有路由守卫隐藏侧栏与顶栏，适合登录、预览等独立页面。</p>
    <Descriptions column={1} size="small"><Descriptions.Item label="路由">/noLayout</Descriptions.Item><Descriptions.Item label="配置入口">src/router/routerGuard.ts</Descriptions.Item></Descriptions>
  </Card>;
}

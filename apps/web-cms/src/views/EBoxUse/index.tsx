import { Button, Card, Input, InputNumber, Space, Switch, Tag, Typography } from "antd";
import { MinusOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import eBox from "e-boxes";
import styles from "./index.module.less";

const defaults = { count: 0, step: 1, name: "内容工作空间", notifications: true };
const state = eBox({ ...defaults });

function Counter() {
  const { count, step } = state;
  return (
    <Card size="small" title="计数器" extra={<Tag color="blue">直接赋值</Tag>}>
      <div className={styles.counter}>
        <span className={styles.label}>当前数值</span>
        <strong aria-live="polite" aria-label="当前计数">{count}</strong>
        <Space>
          <Button aria-label="减少计数" icon={<MinusOutlined aria-hidden />} onClick={() => { state.count = count - step; }} />
          <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => { state.count = count + step; }}>增加</Button>
          <Button onClick={() => { state.count = 0; }}>归零</Button>
        </Space>
      </div>
      <div className={styles.field}>
        <label htmlFor="counter-step">每次增减</label>
        <InputNumber id="counter-step" min={1} max={100} precision={0} value={step} onChange={(value) => { state.step = value ?? 1; }} />
      </div>
    </Card>
  );
}

function Preferences() {
  const { name, notifications } = state;
  return (
    <Card size="small" title="工作空间设置" extra={<Tag>独立字段</Tag>}>
      <div className={styles.settings}>
        <label htmlFor="workspace-name">工作空间名称</label>
        <Input id="workspace-name" maxLength={30} value={name} onChange={(event) => { state.name = event.target.value; }} />
        <div className={styles.field}>
          <div><div>消息通知</div><span className={styles.label}>修改后，右侧预览同步更新</span></div>
          <Switch aria-label="消息通知" checked={notifications} onChange={(checked) => { state.notifications = checked; }} />
        </div>
        <Button onClick={() => state.set({ name: "协作工作空间", notifications: false })}>批量应用设置</Button>
      </div>
    </Card>
  );
}

function Preview() {
  const { count, step, name, notifications } = state;
  return (
    <Card size="small" title="实时预览" extra={<span className={styles.live}>同步中</span>}>
      <div className={styles.preview}>
        <span className={styles.previewIcon}><ThunderboltOutlined aria-hidden /></span>
        <h3>{name || "未命名工作空间"}</h3>
        <Tag color={notifications ? "green" : "default"}>{notifications ? "通知已开启" : "通知已关闭"}</Tag>
        <dl><div><dt>当前计数</dt><dd data-testid="preview-count">{count}</dd></div><div><dt>增减步长</dt><dd>{step}</dd></div></dl>
      </div>
    </Card>
  );
}

export default function EBoxUse() {
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.description}>修改状态，观察不同组件的同步变化。</span>
        <Button icon={<ReloadOutlined aria-hidden />} onClick={() => state.set({ ...defaults })}>重置示例</Button>
      </div>
      <div className={styles.grid}><Counter /><Preferences /><Preview /></div>
      <Card size="small" title="使用方式" extra={<Typography.Link href="https://github.com/tingxi8087/e-boxes" target="_blank" rel="noreferrer">查看源码</Typography.Link>}>
        <div className={styles.codeGrid}>
          <div><h4>01 · 定义状态</h4><pre>{'const state = eBox({ count: 0, name: "工作空间" });'}</pre></div>
          <div><h4>02 · 在组件中读取与更新</h4><pre>{'const { count } = state;\nstate.count++;'}</pre></div>
          <div><h4>03 · 批量更新</h4><pre>{'state.set({ count: 0, name: "协作空间" });'}</pre></div>
        </div>
        <p className={styles.note}>组件中读取字段会自动订阅更新；事件或普通函数中可用 state.get() 读取当前快照。本示例仅保存在内存中，刷新后恢复默认值。</p>
      </Card>
    </div>
  );
}

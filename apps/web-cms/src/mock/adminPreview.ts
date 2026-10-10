/** 纯静态演示：所有读写只发生在内存中，刷新页面后恢复。 */
export interface DemoRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  members: number;
}
/** 权限按控制台功能分组；value 保持现有权限标识。 */
export const permissionGroups = [
  {
    key: "accounts",
    label: "管理员账号",
    description: "控制台成员的查看与维护",
    options: [
      { label: "查看账号", value: "user:read", write: false },
      { label: "创建账号", value: "user:create", write: true },
      { label: "编辑账号", value: "user:update", write: true },
      { label: "停用账号", value: "user:disable", write: true },
    ],
  },
  {
    key: "roles",
    label: "角色管理",
    description: "角色资料及权限配置",
    options: [
      { label: "查看角色", value: "role:read", write: false },
      { label: "管理角色", value: "role:update", write: true },
    ],
  },
  {
    key: "logs",
    label: "日志与审计",
    description: "运行记录与操作追踪",
    options: [
      { label: "查看运行日志", value: "log:read", write: false },
      { label: "查看操作审计", value: "audit:read", write: false },
    ],
  },
];
export const permissionOptions = permissionGroups.flatMap(
  (group) => group.options,
);
export const demoRoles: DemoRole[] = [
  {
    id: "admin",
    name: "管理员",
    description: "维护团队成员、角色与日志",
    permissions: permissionOptions.map((p) => p.value),
    members: 10,
  },
  {
    id: "editor",
    name: "编辑",
    description: "查看管理员账号、编辑资料并查看运行日志",
    permissions: ["user:read", "user:update", "role:read", "log:read"],
    members: 10,
  },
  {
    id: "viewer",
    name: "访客",
    description: "只读访问用户和角色信息",
    permissions: ["user:read", "role:read"],
    members: 9,
  },
];
export interface RuntimeLog {
  id: string;
  time: string;
  level: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  message: string;
}
export const runtimeLogs: RuntimeLog[] = [
  {
    id: "req_01",
    time: "2026-09-17 09:32:08",
    level: "INFO",
    method: "GET",
    path: "/api/users",
    status: 200,
    duration: 24,
    message: "用户列表查询完成",
  },
  {
    id: "req_02",
    time: "2026-09-17 09:31:52",
    level: "ERROR",
    method: "POST",
    path: "/api/users",
    status: 500,
    duration: 1024,
    message: "数据库连接超时",
  },
  {
    id: "req_03",
    time: "2026-09-17 09:31:40",
    level: "WARN",
    method: "GET",
    path: "/api/audit",
    status: 403,
    duration: 8,
    message: "缺少 audit:read 权限",
  },
  {
    id: "req_04",
    time: "2026-09-17 09:30:28",
    level: "INFO",
    method: "PATCH",
    path: "/api/roles/editor",
    status: 200,
    duration: 32,
    message: "角色更新完成",
  },
  {
    id: "req_05",
    time: "2026-09-17 09:29:13",
    level: "INFO",
    method: "GET",
    path: "/api/health",
    status: 200,
    duration: 3,
    message: "健康检查通过",
  },
  {
    id: "req_06",
    time: "2026-09-17 09:28:01",
    level: "WARN",
    method: "GET",
    path: "/api/users",
    status: 401,
    duration: 5,
    message: "会话已过期",
  },
  {
    id: "req_07",
    time: "2026-09-16 17:50:02",
    level: "INFO",
    method: "POST",
    path: "/api/auth/login",
    status: 200,
    duration: 181,
    message: "登录成功",
  },
  {
    id: "req_08",
    time: "2026-09-16 17:49:31",
    level: "INFO",
    method: "GET",
    path: "/api/roles",
    status: 200,
    duration: 18,
    message: "角色列表查询完成",
  },
];
export interface AuditLog {
  id: string;
  time: string;
  actor: string;
  action: string;
  target: string;
  result: string;
  requestId: string;
  before: string;
  after: string;
}
export const auditLogs: AuditLog[] = [
  {
    id: "AUD-1008",
    time: "2026-09-17 09:30:28",
    actor: "admin",
    action: "调整角色权限",
    target: "编辑",
    result: "成功",
    requestId: "req_04",
    before: "user:read、user:update、role:read",
    after: "user:read、user:update、role:read、log:read",
  },
  {
    id: "AUD-1007",
    time: "2026-09-17 09:15:02",
    actor: "admin",
    action: "创建管理员账号",
    target: "user030",
    result: "成功",
    requestId: "req_09",
    before: "用户不存在",
    after: "状态：启用；角色：访客",
  },
  {
    id: "AUD-1006",
    time: "2026-09-17 09:12:48",
    actor: "user002",
    action: "调整角色权限",
    target: "管理员",
    result: "拒绝",
    requestId: "req_10",
    before: "现有权限",
    after: "未变更：缺少 role:update 权限",
  },
  {
    id: "AUD-1005",
    time: "2026-09-16 17:40:10",
    actor: "admin",
    action: "停用管理员账号",
    target: "user005",
    result: "成功",
    requestId: "req_11",
    before: "启用，活跃会话 2",
    after: "禁用，活跃会话 0",
  },
  {
    id: "AUD-1004",
    time: "2026-09-16 16:25:33",
    actor: "admin",
    action: "重置密码",
    target: "user008",
    result: "成功",
    requestId: "req_12",
    before: "敏感内容不记录",
    after: "敏感内容不记录；已撤销全部会话",
  },
];

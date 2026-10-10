import type { PermissionGroup } from "../system/server/src/index";
/** 权限唯一声明来源。直接用于展示与校验；已删除项的历史关联不再授权。 */
export const adminPermissions = [
  {
    code: "api",
    name: "接口调试",
    permissions: [
      {
        code: "api:read",
        name: "查看接口文档",
        description: "查看当前环境接口目录和参数定义",
        write: false,
      },
      {
        code: "api:debug",
        name: "使用接口调试",
        description: "发送调试请求；目标接口仍校验业务权限",
        write: true,
      },
    ],
  },
  {
    code: "admin",
    name: "管理员账号",
    permissions: [
      {
        code: "user:read",
        name: "查看账号",
        description: "查看控制台管理员列表与详情",
        write: false,
      },
      {
        code: "user:create",
        name: "创建账号",
        description: "创建控制台管理员账号",
        write: true,
      },
      {
        code: "user:update",
        name: "编辑账号",
        description: "修改账号资料及角色分配",
        write: true,
      },
      {
        code: "user:disable",
        name: "启停账号",
        description: "启停账号，停用时撤销全部会话",
        write: true,
      },
      {
        code: "user:reset-password",
        name: "重置密码",
        description: "重置密码并撤销账号全部会话",
        write: true,
      },
    ],
  },
  {
    code: "role",
    name: "角色管理",
    permissions: [
      {
        code: "role:read",
        name: "查看角色",
        description: "查看角色与权限清单",
        write: false,
      },
      {
        code: "role:update",
        name: "管理角色",
        description: "创建、修改、删除角色和分配权限",
        write: true,
      },
    ],
  },
  {
    code: "logs",
    name: "日志与审计",
    permissions: [
      {
        code: "log:read",
        name: "查看运行日志",
        description: "查询运行日志与请求详情",
        write: false,
      },
      {
        code: "audit:read",
        name: "查看操作审计",
        description: "查询管理员操作和变更记录",
        write: false,
      },
    ],
  },
  {
    code: "app-user",
    name: "前台用户管理",
    permissions: [
      {
        code: "app-user:read",
        name: "查看用户",
        description: "查询前台用户资料",
        write: false,
      },
      {
        code: "app-user:create",
        name: "新建用户",
        description: "创建前台用户",
        write: true,
      },
      {
        code: "app-user:update",
        name: "编辑用户",
        description: "编辑资料及前台角色",
        write: true,
      },
      {
        code: "app-user:disable",
        name: "启停用户",
        description: "启停前台账号",
        write: true,
      },
      {
        code: "app-user:reset-password",
        name: "重置用户密码",
        description: "重置密码并撤销会话",
        write: true,
      },
      {
        code: "app-user:revoke",
        name: "强制下线",
        description: "撤销用户全部会话",
        write: true,
      },
    ],
  },
] satisfies PermissionGroup[];

/** 前台业务权限按需添加；个人资料操作使用身份及数据归属校验。 */
export const appPermissions: PermissionGroup[] = [];

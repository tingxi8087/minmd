/** 事务提交后撤销在线业务连接；不把协作引擎耦合进账号管理。 */
export interface UserLifecycle {
  onUserSessionsRevoked?: (userId: string) => void | Promise<void>;
  onSessionRevoked?: (sessionId: string) => void | Promise<void>;
}

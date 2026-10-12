import { sql } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";

/** 截止时间在事务提交前检查；不用超时竞速让后台仍提交已向调用者报失败的写入。 */
export class AiExecution {
  private readonly deadline: number;
  constructor(
    milliseconds: number,
    private readonly clock = () => performance.now(),
  ) {
    this.deadline = clock() + milliseconds;
  }
  check() {
    if (this.clock() >= this.deadline)
      throw new AppError(
        "AI_EXECUTION_TIMEOUT",
        "AI操作超时，请缩小批次或稍后重试",
        503,
      );
  }
  async begin(tx: Transaction) {
    this.check();
    const remaining = String(
      Math.max(1, Math.ceil(this.deadline - this.clock())),
    );
    await tx.execute(
      sql`select set_config('statement_timeout', ${remaining}, true), set_config('lock_timeout', ${remaining}, true)`,
    );
    this.check();
  }
  error(error: unknown): unknown {
    let current = error;
    for (
      let depth = 0;
      depth < 4 && current && typeof current === "object";
      depth++
    ) {
      const entry = current as { code?: unknown; cause?: unknown };
      if (entry.code === "57014" || entry.code === "55P03")
        return new AppError(
          "AI_EXECUTION_TIMEOUT",
          "AI操作等待数据库超时，请稍后重试",
          503,
        );
      current = entry.cause;
    }
    return error;
  }
  async transaction<T>(
    database: Database,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    try {
      return await database.db.transaction(async (tx) => {
        await this.begin(tx);
        const result = await operation(tx);
        this.check();
        return result;
      });
    } catch (error) {
      throw this.error(error);
    }
  }
}

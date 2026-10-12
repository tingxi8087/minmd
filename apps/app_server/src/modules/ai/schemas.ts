import { errors } from "../spaces/schemas";

export const aiErrors = {
  ...errors,
  503: {
    ...errors[400],
    description: "AI执行超时或服务暂不可用，失败的写入事务不会部分提交",
  },
};

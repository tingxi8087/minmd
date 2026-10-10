import { getStudentHttp } from "./mock";
import { departments, roleOptions } from "./userModel";
import dayjs from "dayjs";

/** 用户分布取自同一内存 Mock，访问趋势为固定公式生成的演示序列。 */
export async function getChartData(days: number) {
  const { data } = await getStudentHttp({ pageSize: 50 });
  const users = data.list;
  for (let pageNum = 2; users.length < data.total; pageNum++) {
    const next = await getStudentHttp({ pageSize: 50, pageNum });
    if (!next.data.list.length) break;
    users.push(...next.data.list);
  }
  return {
    total: data.total,
    trend: Array.from({ length: days }, (_, index) => ({
      date: dayjs().subtract(days - index - 1, "day").format("MM-DD"),
      visits: 100 + index * 11 + (index * 37 % 83),
    })),
    departments: departments.map(department => ({ name: department.title, value: users.filter(user => user.department === department.value).length })),
    statuses: [
      { name: "启用", value: users.filter(user => user.status === "enabled").length },
      { name: "停用", value: users.filter(user => user.status === "disabled").length },
    ],
    roles: roleOptions.map(role => ({ name: role.label, values: departments.map(department => users.filter(user => user.department === department.value && user.roles.includes(role.value)).length) })),
  };
}

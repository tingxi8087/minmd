export const departmentTree = [
  { title: "产品与研发", value: "product", selectable: false, children: [
    { title: "产品部", value: "product-team" }, { title: "研发部", value: "engineering" },
  ] },
  { title: "运营与支持", value: "operations", selectable: false, children: [
    { title: "运营部", value: "operation-team" }, { title: "客户支持", value: "support" },
  ] },
];
export const departments = departmentTree.flatMap(group => group.children);
export const roleOptions = [{ label: "管理员", value: "admin" }, { label: "编辑", value: "editor" }, { label: "访客", value: "viewer" }];
export const hobbyOptions = ["阅读", "运动", "音乐", "旅行", "摄影", "编程"];
export const statusOptions = [{ label: "启用", value: "enabled" }, { label: "停用", value: "disabled" }];
export interface Student {
  id: number; name: string; account: string; age: number; gender: "male" | "female" | "private";
  phone: string; email: string; department: string; roles: string[]; status: "enabled" | "disabled";
  birthday?: string; hobbies: string[]; notifications: boolean; avatar?: string; des: string;
  like: string; createdAt: string;
}
export type UserInput = Omit<Student, "id" | "createdAt" | "like">;
export interface StudentSearchParams {
  name?: string; account?: string; status?: Student["status"]; department?: string; roles?: string[];
  registered?: [string, string]; ageRange?: { leftValue?: number; rightValue?: number }; id?: number;
}
export const departmentName = (value: string) => departments.find(item => item.value === value)?.title || value;
export const roleName = (value: string) => roleOptions.find(item => item.value === value)?.label || value;

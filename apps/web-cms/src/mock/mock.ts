import { Student, StudentSearchParams, UserInput, departments, roleOptions, hobbyOptions } from "./userModel";

const initialRows = [
  {
    id: 1,
    name: "小蔡",
    age: 2.5,
    des: "一个学生",
    like: "唱、跳rap、篮球",
  },
  {
    id: 2,
    name: "小红",
    age: 19,
    des: "一个快乐的孩子",
    like: "画画、看书、游泳",
  },
  {
    id: 3,
    name: "小华",
    age: 18,
    des: "一个好奇的孩子",
    like: "玩具、看动画片、玩滑梯",
  },
  {
    id: 4,
    name: "小李",
    age: 12,
    des: "一个活泼的孩子",
    like: "跑步、跳绳、玩沙子",
  },
  {
    id: 5,
    name: "小吴",
    age: 9,
    des: "一个善良的孩子",
    like: "帮助他人、分享、植物",
  },
  {
    id: 6,
    name: "小王",
    age: 18,
    des: "一个勤奋的学生",
    like: "学习、阅读、编程",
  },
  {
    id: 7,
    name: "小刘",
    age: 11,
    des: "一个勇敢的孩子",
    like: "爬山、骑自行车、探索",
  },
  {
    id: 8,
    name: "小杨",
    age: 20,
    des: "一个有想象力的孩子",
    like: "讲故事、发明、画漫画",
  },
  {
    id: 9,
    name: "小陈",
    age: 13,
    des: "一个喜欢动物的孩子",
    like: "看动物、饲养宠物、看动物纪录片",
  },
  {
    id: 10,
    name: "小林",
    age: 14,
    des: "一个喜欢科学的学生",
    like: "实验、探索、研究",
  },
  {
    id: 11,
    name: "小张",
    age: 17,
    des: "一个喜欢音乐的孩子",
    like: "听音乐、弹钢琴、唱歌",
  },
  {
    id: 12,
    name: "小周",
    age: 15,
    des: "一个热爱运动的学生",
    like: "打篮球、踢足球、游泳",
  },
  {
    id: 13,
    name: "小邹",
    age: 9,
    des: "一个喜欢烹饪的孩子",
    like: "烘焙、制作美食、尝试新菜品",
  },
  {
    id: 14,
    name: "小马",
    age: 16,
    des: "一个热爱自然的孩子",
    like: "徒步、观察植物、露营",
  },
  {
    id: 15,
    name: "小胡",
    age: 10,
    des: "一个有责任感的学生",
    like: "义工服务、照顾弟妹、照顾宠物",
  },
  {
    id: 16,
    name: "小曾",
    age: 20,
    des: "一个喜欢数学的学生",
    like: "解决问题、数学竞赛、逻辑游戏",
  },
  {
    id: 17,
    name: "小钟",
    age: 9,
    des: "一个喜欢历史的学生",
    like: "阅读历史书籍、参观博物馆、研究历史事件",
  },
  {
    id: 18,
    name: "小吕",
    age: 15,
    des: "一个热爱电子游戏的学生",
    like: "电子竞技、策略游戏、虚拟现实游戏",
  },
  {
    id: 19,
    name: "小程",
    age: 9,
    des: "一个喜欢摄影的学生",
    like: "拍照、修图、户外摄影",
  },
  {
    id: 20,
    name: "小陆",
    age: 18,
    des: "一个热爱旅行的学生",
    like: "旅游、探索新地方、学习新文化",
  },
  {
    id: 21,
    name: "小罗",
    age: 11,
    des: "一个喜欢设计的学生",
    like: "绘画、创新、图形设计",
  },
  {
    id: 22,
    name: "小谭",
    age: 14,
    des: "一个热爱运动的学生",
    like: "篮球、足球、健身",
  },
  {
    id: 23,
    name: "小于",
    age: 9,
    des: "一个喜欢舞蹈的学生",
    like: "街舞、芭蕾、现代舞",
  },
  {
    id: 24,
    name: "小孟",
    age: 16,
    des: "一个喜欢编程的学生",
    like: "Python、Web开发、AI",
  },
  {
    id: 25,
    name: "小金",
    age: 13,
    des: "一个喜欢阅读的学生",
    like: "科幻小说、历史书籍、诗歌",
  },
  {
    id: 26,
    name: "小易",
    age: 12,
    des: "一个喜欢电影的学生",
    like: "剧情片、科幻片、纪录片",
  },
  {
    id: 27,
    name: "小聂",
    age: 10,
    des: "一个喜欢写作的学生",
    like: "小说、日记、散文",
  },
  {
    id: 28,
    name: "小夏",
    age: 8,
    des: "一个热爱音乐的学生",
    like: "吉他、钢琴、作曲",
  },
  {
    id: 29,
    name: "小秦",
    age: 20,
    des: "一个喜欢艺术的学生",
    like: "绘画、雕塑、设计",
  },
];


const dataSource: Student[] = initialRows.map((row, index) => ({
  ...row, age: 20 + index % 35, account: `user${String(row.id).padStart(3, "0")}`,
  gender: index % 2 ? "female" : "male", phone: `1380000${String(row.id).padStart(4, "0")}`,
  email: `user${row.id}@example.com`, department: departments[index % departments.length].value,
  roles: [roleOptions[index % roleOptions.length].value], status: index % 4 === 0 ? "disabled" : "enabled",
  birthday: `${1990 + index % 10}-06-15`, hobbies: [hobbyOptions[index % hobbyOptions.length]],
  notifications: index % 3 !== 0, createdAt: `2026-${String(1 + index % 8).padStart(2, "0")}-${String(1 + index % 27).padStart(2, "0")}`,
}));
let nextId = Math.max(...dataSource.map(row => row.id)) + 1;
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 180));
const matches = (text: string, search?: string) => !search || text.toLowerCase().includes(search.trim().toLowerCase());

export async function getStudentHttp(req: StudentSearchParams & { pageNum?: number; pageSize?: number }) {
  await wait();
  const filtered = dataSource.filter(row =>
    (!req.id || row.id === req.id) && matches(row.name, req.name) && matches(row.account, req.account) &&
    (!req.status || row.status === req.status) && (!req.department || row.department === req.department) &&
    (!req.roles?.length || req.roles.some(role => row.roles.includes(role))) &&
    (req.ageRange?.leftValue == null || row.age >= req.ageRange.leftValue) &&
    (req.ageRange?.rightValue == null || row.age <= req.ageRange.rightValue) &&
    (!req.registered?.[0] || row.createdAt >= req.registered[0]) &&
    (!req.registered?.[1] || row.createdAt <= req.registered[1])
  );
  const pageSize = [5, 10, 20, 50].includes(req.pageSize || 0) ? Number(req.pageSize) : 5;
  const pageNum = Math.max(1, Math.min(Math.floor(req.pageNum || 1), Math.ceil(filtered.length / pageSize) || 1));
  return { status: 1 as const, data: { list: structuredClone(filtered.slice((pageNum - 1) * pageSize, pageNum * pageSize)), total: filtered.length, pageNum, pageSize } };
}
function clean(input: UserInput): UserInput {
  const { name, account, age, gender, phone, email, department, roles, status, birthday, hobbies, notifications, avatar, des } = input;
  if (!name?.trim() || !/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(account || "")) throw new Error("请填写姓名和有效账号");
  if (dataSource.some(row => row.account.toLowerCase() === account.toLowerCase() && row.id !== (input as Student).id)) throw new Error("账号已存在，请更换账号");
  if (!departments.some(item => item.value === department) || !roles?.length || roles.some(role => !roleOptions.some(item => item.value === role))) throw new Error("请选择有效部门和角色");
  if (!Number.isInteger(age) || age < 1 || age > 120 || !/^1[3-9]\d{9}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("年龄或联系方式格式不正确");
  return { name: name.trim(), account, age, gender, phone, email, department, roles: [...roles], status,
    birthday, hobbies: [...(hobbies || [])], notifications, avatar, des: des || "" };
}
export async function setStudentHttp(req: UserInput & { id: number }) {
  await wait();
  const index = dataSource.findIndex(row => row.id === req.id);
  if (index === -1) throw new Error("用户不存在");
  dataSource[index] = { ...dataSource[index], ...clean(req) };
  return { status: 1 as const, data: 1 as const };
}
export async function addStudentHttp(req: UserInput) {
  await wait();
  const values = clean(req);
  dataSource.unshift({ ...values, id: nextId++, createdAt: new Date().toISOString().slice(0, 10), like: values.hobbies.join("、") });
  return { status: 1 as const, data: 1 as const };
}
export async function delStudentHttp(id: number) {
  await wait();
  const index = dataSource.findIndex(row => row.id === id);
  if (index === -1) throw new Error("用户不存在");
  dataSource.splice(index, 1);
  return { status: 1 as const, data: 1 as const };
}
export async function setStudentStatusHttp(ids: number[], status: Student["status"]) {
  await wait();
  if (!ids.length || ids.some(id => !dataSource.some(row => row.id === id))) throw new Error("请选择有效用户");
  dataSource.forEach(row => { if (ids.includes(row.id)) row.status = status; });
  return { status: 1 as const, data: ids.length };
}

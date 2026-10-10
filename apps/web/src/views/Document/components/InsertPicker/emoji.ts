export const emojiGroups = [
  {
    name: "表情",
    keywords: "face smile bx 表情 笑 开心",
    items:
      "😀 😃 😄 😁 😆 😅 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 🤪 🤔 🤨 😐 😶 😏 😒 🙄 😬 😌 😔 😴 😷 🤒 🤯 😎 🥳 😭 😤 😡 🥺 😱".split(
        " ",
      ),
  },
  {
    name: "手势",
    keywords: "hand gesture ss 手势 赞",
    items:
      "👋 🤚 ✋ 🖖 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 👍 👎 ✊ 👊 👏 🙌 👐 🤝 🙏 💪".split(
        " ",
      ),
  },
  {
    name: "自然",
    keywords: "nature animal zr 自然 动物 花",
    items:
      "🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐸 🦁 🐯 🐨 🐷 🐥 🦋 🐝 🐢 🐳 🌱 🌿 🍀 🌵 🌷 🌸 🌻 🌲 🌈 ☀️ 🌙 ⭐ 🌟 ⚡ 🔥 💧 ❄️".split(
        " ",
      ),
  },
  {
    name: "生活",
    keywords: "life food sh 生活 食物",
    items:
      "🍎 🍊 🍋 🍉 🍇 🍓 🍒 🥑 🍔 🍕 🍰 ☕ 🍵 🍺 🎂 🎉 🎊 🎁 🎈 🎵 🎸 🎨 🎮 ⚽ 🏀 🏆 🚀 🏠 💻 📱 📷 📚 📝 📌 💡 🔑 🔒".split(
        " ",
      ),
  },
  {
    name: "符号",
    keywords: "symbol fh 符号 心 完成 警告",
    items:
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💯 ✅ ☑️ ✔️ ❌ ❓ ❗ ⚠️ 🚧 ⏰ 📅 🔔 🔍 🎯 📊 📈 📉 🔗 ➡️ ⬅️ ⬆️ ⬇️".split(
        " ",
      ),
  },
];
export const emojiNames: Record<string, string> = {
  "😀": "开心 happy smile",
  "😊": "微笑 smile",
  "😂": "笑哭 laugh",
  "🤔": "思考 think",
  "👍": "赞 good like",
  "❤️": "爱心 heart",
  "🔥": "火 fire",
  "🎉": "庆祝 party",
  "💡": "灯泡 idea",
  "✅": "完成 check",
  "⚠️": "警告 warning",
  "📅": "日期 date",
  "🚀": "火箭 rocket",
  "📝": "笔记 note",
};
const labels = [
  "开心 笑 大笑 咧嘴笑 眯眼笑 汗 笑哭 微笑 倒脸 眨眼 微笑 天使 喜欢 爱心眼 星星眼 亲吻 美味 吐舌 鬼脸 思考 怀疑 无语 沉默 得意 不满 白眼 尴尬 放松 难过 睡觉 口罩 生病 震惊 墨镜 庆祝 哭泣 生气 愤怒 可怜 惊恐",
  "挥手 手 手掌 瓦肯 好 捏手 胜利 交叉手指 爱你 摇滚 电话 左 右 上 下 赞 踩 拳头 拳头 鼓掌 举手 双手 握手 祈祷 力量",
  "狗 猫 老鼠 兔子 狐狸 熊 熊猫 青蛙 狮子 老虎 考拉 猪 小鸡 蝴蝶 蜜蜂 乌龟 鲸鱼 幼苗 草叶 四叶草 仙人掌 郁金香 樱花 向日葵 树 彩虹 太阳 月亮 星星 闪亮 闪电 火 水 雪花",
  "苹果 橘子 柠檬 西瓜 葡萄 草莓 樱桃 牛油果 汉堡 披萨 蛋糕 咖啡 茶 啤酒 生日 庆祝 彩带 礼物 气球 音乐 吉他 绘画 游戏 足球 篮球 奖杯 火箭 房子 电脑 手机 相机 书 笔记 图钉 灯泡 钥匙 锁",
  "红心 橙心 黄心 绿心 蓝心 紫心 黑心 白心 心碎 爱心 满分 完成 勾选 对 错 问号 感叹号 警告 施工 闹钟 日期 铃铛 搜索 目标 图表 上升 下降 链接 右箭头 左箭头 上箭头 下箭头",
];
emojiGroups.forEach((group, i) =>
  group.items.forEach((emoji, j) => {
    emojiNames[emoji] =
      `${emojiNames[emoji] || ""} ${labels[i].split(" ")[j] || ""}`.trim();
  }),
);

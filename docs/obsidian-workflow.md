# Obsidian 联动工作流

## 现在的推荐方式

当前 MVP 最稳的方式是复制 Obsidian 笔记正文到“素材管理”的正文框：

1. 在 Obsidian 打开一篇笔记。
2. 复制正文 Markdown，不需要去掉标题、列表、引用、代码块。
3. 在 AI Learning Coach 进入“素材管理”。
4. 填写标题、来源类型、主题、标签、学习目标。
5. 把 Markdown 粘贴到“正文”，保存后生成测试。

适合作为测试素材的内容：

- 读书笔记中的一个章节或一个主题块。
- 会议纪要中与你要复盘的决策、问题、方法相关的部分。
- 课程笔记中的一个知识单元。
- 技术文档中一段完整的概念、流程或方案说明。

不建议一次导入整个 vault 或一本书的全部笔记。更好的粒度是“一次学习只围绕一个问题域”，例如“Agent 与传统自动化的区别”“制造企业 CIO 沟通逻辑”“React Server Components 心智模型”。

## 结果如何回到 Obsidian

答题结束后，在“AI反馈”页点击“复制到 Obsidian”。它会复制一段 Markdown，包含：

- 来源和日期
- 总分
- 能力画像
- 当前掌握
- 知识漏洞
- 建议补充
- 实践任务
- 下一次复习重点
- 逐题反馈

推荐在 Obsidian 中新建或追加到：

```text
Learning Insights/
  2026-07-14 Agent 价值与企业流程重构.md
```

也可以追加到原笔记末尾：

```markdown
---

## AI Learning Coach Insight

粘贴复制的内容
```

原则是“不覆盖原笔记，只追加学习反馈”。原笔记负责记录输入，Learning Insight 负责记录理解漏洞、应用建议和下一次复习重点。

## 下一步自动化方案

### 方案 A：Obsidian 手动复制，当前已支持

优点是最稳定，不需要插件和本地权限。适合现在测试产品闭环。

### 方案 B：导入 `.md` 文件

在网页增加文件选择器，读取本地 Markdown 文件内容并自动填充标题、正文、标签。这个方案不需要访问整个 vault，浏览器安全限制也少。

### 方案 C：本地 Vault 同步脚本

写一个本地脚本扫描指定 Obsidian 目录，把最近修改的 Markdown 解析成素材，再调用 Supabase 写入 `learning_sources`。适合你长期使用。

### 方案 D：Obsidian 插件

做一个 Obsidian 插件，在笔记命令面板里提供：

- Send to AI Learning Coach
- Append Learning Insight
- Create Anki Review Draft

这是体验最顺的方案，但开发成本最高，建议等 MVP 跑顺后再做。

## 推荐路线

先用方案 A 跑 10 到 20 条真实素材，确认题目质量、批改口径和结果格式。稳定后做方案 B，再做方案 C。Obsidian 插件放到最后。

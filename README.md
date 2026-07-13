# Personal AI Learning Coach

个人 AI 学习教练平台。它把 Markdown/TXT/手动粘贴的知识素材转成主动提问、答题、AI 批改、薄弱点识别和学习建议，服务于个人的理解、应用和输出能力强化。

## 当前 MVP

- React + TypeScript + Vite + Tailwind CSS Web 应用
- 素材管理：标题、来源类型、主题、正文、标签、学习目标
- Knowledge Analyzer：先分析知识结构，再生成题目
- Skill Strategy Layer：按素材类型路由学习策略
- Question Generator：生成应用、分析、批判、表达导向的问题
- Question Quality Reviewer：对题目做 100 分制质量审核
- Answer Evaluator：按概念、逻辑、应用、批判、表达评分
- Learning Recommendation：生成 Learning Insight 和下一轮强化建议
- Dashboard、素材管理、测试生成、答题、AI反馈、历史记录、能力分析页面
- Supabase schema 与可选持久化
- DeepSeek Serverless API 调用入口
- localStorage 本地兜底，未配置外部服务也能跑通

## 项目结构

```text
.
├─ ai-skills/                 # 独立 skill 配置
├─ cloud-functions/api/ai.js   # EdgeOne Makers Node Cloud Function DeepSeek 入口
├─ prompts/                    # 独立 Prompt 管理
├─ public/
├─ src/
│  ├─ ai-skills/               # 前端可测试的本地 skill 实现
│  ├─ data/
│  ├─ lib/
│  ├─ services/
│  ├─ App.tsx
│  └─ main.tsx
├─ supabase/schema.sql         # 数据库初始化 SQL
├─ edgeone.json
├─ .env.example
└─ TODO.md
```

## 本地运行

```bash
npm install
npm run dev
```

构建验证：

```bash
npm run build
npm run test:skills
```

## 环境变量

复制 `.env.example` 为 `.env.local`。

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_USE_REMOTE_AI=false
VITE_AI_ENDPOINT=/api/ai

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

说明：

- `VITE_USE_REMOTE_AI=false` 时，前端使用本地 skill 引擎演示完整闭环。
- `VITE_USE_REMOTE_AI=true` 时，前端会请求 `VITE_AI_ENDPOINT`。
- `DEEPSEEK_API_KEY` 只应配置在 Serverless 环境，不要暴露到前端。

## Supabase 配置

1. 新建 Supabase 项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`。
3. 在 `.env.local` 配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
4. MVP 默认个人使用，未开启复杂多用户权限；正式联网前建议补充 RLS 策略。

## DeepSeek 配置

Serverless 函数位于 `cloud-functions/api/ai.js`。EdgeOne Makers 会把它映射到 `/api/ai`，使用 DeepSeek OpenAI 兼容的 `/chat/completions` 调用方式。

需要在 EdgeOne Pages 的环境变量中配置：

```env
DEEPSEEK_API_KEY=你的 Key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

如果你的 DeepSeek 控制台模型名不同，只需要调整 `DEEPSEEK_MODEL`。

## EdgeOne Pages 部署

构建配置已经写入 `edgeone.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "installCommand": "npm install"
}
```

部署步骤：

1. 将项目推送到 Git 仓库。
2. 在 EdgeOne Pages 选择该仓库。
3. 构建命令使用 `npm run build`。
4. 输出目录使用 `dist`。
5. 配置 Supabase 与 DeepSeek 环境变量。
6. 部署后打开站点，确认 `/api/ai` 可被前端访问。

## 数据库初始化 SQL

见 [supabase/schema.sql](./supabase/schema.sql)。

## 后续优化建议

- 加 RLS 与本地身份标识，保证个人数据隔离。
- 把 Serverless prompt 从内联常量改为构建期注入，保持 `prompts/` 为唯一真源。
- 增加 Obsidian Vault 与 Anki 同步。
- 接入 PDF、网页解析和语音回答。
- 增加学习计划、复习间隔和知识图谱。

# Personal AI Learning Coach

个人 AI 学习教练平台。它把 Markdown/TXT/手动粘贴的知识素材转成主动提问、答题、AI 批改、薄弱点识别和学习建议，服务于个人的理解、应用和输出能力强化。

## 当前 MVP

- React + TypeScript + Vite + Tailwind CSS Web 应用
- 素材管理：标题、来源类型、主题、正文、标签、学习目标
- Knowledge Analyzer：先分析知识结构，再生成题目
- Skill Strategy Layer：按素材类型路由学习策略
- Question Generator：生成开放题或选择题，开放题偏应用、分析、批判、表达，选择题偏概念辨析
- Question Quality Reviewer：对题目做 100 分制质量审核
- Answer Evaluator：开放题通过远程大模型批改，选择题按标准选项确定判分
- Learning Recommendation：生成 Learning Insight 和下一轮强化建议
- Dashboard、素材管理、测试生成、答题、AI反馈、历史记录、能力分析页面
- Supabase schema 与可选持久化
- DeepSeek Serverless API 调用入口
- localStorage 本地兜底；开放题的本地批改仅用于开发演示，生产建议强制使用远程大模型

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
VITE_USE_REMOTE_AI=true
VITE_ALLOW_REMOTE_FALLBACK=false
VITE_REMOTE_EVAL_CONCURRENCY=1
VITE_AI_ENDPOINT=/api/ai

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_EVALUATOR_THINKING=disabled
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MAX_TOKENS=
DEEPSEEK_TIMEOUT_MS=7500
```

说明：

- `VITE_USE_REMOTE_AI=false` 时，前端使用本地 skill 引擎演示完整闭环。
- `VITE_USE_REMOTE_AI=true` 时，前端会请求 `VITE_AI_ENDPOINT`。
- `VITE_ALLOW_REMOTE_FALLBACK=false` 时，开放题批改如果远程模型失败会直接报错，不会静默切回关键词/规则批改。
- `VITE_REMOTE_EVAL_CONCURRENCY` 控制开放题逐题远程批改的并发数，默认 1；跑稳后可以调到 2 或 3。
- `DEEPSEEK_MAX_TOKENS` 是可选全局覆盖项；留空时函数会按 skill 自动设置输出预算，且开放题批改会被硬限制在 1200 以内。
- `DEEPSEEK_TIMEOUT_MS` 是函数内主动中止 DeepSeek 调用的时间，默认开放题批改 7500ms，且开放题批改会被硬限制在 8000ms 以内。
- `DEEPSEEK_EVALUATOR_THINKING=disabled` 表示开放题批改仍使用 Pro 模型，但关闭单题批改的思考模式，避免 EdgeOne 短函数超时；题目生成默认仍启用思考模式。
- `DEEPSEEK_API_KEY` 只应配置在 Serverless 环境，不要暴露到前端。

## Supabase 配置

1. 新建 Supabase 项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`。
3. 在 `.env.local` 配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
4. MVP 默认个人使用，未开启复杂多用户权限；正式联网前建议补充 RLS 策略。

## DeepSeek 配置

Serverless 函数位于 `cloud-functions/api/ai.js`。EdgeOne Makers 会把它映射到 `/api/ai`，使用 DeepSeek OpenAI 兼容的 `/chat/completions` 调用方式。

Prompt 的唯一维护位置是 `prompts/*/prompt.md`。构建前会自动运行：

```bash
npm run sync:prompts
```

该命令会生成 `cloud-functions/api/generated-prompts.js`，供 EdgeOne Cloud Function import。平时只需要改 `prompts/`，不要手动改生成文件。

需要在 EdgeOne Pages 的环境变量中配置：

```env
DEEPSEEK_API_KEY=你的 Key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_EVALUATOR_THINKING=disabled
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MAX_TOKENS=
DEEPSEEK_TIMEOUT_MS=7500
```

建议保持 `DEEPSEEK_MODEL=deepseek-v4-pro`，保证题目生成和开放题批改都使用 Pro 模型。如果你的 DeepSeek 控制台模型名不同，只需要调整 `DEEPSEEK_MODEL`。

前端构建环境还需要配置：

```env
VITE_USE_REMOTE_AI=true
VITE_ALLOW_REMOTE_FALLBACK=false
VITE_REMOTE_EVAL_CONCURRENCY=1
VITE_AI_ENDPOINT=/api/ai
VITE_SUPABASE_URL=你的 Supabase Project URL
VITE_SUPABASE_ANON_KEY=你的 Supabase anon public key
```

说明：开放题批改会强制走 DeepSeek；选择题有明确正确答案，判分不需要调用大模型。
如果开放题批改出现 `504 CLOUD_FUNCTION_INVOCATION_TIMEOUT`，说明 EdgeOne 函数等待模型返回超时。当前实现已经把开放题拆成逐题请求、压缩单题输入，并为 `answer-evaluator` 使用较小的默认输出预算；仍超时时，保持 Pro 模型不变，下一步应把 `/api/ai` 迁移到支持更长执行时间的后端或改成异步任务，而不是降级模型。

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
- 增加 Obsidian Vault 与 Anki 同步。
- 接入 PDF、网页解析和语音回答。
- 增加学习计划、复习间隔和知识图谱。

## Obsidian 工作流

当前建议用“复制 Obsidian Markdown 正文到素材管理”的方式导入测试素材。答题结束后，可在 AI 反馈页点击“复制到 Obsidian”，把 Learning Insight 以 Markdown 形式追加回 Obsidian。

详细方案见 [docs/obsidian-workflow.md](./docs/obsidian-workflow.md)。

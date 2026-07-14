import {
  Activity,
  BarChart3,
  BookOpenText,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Database,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Play,
  Plus,
  Send,
  Sparkles,
  Target,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import type {
  AbilityKey,
  AppState,
  Evaluation,
  KnowledgeAnalysis,
  LearningMode,
  LearningSource,
  QuestionSet,
  SourceType,
  UserAnswer,
} from './types';
import { createId } from './lib/id';
import { ABILITY_LABEL, SOURCE_TYPE_LABEL, formatDate, toPercent } from './lib/format';
import { isSupabaseConfigured } from './lib/supabase';
import {
  initialState,
  loadState,
  persistAnalysis,
  persistQuestionSet,
  persistReport,
  persistSource,
  persistStudySession,
  saveState,
} from './services/repository';
import {
  runAnswerEvaluation,
  runKnowledgeAnalysis,
  runLearningReport,
  runQuestionGeneration,
} from './services/aiClient';

type ViewKey = 'dashboard' | 'sources' | 'generate' | 'answer' | 'feedback' | 'history' | 'ability';

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'sources', label: '素材管理', icon: FileText },
  { key: 'generate', label: '测试生成', icon: Brain },
  { key: 'answer', label: '答题页面', icon: MessageSquareText },
  { key: 'feedback', label: 'AI反馈', icon: Sparkles },
  { key: 'history', label: '历史记录', icon: History },
  { key: 'ability', label: '能力分析', icon: BarChart3 },
];

const abilityKeys: AbilityKey[] = ['concept', 'logic', 'application', 'critical', 'expression'];

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [selectedSourceId, setSelectedSourceId] = useState(state.sources[0]?.id ?? '');
  const [activeSetId, setActiveSetId] = useState('');
  const [activeReportId, setActiveReportId] = useState('');
  const [loading, setLoading] = useState('');

  useEffect(() => {
    saveState(state);
  }, [state]);

  const selectedSource = state.sources.find((source) => source.id === selectedSourceId) ?? state.sources[0];
  const activeQuestionSet = state.questionSets.find((set) => set.id === activeSetId) ?? state.questionSets.at(-1);
  const activeAnalysis = selectedSource
    ? state.analyses.find((analysis) => analysis.sourceId === selectedSource.id)
    : undefined;
  const activeReport =
    state.reports.find((report) => report.id === activeReportId) ??
    state.reports.find((report) => report.questionSetId === activeQuestionSet?.id) ??
    state.reports.at(-1);
  const activeEvaluations = activeReport ? state.evaluations[activeReport.questionSetId] ?? [] : [];
  const activeReportSource = activeReport ? state.sources.find((source) => source.id === activeReport.sourceId) : undefined;

  const latestReport = state.reports.at(-1);
  const averageScore = useMemo(() => {
    if (!state.reports.length) return 0;
    return Math.round(state.reports.reduce((sum, report) => sum + report.score, 0) / state.reports.length);
  }, [state.reports]);

  async function ensureAnalysis(source: LearningSource): Promise<KnowledgeAnalysis> {
    const existing = state.analyses.find((analysis) => analysis.sourceId === source.id);
    if (existing) return existing;

    setLoading('正在分析知识结构');
    const result = await runKnowledgeAnalysis(source);
    setState((current) => ({ ...current, analyses: [...current.analyses, result.data] }));
    void persistAnalysis(result.data);
    return result.data;
  }

  async function handleGenerate(mode: LearningMode, count?: number) {
    if (!selectedSource) return;

    setLoading(mode === 'exam' ? '正在生成高价值题目' : '正在准备 AI 陪练问题');
    const analysis = await ensureAnalysis(selectedSource);
    const result = await runQuestionGeneration(selectedSource, analysis, mode, count);
    setState((current) => ({ ...current, questionSets: [...current.questionSets, result.data] }));
    void persistQuestionSet(result.data);
    setActiveSetId(result.data.id);
    setActiveView('answer');
    setLoading('');
  }

  async function handleSubmitAnswers(questionSet: QuestionSet, answers: UserAnswer[]) {
    const source = state.sources.find((item) => item.id === questionSet.sourceId);
    const analysis = state.analyses.find((item) => item.id === questionSet.analysisId);
    if (!source || !analysis) return;

    setLoading('AI 正在批改答案');
    const evaluationResult = await runAnswerEvaluation(questionSet, answers);
    const reportResult = await runLearningReport(source, analysis, questionSet, evaluationResult.data);

    setState((current) => ({
      ...current,
      answers: { ...current.answers, [questionSet.id]: answers },
      evaluations: { ...current.evaluations, [questionSet.id]: evaluationResult.data },
      reports: [...current.reports, reportResult.data],
    }));
    void persistStudySession(questionSet.id, answers, evaluationResult.data);
    void persistReport(reportResult.data);
    setActiveReportId(reportResult.data.id);
    setActiveView('feedback');
    setLoading('');
  }

  function handleAddSource(source: LearningSource) {
    setState((current) => ({ ...current, sources: [source, ...current.sources] }));
    setSelectedSourceId(source.id);
    void persistSource(source);
  }

  function resetDemo() {
    setState(initialState);
    setSelectedSourceId(initialState.sources[0].id);
    setActiveSetId('');
    setActiveReportId('');
    setActiveView('dashboard');
  }

  const view = {
    dashboard: (
      <DashboardView
        state={state}
        averageScore={averageScore}
        latestReport={latestReport}
        onNavigate={setActiveView}
        onSelectSource={setSelectedSourceId}
      />
    ),
    sources: <SourcesView sources={state.sources} onAdd={handleAddSource} onSelectSource={setSelectedSourceId} />,
    generate: (
      <GenerateView
        sources={state.sources}
        selectedSourceId={selectedSourceId}
        onSelectSource={setSelectedSourceId}
        analysis={activeAnalysis}
        onGenerate={handleGenerate}
      />
    ),
    answer: activeQuestionSet ? (
      <AnswerView questionSet={activeQuestionSet} onSubmit={handleSubmitAnswers} savedAnswers={state.answers[activeQuestionSet.id]} />
    ) : (
      <EmptyView title="还没有题目" action="去生成测试" onAction={() => setActiveView('generate')} />
    ),
    feedback: activeReport ? (
      <FeedbackView
        report={activeReport}
        evaluations={activeEvaluations}
        questionSet={activeQuestionSet}
        source={activeReportSource}
      />
    ) : (
      <EmptyView title="还没有 AI 反馈" action="开始答题" onAction={() => setActiveView('generate')} />
    ),
    history: (
      <HistoryView
        state={state}
        onOpen={(reportId) => {
          const report = state.reports.find((item) => item.id === reportId);
          if (report) setActiveSetId(report.questionSetId);
          setActiveReportId(reportId);
          setActiveView('feedback');
        }}
      />
    ),
    ability: <AbilityView reports={state.reports} />,
  }[activeView];

  return (
    <div className="min-h-screen text-ink">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:px-8 lg:py-6">
        <aside className="panel flex shrink-0 flex-col gap-4 p-3 lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:w-64">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-ink text-white">
              <BookOpenText size={22} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">AI Learning Coach</h1>
              <p className="text-sm text-slate-500">Personal workspace</p>
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-col" aria-label="主导航">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveView(item.key)}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active ? 'bg-ink text-white shadow-lift' : 'text-slate-600 hover:bg-slate-100 hover:text-ink'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto hidden border-t border-line px-2 pt-4 lg:block">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Database size={16} aria-hidden="true" />
              {isSupabaseConfigured ? 'Supabase 已连接' : '本地演示存储'}
            </div>
            <button
              type="button"
              onClick={resetDemo}
              className="mt-3 min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              重置演示数据
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-cobalt">Personal AI Learning Coach</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">{navItems.find((item) => item.key === activeView)?.label}</h2>
            </div>
            <div className="flex items-center gap-2">
              {loading && <LoadingPill label={loading} />}
              <button
                type="button"
                onClick={() => setActiveView('generate')}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cobalt px-4 text-sm font-semibold text-white shadow-lift transition hover:bg-blue-700"
              >
                <Play size={17} aria-hidden="true" />
                开始学习
              </button>
            </div>
          </header>
          <div className="animate-reveal">{view}</div>
        </main>
      </div>
    </div>
  );
}

function DashboardView({
  state,
  averageScore,
  latestReport,
  onNavigate,
  onSelectSource,
}: {
  state: AppState;
  averageScore: number;
  latestReport?: AppState['reports'][number];
  onNavigate: (view: ViewKey) => void;
  onSelectSource: (id: string) => void;
}) {
  const latestSource = state.sources[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <section className="panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-slate-500">学习闭环</p>
            <h3 className="mt-3 text-3xl font-semibold leading-tight tracking-normal sm:text-5xl">
              把笔记变成真正可输出的能力。
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('generate')}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            <Sparkles size={17} aria-hidden="true" />
            生成测试
          </button>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <MetricCard icon={FileText} label="素材" value={state.sources.length.toString()} tone="blue" />
          <MetricCard icon={CheckCircle2} label="学习记录" value={state.reports.length.toString()} tone="green" />
          <MetricCard icon={Activity} label="平均分" value={averageScore ? averageScore.toString() : '--'} tone="neutral" />
        </div>

        {latestReport ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <ScorePanel score={latestReport.score} label="最近一次表现" />
            <div className="surface p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">能力画像</p>
                  <h4 className="text-lg font-semibold">{latestReport.learningInsight.topic}</h4>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{formatDate(latestReport.createdAt)}</span>
              </div>
              <AbilityBars ability={latestReport.ability} />
            </div>
          </div>
        ) : (
          <div className="mt-6 surface p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-slate-500">最近素材</p>
                <h4 className="text-lg font-semibold">{latestSource.title}</h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  onSelectSource(latestSource.id);
                  onNavigate('generate');
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold transition hover:bg-white"
              >
                <Target size={17} aria-hidden="true" />
                选择素材
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">知识薄弱地图</p>
            <h3 className="text-xl font-semibold">下一轮强化</h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('ability')}
            className="grid h-11 w-11 place-items-center rounded-lg border border-line transition hover:bg-slate-50"
            aria-label="查看能力分析"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {(latestReport?.recommendations.gaps ?? ['应用场景和行动步骤还不够具体', '风险边界和反例意识可以继续加强']).map(
            (gap, index) => (
              <div key={gap} className="rounded-lg border border-line bg-white/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{gap}</p>
                  <span className="text-sm tabular-nums text-slate-500">{index + 1}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-amber" style={{ width: `${78 - index * 12}%` }} />
                </div>
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

function SourcesView({
  sources,
  onAdd,
  onSelectSource,
}: {
  sources: LearningSource[];
  onAdd: (source: LearningSource) => void;
  onSelectSource: (id: string) => void;
}) {
  const [form, setForm] = useState({
    title: '',
    type: 'article' as SourceType,
    topic: '',
    tags: '',
    goal: '',
    content: '',
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;

    onAdd({
      id: createId('source'),
      title: form.title.trim(),
      type: form.type,
      topic: form.topic.trim() || form.title.trim(),
      tags: form.tags
        .split(/[,，\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      goal: form.goal.trim(),
      content: form.content.trim(),
      createdAt: new Date().toISOString(),
    });
    setForm({ title: '', type: 'article', topic: '', tags: '', goal: '', content: '' });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="panel p-5 sm:p-6">
        <h3 className="text-xl font-semibold">新增学习素材</h3>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <Field label="标题">
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="h-11 w-full rounded-lg border border-line bg-white px-3"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="来源类型">
              <select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value as SourceType })}
                className="h-11 w-full rounded-lg border border-line bg-white px-3"
              >
                {Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="主题">
              <input
                value={form.topic}
                onChange={(event) => setForm({ ...form, topic: event.target.value })}
                className="h-11 w-full rounded-lg border border-line bg-white px-3"
              />
            </Field>
          </div>
          <Field label="标签">
            <input
              value={form.tags}
              onChange={(event) => setForm({ ...form, tags: event.target.value })}
              className="h-11 w-full rounded-lg border border-line bg-white px-3"
              placeholder="AI, Agent, 流程"
            />
          </Field>
          <Field label="学习目标">
            <input
              value={form.goal}
              onChange={(event) => setForm({ ...form, goal: event.target.value })}
              className="h-11 w-full rounded-lg border border-line bg-white px-3"
            />
          </Field>
          <Field label="正文">
            <textarea
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              className="min-h-56 w-full resize-y rounded-lg border border-line bg-white p-3 leading-7"
              required
            />
          </Field>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            <Plus size={17} aria-hidden="true" />
            保存素材
          </button>
        </form>
      </section>

      <section className="panel p-5 sm:p-6">
        <h3 className="text-xl font-semibold">素材库</h3>
        <div className="mt-5 space-y-3">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => onSelectSource(source.id)}
              className="w-full rounded-lg border border-line bg-white/75 p-4 text-left transition hover:border-cobalt hover:bg-white"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="font-semibold">{source.title}</h4>
                  <p className="mt-1 text-sm text-slate-500">
                    {SOURCE_TYPE_LABEL[source.type]} · {source.topic || '未设置主题'}
                  </p>
                </div>
                <span className="text-sm text-slate-500">{formatDate(source.createdAt)}</span>
              </div>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{source.content}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function GenerateView({
  sources,
  selectedSourceId,
  onSelectSource,
  analysis,
  onGenerate,
}: {
  sources: LearningSource[];
  selectedSourceId: string;
  onSelectSource: (id: string) => void;
  analysis?: KnowledgeAnalysis;
  onGenerate: (mode: LearningMode, count?: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<LearningMode>('exam');
  const [count, setCount] = useState(5);
  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? sources[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="panel p-5 sm:p-6">
        <h3 className="text-xl font-semibold">测试配置</h3>
        <div className="mt-5 space-y-4">
          <Field label="选择素材">
            <select
              value={selectedSource?.id ?? ''}
              onChange={(event) => onSelectSource(event.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-white px-3"
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">答题模式</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
              {([
                ['exam', '考试模式'],
                ['coach', 'AI陪练'],
              ] as Array<[LearningMode, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`min-h-11 rounded-md text-sm font-semibold transition ${
                    mode === value ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Field label="题目数量">
            <input
              type="number"
              min={3}
              max={15}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className="h-11 w-full rounded-lg border border-line bg-white px-3"
            />
          </Field>

          <button
            type="button"
            onClick={() => void onGenerate(mode, count)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cobalt px-4 text-sm font-semibold text-white shadow-lift transition hover:bg-blue-700"
          >
            <Sparkles size={17} aria-hidden="true" />
            生成题目
          </button>
        </div>
      </section>

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">{selectedSource ? SOURCE_TYPE_LABEL[selectedSource.type] : '素材'}</p>
            <h3 className="text-xl font-semibold">{selectedSource?.title ?? '请选择素材'}</h3>
          </div>
          {analysis && <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-cobalt">{analysis.strategy}</span>}
        </div>

        {analysis ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <AnalysisList title="核心概念" items={analysis.concepts} />
            <AnalysisList title="应用场景" items={analysis.applications} />
            <AnalysisList title="因果关系" items={analysis.logic} />
            <AnalysisList title="争议边界" items={analysis.controversies} />
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-6 text-slate-600">
            <p className="font-medium">生成题目前会先完成知识结构分析。</p>
          </div>
        )}
      </section>
    </div>
  );
}

function AnswerView({
  questionSet,
  savedAnswers,
  onSubmit,
}: {
  questionSet: QuestionSet;
  savedAnswers?: UserAnswer[];
  onSubmit: (questionSet: QuestionSet, answers: UserAnswer[]) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries((savedAnswers ?? []).map((answer) => [answer.questionId, answer.answer])),
  );

  function update(questionId: string, answer: string) {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  }

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{questionSet.mode === 'exam' ? '考试模式' : 'AI 陪练模式'}</p>
          <h3 className="text-xl font-semibold">{questionSet.questionCount} 道高价值问题</h3>
        </div>
        <button
          type="button"
          onClick={() =>
            void onSubmit(
              questionSet,
              questionSet.questions.map((question) => ({
                questionId: question.id,
                answer: answers[question.id] ?? '',
              })),
            )
          }
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          <Send size={17} aria-hidden="true" />
          提交批改
        </button>
      </div>

      <div className="mt-5 space-y-4">
        {questionSet.questions.map((question, index) => (
          <article key={question.id} className="rounded-lg border border-line bg-white/78 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-cobalt">
                  Q{index + 1} · {question.bloomLevel} · 审题 {question.reviewScore}
                </p>
                <h4 className="mt-2 text-lg font-semibold leading-7">{question.question}</h4>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{question.knowledgePoint}</span>
            </div>
            {question.contextHint && (
              <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-sm leading-6 text-slate-700">
                {question.contextHint}
              </div>
            )}
            <textarea
              value={answers[question.id] ?? ''}
              onChange={(event) => update(question.id, event.target.value)}
              className="mt-4 min-h-36 w-full resize-y rounded-lg border border-line bg-white p-3 leading-7"
              aria-label={`回答第 ${index + 1} 题`}
            />
            {questionSet.mode === 'coach' && (
              <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                <span className="h-2 w-2 rounded-full bg-mint" />
                回答后会生成追问方向
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function FeedbackView({
  report,
  evaluations,
  questionSet,
  source,
}: {
  report: AppState['reports'][number];
  evaluations: Evaluation[];
  questionSet?: QuestionSet;
  source?: LearningSource;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyToObsidian() {
    try {
      await navigator.clipboard.writeText(buildObsidianInsightMarkdown(report, evaluations, questionSet, source));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2400);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2400);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
      <section className="panel p-5 sm:p-6">
        <ScorePanel score={report.score} label="AI 批改总分" />
        <div className="mt-5">
          <h3 className="text-lg font-semibold">能力画像</h3>
          <div className="mt-4">
            <AbilityBars ability={report.ability} />
          </div>
        </div>
      </section>

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Learning Insight</p>
            <h3 className="text-xl font-semibold">{report.learningInsight.topic}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyToObsidian()}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {copyState === 'copied' ? <CheckCircle2 size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
              {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制到 Obsidian'}
            </button>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{formatDate(report.createdAt)}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <InsightBlock title="当前掌握" items={[report.recommendations.mastery]} />
          <InsightBlock title="知识漏洞" items={report.recommendations.gaps} />
          <InsightBlock title="建议补充" items={report.recommendations.supplements} />
          <InsightBlock title="实践任务" items={report.recommendations.practiceTasks} />
        </div>
      </section>

      <section className="panel p-5 sm:p-6 xl:col-span-2">
        <h3 className="text-xl font-semibold">逐题反馈</h3>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {evaluations.map((evaluation, index) => {
            const question = questionSet?.questions.find((item) => item.id === evaluation.questionId);
            return (
              <article key={evaluation.questionId} className="rounded-lg border border-line bg-white/78 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-cobalt">Q{index + 1}</p>
                    <h4 className="mt-1 font-semibold leading-6">{question?.question}</h4>
                  </div>
                  <span className="text-xl font-semibold tabular-nums">{evaluation.score}</span>
                </div>
                <div className="mt-4 space-y-3">
                  <MiniList title="参考答案" items={[question?.expectedAnswer ?? '暂无参考答案']} />
                  {question?.evaluationCriteria?.length ? <MiniList title="评价要点" items={question.evaluationCriteria} /> : null}
                  <MiniList title="优势" items={evaluation.strengths} />
                  <MiniList title="缺口" items={evaluation.weaknesses} />
                  {evaluation.missingPoints.length ? <MiniList title="缺失材料点" items={evaluation.missingPoints} /> : null}
                  <MiniList title="追问" items={evaluation.followUpQuestions} />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function HistoryView({ state, onOpen }: { state: AppState; onOpen: (reportId: string) => void }) {
  return (
    <section className="panel p-5 sm:p-6">
      <h3 className="text-xl font-semibold">学习记录</h3>
      <div className="mt-5 space-y-3">
        {state.reports.length ? (
          [...state.reports].reverse().map((report) => {
            const source = state.sources.find((item) => item.id === report.sourceId);
            return (
              <button
                type="button"
                key={report.id}
                onClick={() => onOpen(report.id)}
                className="w-full rounded-lg border border-line bg-white/78 p-4 text-left transition hover:border-cobalt hover:bg-white"
              >
                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div>
                    <h4 className="font-semibold">{source?.title ?? '未知素材'}</h4>
                    <p className="mt-1 text-sm text-slate-500">
                      {report.mode === 'exam' ? '考试模式' : 'AI陪练'} · {formatDate(report.createdAt)}
                    </p>
                  </div>
                  <span className="text-2xl font-semibold tabular-nums">{report.score}</span>
                  <ChevronRight size={18} className="hidden text-slate-400 md:block" aria-hidden="true" />
                </div>
              </button>
            );
          })
        ) : (
          <EmptyInline title="还没有学习记录" />
        )}
      </div>
    </section>
  );
}

function AbilityView({ reports }: { reports: AppState['reports'] }) {
  const latest = reports.at(-1);
  const ability = latest?.ability ?? {
    concept: 0,
    logic: 0,
    application: 0,
    critical: 0,
    expression: 0,
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <section className="panel p-5 sm:p-6">
        <h3 className="text-xl font-semibold">能力雷达</h3>
        <div className="mt-5">
          <AbilityBars ability={ability} />
        </div>
      </section>
      <section className="panel p-5 sm:p-6">
        <h3 className="text-xl font-semibold">趋势记录</h3>
        <div className="mt-5 space-y-3">
          {reports.length ? (
            reports.slice(-6).map((report) => (
              <div key={report.id} className="rounded-lg border border-line bg-white/78 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="font-medium">{formatDate(report.createdAt)}</span>
                  <span className="font-semibold tabular-nums">{report.score}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-cobalt" style={{ width: toPercent(report.score) }} />
                </div>
              </div>
            ))
          ) : (
            <EmptyInline title="完成一次答题后会出现趋势" />
          )}
        </div>
      </section>
    </div>
  );
}

function AbilityBars({ ability }: { ability: Record<AbilityKey, number> }) {
  return (
    <div className="space-y-3">
      {abilityKeys.map((key) => (
        <div key={key}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-700">{ABILITY_LABEL[key]}</span>
            <span className="tabular-nums text-slate-500">{toPercent(ability[key])}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div
              className="h-2.5 rounded-full bg-cobalt transition-[width] duration-300"
              style={{ width: toPercent(ability[key]) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ScorePanel({ score, label }: { score: number; label: string }) {
  const normalized = Math.max(0, Math.min(100, score));
  return (
    <div className="surface grid place-items-center p-6 text-center">
      <div
        className="grid h-44 w-44 place-items-center rounded-full"
        style={{
          background: `conic-gradient(#2563eb ${normalized * 3.6}deg, #e5e7eb 0deg)`,
        }}
        aria-label={`${label} ${score} 分`}
      >
        <div className="grid h-36 w-36 place-items-center rounded-full bg-white">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-5xl font-semibold tabular-nums">{score || '--'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  tone: 'blue' | 'green' | 'neutral';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-cobalt',
    green: 'bg-emerald-50 text-mint',
    neutral: 'bg-slate-100 text-slate-600',
  }[tone];

  return (
    <div className="rounded-lg border border-line bg-white/78 p-4">
      <div className={`grid h-11 w-11 place-items-center rounded-lg ${toneClass}`}>
        <Icon size={20} aria-hidden="true" />
      </div>
      <p className="mt-4 text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function buildObsidianInsightMarkdown(
  report: AppState['reports'][number],
  evaluations: Evaluation[],
  questionSet?: QuestionSet,
  source?: LearningSource,
): string {
  const lines = [
    `# Learning Insight - ${report.learningInsight.topic}`,
    '',
    `- 来源：${source?.title ?? report.learningInsight.topic}`,
    `- 日期：${new Date(report.createdAt).toLocaleString('zh-CN')}`,
    `- 模式：${report.mode === 'exam' ? '考试模式' : 'AI 陪练模式'}`,
    `- 总分：${report.score}`,
    '',
    '## 能力画像',
    '',
    `- 概念：${report.ability.concept}`,
    `- 逻辑：${report.ability.logic}`,
    `- 应用：${report.ability.application}`,
    `- 批判：${report.ability.critical}`,
    `- 表达：${report.ability.expression}`,
    '',
    '## 当前掌握',
    '',
    report.recommendations.mastery,
    '',
    '## 知识漏洞',
    '',
    ...report.recommendations.gaps.map((item) => `- ${item}`),
    '',
    '## 建议补充',
    '',
    ...report.recommendations.supplements.map((item) => `- ${item}`),
    '',
    '## 实践任务',
    '',
    ...report.recommendations.practiceTasks.map((item) => `- ${item}`),
    '',
    '## 下一次复习重点',
    '',
    ...report.recommendations.nextReviewFocus.map((item) => `- ${item}`),
  ];

  if (questionSet && evaluations.length) {
    lines.push('', '## 逐题反馈', '');
    evaluations.forEach((evaluation, index) => {
      const question = questionSet.questions.find((item) => item.id === evaluation.questionId);
      lines.push(
        `### Q${index + 1}`,
        '',
        question?.question ?? '',
        '',
        question?.contextHint ? `> ${question.contextHint}` : '',
        '',
        `**参考答案**：${question?.expectedAnswer ?? '暂无参考答案'}`,
        '',
        `- 得分：${evaluation.score}`,
        `- 优势：${evaluation.strengths.join('；')}`,
        `- 缺口：${evaluation.weaknesses.join('；')}`,
        `- 缺失材料点：${evaluation.missingPoints.join('；') || '无'}`,
        `- 追问：${evaluation.followUpQuestions.join('；')}`,
        '',
      );
    });
  }

  return lines.join('\n');
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line bg-white/78 p-4">
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
        {(items.length ? items : ['等待分析结果']).slice(0, 4).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function InsightBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line bg-white/78 p-4">
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <ul className="mt-1 space-y-1 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyView({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <section className="panel grid min-h-72 place-items-center p-8 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-blue-50 text-cobalt">
          <Sparkles size={22} aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-xl font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-cobalt px-4 text-sm font-semibold text-white"
        >
          <Play size={17} aria-hidden="true" />
          {action}
        </button>
      </div>
    </section>
  );
}

function EmptyInline({ title }: { title: string }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">{title}</div>;
}

function LoadingPill({ label }: { label: string }) {
  return (
    <div className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-sm font-medium text-cobalt">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export default App;

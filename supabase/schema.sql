create extension if not exists "pgcrypto";

create table if not exists learning_sources (
  id text primary key,
  title text not null,
  type text not null,
  topic text,
  content text not null,
  tags text[] default '{}',
  learning_goal text,
  created_at timestamptz not null default now()
);

create table if not exists knowledge_analysis (
  id text primary key,
  source_id text not null references learning_sources(id) on delete cascade,
  strategy text not null,
  topics text[] default '{}',
  concepts text[] default '{}',
  logic text[] default '{}',
  cases text[] default '{}',
  applications text[] default '{}',
  controversies text[] default '{}',
  created_at timestamptz not null default now()
);

create table if not exists question_sets (
  id text primary key,
  source_id text not null references learning_sources(id) on delete cascade,
  analysis_id text references knowledge_analysis(id) on delete set null,
  mode text not null check (mode in ('exam', 'coach')),
  question_format text not null default 'open' check (question_format in ('open', 'choice')),
  question_count integer not null,
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id text primary key,
  question_set_id text not null references question_sets(id) on delete cascade,
  format text not null default 'open' check (format in ('open', 'choice')),
  type text not null,
  bloom_level text not null,
  difficulty integer not null,
  knowledge_point text not null,
  question text not null,
  context_hint text,
  options jsonb,
  correct_option_ids text[] default '{}',
  explanation text,
  expected_answer text not null,
  evaluation_criteria text[] default '{}',
  review_score integer not null default 0
);

alter table question_sets add column if not exists question_format text not null default 'open';
alter table questions add column if not exists context_hint text;
alter table questions add column if not exists format text not null default 'open';
alter table questions add column if not exists options jsonb;
alter table questions add column if not exists correct_option_ids text[] default '{}';
alter table questions add column if not exists explanation text;

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  question_set_id text not null references question_sets(id) on delete cascade,
  question_id text not null references questions(id) on delete cascade,
  answer text not null,
  selected_option_ids text[] default '{}',
  created_at timestamptz not null default now()
);

alter table answers add column if not exists selected_option_ids text[] default '{}';

create table if not exists evaluations (
  id uuid primary key default gen_random_uuid(),
  question_set_id text not null references question_sets(id) on delete cascade,
  question_id text not null references questions(id) on delete cascade,
  score integer not null,
  ability jsonb not null,
  strengths text[] default '{}',
  weaknesses text[] default '{}',
  missing_points text[] default '{}',
  follow_up_questions text[] default '{}',
  created_at timestamptz not null default now()
);

create table if not exists evaluation_jobs (
  id uuid primary key default gen_random_uuid(),
  question_set_id text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  progress integer not null default 0,
  total integer not null default 0,
  request jsonb not null,
  result jsonb not null default '[]'::jsonb,
  error text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists question_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  progress integer not null default 0,
  total integer not null default 0,
  request jsonb not null,
  result jsonb not null default '[]'::jsonb,
  error text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists learning_reports (
  id text primary key,
  source_id text not null references learning_sources(id) on delete cascade,
  question_set_id text not null references question_sets(id) on delete cascade,
  mode text not null,
  score integer not null,
  ability jsonb not null,
  strengths text[] default '{}',
  weaknesses text[] default '{}',
  recommendations jsonb not null,
  learning_insight jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_learning_sources_created_at on learning_sources(created_at desc);
create index if not exists idx_question_sets_source_id on question_sets(source_id);
create index if not exists idx_learning_reports_created_at on learning_reports(created_at desc);
create index if not exists idx_evaluation_jobs_status on evaluation_jobs(status);
create index if not exists idx_evaluation_jobs_created_at on evaluation_jobs(created_at desc);
create index if not exists idx_question_generation_jobs_status on question_generation_jobs(status);
create index if not exists idx_question_generation_jobs_created_at on question_generation_jobs(created_at desc);

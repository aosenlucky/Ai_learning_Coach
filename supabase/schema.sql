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
  question_count integer not null,
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id text primary key,
  question_set_id text not null references question_sets(id) on delete cascade,
  type text not null,
  bloom_level text not null,
  difficulty integer not null,
  knowledge_point text not null,
  question text not null,
  expected_answer text not null,
  evaluation_criteria text[] default '{}',
  review_score integer not null default 0
);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  question_set_id text not null references question_sets(id) on delete cascade,
  question_id text not null references questions(id) on delete cascade,
  answer text not null,
  created_at timestamptz not null default now()
);

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

-- Personal single-user mode for the browser client.
--
-- The current app does not have Supabase Auth or per-user ownership columns. These
-- policies therefore allow the public anon role to read and write application data.
-- Use this only while the deployment is private/personal. Replace it with auth.uid()
-- based policies before exposing a multi-user service.

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'learning_sources',
    'knowledge_analysis',
    'question_sets',
    'questions',
    'answers',
    'evaluations',
    'learning_reports',
    'evaluation_jobs',
    'question_generation_jobs'
  ]
  loop
    execute format('alter table public.%I enable row level security', target_table);

    execute format('drop policy if exists "personal app select" on public.%I', target_table);
    execute format(
      'create policy "personal app select" on public.%I for select to anon, authenticated using (true)',
      target_table
    );

    execute format('drop policy if exists "personal app insert" on public.%I', target_table);
    execute format(
      'create policy "personal app insert" on public.%I for insert to anon, authenticated with check (true)',
      target_table
    );

    execute format('drop policy if exists "personal app update" on public.%I', target_table);
    execute format(
      'create policy "personal app update" on public.%I for update to anon, authenticated using (true) with check (true)',
      target_table
    );

    execute format('drop policy if exists "personal app delete" on public.%I', target_table);
    execute format(
      'create policy "personal app delete" on public.%I for delete to anon, authenticated using (true)',
      target_table
    );
  end loop;
end
$$;

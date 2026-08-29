-- Supabase schema for the Seni Scape / myWIPhealing survey responses.
--
-- Design note: the questionnaire changes between programme phases, so answers
-- live in a single `data` jsonb column rather than one column per question.
-- Adding or renaming a question then needs NO migration here - only the survey
-- prompt and the dashboard field maps change. `schema_version` records which
-- questionnaire produced each row so old and new answers are never silently
-- averaged together.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.

create table if not exists public.responses (
  -- Insertion order. Redis stores responses as a list and updates them by
  -- position, so the mirror needs a stable ordering to match that.
  seq             bigint generated always as identity,
  id              uuid primary key,
  submitted_at    timestamptz not null default now(),
  schema_version  integer     not null default 1,
  data            jsonb       not null default '{}'::jsonb,
  analysis        jsonb,
  transcript      jsonb,
  approved_quote  jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists responses_seq_key on public.responses (seq);
create index if not exists responses_submitted_at_idx on public.responses (submitted_at desc);
create index if not exists responses_schema_version_idx on public.responses (schema_version);

-- GIN index over the whole answer blob: makes any question queryable without
-- knowing the field names up front, e.g. where data->>'pre_mood' = 'calm'.
create index if not exists responses_data_gin_idx on public.responses using gin (data);

-- Participant grouping in stats.js keys on email, then name.
create index if not exists responses_email_idx on public.responses ((data->>'email'));

-- Only rows an admin approved as public testimonials.
create index if not exists responses_approved_quote_idx
  on public.responses (id) where approved_quote is not null;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists responses_set_updated_at on public.responses;
create trigger responses_set_updated_at
  before update on public.responses
  for each row execute function public.set_updated_at();

-- This table holds names, emails, phone numbers and free-text about personal
-- distress. RLS on with NO policies means the anon and authenticated keys can
-- read nothing at all; only the service_role key (used server-side by the
-- Express app) reaches it. Do not add a permissive policy without a reason.
alter table public.responses enable row level security;

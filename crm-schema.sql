-- Run once in the SQL editor of the dedicated SoftSolutions CRM project.
begin;
create table public.crm_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.crm_staff enable row level security;
revoke all on public.crm_staff from anon, authenticated;
grant select on public.crm_staff to authenticated;
create policy staff_read_self on public.crm_staff for select to authenticated using (user_id = (select auth.uid()));

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) <= 200),
  company text not null default '',
  website text not null default '',
  region text not null default 'ROW',
  service text not null default '',
  budget text not null default '',
  description text not null default '',
  stage text not null default 'new' check (stage in ('new','contacted','proposal','won','lost')),
  notes text not null default '' check (char_length(notes) <= 20000),
  follow_up_at timestamptz,
  source text not null default 'website',
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_leads enable row level security;
revoke all on public.crm_leads from anon, authenticated;
grant select on public.crm_leads to authenticated;
grant update(stage, notes, follow_up_at) on public.crm_leads to authenticated;
grant select, insert on public.crm_leads to service_role;
create policy staff_read_leads on public.crm_leads for select to authenticated
 using (exists (select 1 from public.crm_staff where user_id = (select auth.uid())));
create policy staff_update_leads on public.crm_leads for update to authenticated
 using (exists (select 1 from public.crm_staff where user_id = (select auth.uid())))
 with check (exists (select 1 from public.crm_staff where user_id = (select auth.uid())));
create index crm_leads_created on public.crm_leads(created_at desc, id);
create index crm_leads_follow_up on public.crm_leads(follow_up_at) where stage not in ('won','lost');
create function public.crm_touch_lead() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = clock_timestamp(); return new; end;
$$;
revoke all on function public.crm_touch_lead() from public;
create trigger crm_lead_updated before update on public.crm_leads for each row execute function public.crm_touch_lead();
create function public.crm_summary() returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object(
  'total',count(*),'new',count(*) filter (where stage='new'),
  'open',count(*) filter (where stage not in ('won','lost')),
  'won',count(*) filter (where stage='won'),
  'overdue',count(*) filter (where stage not in ('won','lost') and follow_up_at < now())
 ) from public.crm_leads;
$$;
revoke all on function public.crm_summary() from public, anon;
grant execute on function public.crm_summary() to authenticated;
commit;

-- AFTER creating your CRM login under Authentication > Users, replace the UUID below
-- with that user's ID and run this separately. Only you can grant CRM membership.
-- insert into public.crm_staff(user_id) values ('YOUR-AUTH-USER-UUID');

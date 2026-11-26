begin;
alter table public.crm_leads add column assigned_to uuid references public.crm_staff(user_id) on delete set null;
create index crm_leads_assignment on public.crm_leads(assigned_to);
-- Keep existing membership visibility. This helper reads only the caller's role,
-- including roles currently denied by the legacy admission policy.
create function crm_private.salesos_role() returns text
language sql stable security definer set search_path='' as $$
 select salesos_role from public.crm_staff where user_id=(select auth.uid());
$$;
revoke all on function crm_private.salesos_role() from public,anon;
grant usage on schema crm_private to authenticated;
grant execute on function crm_private.salesos_role() to authenticated;

create table public.salesos_companies (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 200),
 website text, assigned_to uuid references public.crm_staff(user_id) on delete set null,
 created_at timestamptz not null default now()
);
create table public.salesos_contacts (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.salesos_companies(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 200),
 email text, job_title text,
 assigned_to uuid references public.crm_staff(user_id) on delete set null,
 created_at timestamptz not null default now()
);
create table public.salesos_research (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.salesos_companies(id) on delete cascade,
 assigned_to uuid references public.crm_staff(user_id) on delete set null,
 findings text not null default '', evidence_urls text[] not null default '{}',
 created_at timestamptz not null default now()
);
create table public.salesos_scores (
 id uuid primary key default gen_random_uuid(),
 research_id uuid not null references public.salesos_research(id) on delete cascade,
 score smallint not null check (score between 0 and 100),
 reasoning text not null default '',
 created_at timestamptz not null default now()
);
create table public.salesos_tasks (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.crm_leads(id) on delete cascade,
 assigned_to uuid references public.crm_staff(user_id) on delete set null,
 title text not null check (length(trim(title)) between 1 and 200),
 due_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.salesos_deals (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.crm_leads(id) on delete cascade,
 assigned_to uuid references public.crm_staff(user_id) on delete set null,
 title text not null check (length(trim(title)) between 1 and 200),
 stage text not null check (stage in ('open','won','lost')),
 value numeric(14,2) check (value>=0), currency text check (currency ~ '^[A-Z]{3}$'),
 closed_at timestamptz, created_at timestamptz not null default now()
);
create index salesos_companies_assignment on public.salesos_companies(assigned_to);
create index salesos_contacts_assignment on public.salesos_contacts(assigned_to);
create index salesos_contacts_company on public.salesos_contacts(company_id);
create index salesos_research_assignment on public.salesos_research(assigned_to,company_id);
create index salesos_research_company on public.salesos_research(company_id);
create index salesos_scores_research on public.salesos_scores(research_id);
create index salesos_tasks_lead on public.salesos_tasks(lead_id);
create index salesos_deals_lead on public.salesos_deals(lead_id);

do $$
declare tab text;
begin
 foreach tab in array array['salesos_companies','salesos_contacts','salesos_research','salesos_scores','salesos_tasks','salesos_deals'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select,insert,update,delete on public.%I to authenticated',tab);
  execute format('create policy salesos_oversight on public.%I for all to authenticated using ((select crm_private.salesos_role()) in (''owner'',''admin'')) with check ((select crm_private.salesos_role()) in (''owner'',''admin''))',tab);
 end loop;
end $$;

-- Researchers see only assigned jobs and related context. Contact grants are
-- row-scoped to the company so sensitive CRM notes are kept in other tables.
create policy researcher_jobs on public.salesos_research for select to authenticated
 using ((select crm_private.salesos_role())='researcher' and assigned_to=(select auth.uid()));
create policy company_assignment on public.salesos_companies for select to authenticated
 using (((select crm_private.salesos_role())='sales' and assigned_to=(select auth.uid()))
 or exists(select 1 from public.salesos_research r where r.company_id=salesos_companies.id and r.assigned_to=(select auth.uid()) and (select crm_private.salesos_role())='researcher'));
create policy contact_assignment on public.salesos_contacts for select to authenticated
 using (((select crm_private.salesos_role())='sales' and assigned_to=(select auth.uid()))
 or exists(select 1 from public.salesos_research r where r.company_id=salesos_contacts.company_id and r.assigned_to=(select auth.uid()) and (select crm_private.salesos_role())='researcher'));
create policy research_scores_assignment on public.salesos_scores for select to authenticated
 using ((select crm_private.salesos_role())='researcher' and exists(select 1 from public.salesos_research r where r.id=research_id));
create policy assigned_sales_tasks on public.salesos_tasks for select to authenticated
 using ((select crm_private.salesos_role())='sales' and assigned_to=(select auth.uid()));
create policy assigned_sales_deals on public.salesos_deals for select to authenticated
 using ((select crm_private.salesos_role())='sales' and assigned_to=(select auth.uid()));
create policy assigned_sales_leads on public.crm_leads for select to authenticated
 using ((select crm_private.salesos_role())='sales' and assigned_to=(select auth.uid()));
create policy assigned_sales_lead_edit on public.crm_leads for update to authenticated
 using ((select crm_private.salesos_role())='sales' and assigned_to=(select auth.uid()))
 with check ((select crm_private.salesos_role())='sales' and assigned_to=(select auth.uid()));
create policy assigned_sales_activity on public.crm_activity for select to authenticated
 using ((select crm_private.salesos_role())='sales' and exists(select 1 from public.crm_leads l where l.id=lead_id));
create policy assigned_sales_bookings on public.crm_bookings for select to authenticated
 using ((select crm_private.salesos_role())='sales' and exists(select 1 from public.crm_leads l where l.id=lead_id));

-- Column restrictions for assigned-record updates. Existing owners/admins
-- manage assignments through the database until a dedicated API is added.
revoke update on public.salesos_companies,public.salesos_contacts,public.salesos_tasks,public.salesos_deals,public.salesos_research from authenticated;
grant update(name,website) on public.salesos_companies to authenticated;
grant update(name,email,job_title) on public.salesos_contacts to authenticated;
grant update(title,due_at,completed_at) on public.salesos_tasks to authenticated;
grant update(title,stage,value,currency,closed_at) on public.salesos_deals to authenticated;
grant update(findings,evidence_urls) on public.salesos_research to authenticated;
do $$
declare tab text;
begin
 foreach tab in array array['salesos_companies','salesos_contacts','salesos_tasks','salesos_deals'] loop
  execute format('create policy salesos_assigned_edit on public.%I for update to authenticated using ((select crm_private.salesos_role())=''sales'' and assigned_to=(select auth.uid())) with check ((select crm_private.salesos_role())=''sales'' and assigned_to=(select auth.uid()))',tab);
 end loop;
end $$;
create policy researcher_job_edit on public.salesos_research for update to authenticated
 using ((select crm_private.salesos_role())='researcher' and assigned_to=(select auth.uid()))
 with check ((select crm_private.salesos_role())='researcher' and assigned_to=(select auth.uid()));
commit;


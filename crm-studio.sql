-- Agency delivery workspace. Staff JWT + RLS; client access uses hashed, expiring capabilities.
create table public.crm_projects (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null unique references public.crm_leads(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 200), summary text not null default '' check(char_length(summary)<=5000),
 status text not null default 'active' check(status in ('active','paused','completed')), due_at date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_milestones (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.crm_projects(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 200),description text not null default '' check(char_length(description)<=3000),
 status text not null default 'planned' check(status in ('planned','in_progress','review','approved')),due_at date,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index crm_milestones_project on public.crm_milestones(project_id,created_at);
create table public.crm_resources (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.crm_projects(id) on delete cascade,
 label text not null check(char_length(label) between 1 and 200),url text not null check(url ~ '^https://' and char_length(url)<=1000),
 created_at timestamptz not null default now()
);
create index crm_resources_project on public.crm_resources(project_id,created_at);
create table public.crm_messages (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.crm_projects(id) on delete cascade,
 author_name text not null check(char_length(author_name) between 1 and 100),author_role text not null default 'team' check(author_role in ('team','client')),
 body text not null check(char_length(body) between 1 and 3000),created_at timestamptz not null default now()
);
create index crm_messages_project on public.crm_messages(project_id,created_at);
create table public.crm_shares (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.crm_projects(id) on delete cascade,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz not null default now()+interval '30 days',
 revoked_at timestamptz,created_at timestamptz not null default now()
);
create index crm_shares_project on public.crm_shares(project_id);
create or replace function crm_private.valid_items(items jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 30 then return false;end if;
 for item in select * from jsonb_array_elements(items) loop
 if jsonb_typeof(item->'description') is distinct from 'string' or char_length(item->>'description') not between 1 and 500
 or jsonb_typeof(item->'qty') is distinct from 'number' or jsonb_typeof(item->'unit_price') is distinct from 'number' then return false;end if;
 if (item->>'qty')::numeric<=0 or (item->>'qty')::numeric>100000 or (item->>'qty')::numeric<>round((item->>'qty')::numeric,2)
 or (item->>'unit_price')::numeric<0 or (item->>'unit_price')::numeric>1000000000 or (item->>'unit_price')::numeric<>round((item->>'unit_price')::numeric,2) then return false;end if;
 end loop;return true;exception when others then return false;end $$;
revoke all on function crm_private.valid_items(jsonb) from public,anon;
grant usage on schema crm_private to authenticated,service_role;
grant execute on function crm_private.valid_items(jsonb) to authenticated,service_role;
create table public.crm_proposals (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.crm_projects(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 200),intro text not null default '' check(char_length(intro)<=5000),
 items jsonb not null check(crm_private.valid_items(items)),currency text not null default 'USD' check(currency in ('USD','PKR','GBP','AED','EUR','CAD','AUD')),
 terms text not null default '' check(char_length(terms)<=8000),valid_until date not null,
 status text not null default 'draft' check(status in ('draft','sent','accepted','declined')),
 decision_by text check(char_length(decision_by)<=100),decision_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index crm_proposals_project on public.crm_proposals(project_id,created_at);
do $$ declare tab text;begin foreach tab in array array['crm_projects','crm_milestones','crm_resources','crm_messages','crm_shares','crm_proposals'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from anon,authenticated',tab);
 execute format('grant select,insert,update,delete on public.%I to service_role',tab);
 execute format('grant select on public.%I to authenticated',tab);
 execute format('create policy staff_read on public.%I for select to authenticated using(exists(select 1 from public.crm_staff where user_id=(select auth.uid())))',tab);
 end loop;end $$;
grant insert(lead_id,title,summary,status,due_at),update(title,summary,status,due_at) on public.crm_projects to authenticated;
grant insert(project_id,title,description,status,due_at),update(title,description,status,due_at) on public.crm_milestones to authenticated;
grant insert(project_id,label,url),delete on public.crm_resources to authenticated;
grant insert(project_id,author_name,author_role,body) on public.crm_messages to authenticated;
grant insert(project_id,token_hash,expires_at),update(revoked_at) on public.crm_shares to authenticated;
grant insert(project_id,title,intro,items,currency,terms,valid_until,status),update(title,intro,items,currency,terms,valid_until,status) on public.crm_proposals to authenticated;
do $$declare tab text;begin foreach tab in array array['crm_projects','crm_milestones','crm_resources','crm_shares','crm_proposals'] loop
 execute format('create policy staff_insert on public.%I for insert to authenticated with check(exists(select 1 from public.crm_staff where user_id=(select auth.uid()))%s)',tab,case when tab='crm_proposals' then ' and status=''draft''' else '' end);
 end loop;
 foreach tab in array array['crm_projects','crm_milestones','crm_shares','crm_proposals'] loop
 execute format('create policy staff_update on public.%I for update to authenticated using(exists(select 1 from public.crm_staff where user_id=(select auth.uid()))%s) with check(exists(select 1 from public.crm_staff where user_id=(select auth.uid()))%s)',tab,case when tab='crm_proposals' then ' and status=''draft''' else '' end,case when tab='crm_proposals' then ' and status in (''draft'',''sent'')' else '' end);
 end loop;end $$;
create policy staff_message on public.crm_messages for insert to authenticated with check(author_role='team' and exists(select 1 from public.crm_staff where user_id=(select auth.uid())));
create policy staff_resource_delete on public.crm_resources for delete to authenticated using(exists(select 1 from public.crm_staff where user_id=(select auth.uid())));
create or replace function crm_private.touch_workspace() returns trigger language plpgsql set search_path='' as $$begin new.updated_at=clock_timestamp();return new;end $$;
revoke all on function crm_private.touch_workspace() from public,anon,authenticated;
do $$declare tab text;begin foreach tab in array array['crm_projects','crm_milestones','crm_proposals'] loop
 execute format('create trigger studio_touch before update on public.%I for each row execute function crm_private.touch_workspace()',tab);
 end loop;end $$;
-- Only service_role can execute these bounded client-facing operations. No SECURITY DEFINER.
create function public.crm_portal(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare pid uuid; action text:=coalesce(payload->>'action','view'); doc public.crm_proposals; mid uuid; count_recent int; result jsonb;begin
 select project_id into pid from public.crm_shares where token_hash=payload->>'token_hash' and revoked_at is null and expires_at>now();
 if pid is null then return jsonb_build_object('error','This client link has expired or was revoked.');end if;
 if action<>'view' then
 perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
 select count(*) into count_recent from public.crm_messages where project_id=pid and author_role='client' and created_at>now()-interval '1 hour';
 if count_recent>=30 then return jsonb_build_object('error','Too many updates. Please try again later.');end if;
 if char_length(trim(coalesce(payload->>'name',''))) not between 1 and 100 then return jsonb_build_object('error','Please enter your name.');end if;
 if action='message' then
 if char_length(trim(coalesce(payload->>'body',''))) not between 1 and 3000 then return jsonb_build_object('error','Enter a message up to 3000 characters.');end if;
 insert into public.crm_messages(project_id,author_name,author_role,body) values(pid,trim(payload->>'name'),'client',trim(payload->>'body'));
 elsif action='approve' then
 update public.crm_milestones set status='approved' where id=(payload->>'id')::uuid and project_id=pid and status='review' returning id into mid;
 if mid is null then return jsonb_build_object('error','This milestone is no longer awaiting approval.');end if;
 insert into public.crm_messages(project_id,author_name,author_role,body) values(pid,trim(payload->>'name'),'client','Approved milestone: '||(select title from public.crm_milestones where id=mid));
 elsif action='decision' then
 if payload->>'status' not in ('accepted','declined') then return jsonb_build_object('error','Invalid decision.');end if;
 update public.crm_proposals set status=payload->>'status',decision_by=trim(payload->>'name'),decision_at=now() where id=(payload->>'id')::uuid and project_id=pid and status='sent' and valid_until>=current_date returning * into doc;
 if doc.id is null then return jsonb_build_object('error','This proposal has expired or already has a decision.');end if;
 insert into public.crm_messages(project_id,author_name,author_role,body) values(pid,trim(payload->>'name'),'client',initcap(doc.status)||' proposal: '||doc.title);
 else return jsonb_build_object('error','Unsupported action.');end if;
 end if;
 select jsonb_build_object(
 'project',(select jsonb_build_object('id',id,'title',title,'summary',summary,'status',status,'due_at',due_at) from public.crm_projects where id=pid),
 'milestones',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.crm_milestones m where project_id=pid),'[]'::jsonb),
 'resources',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'url',url) order by created_at) from public.crm_resources where project_id=pid),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from (select author_name,author_role,body,created_at from public.crm_messages where project_id=pid order by created_at desc limit 100)m),'[]'::jsonb),
 'proposals',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.crm_proposals p where project_id=pid and status<>'draft'),'[]'::jsonb)
 ) into result;return result;
end $$;
revoke all on function public.crm_portal(jsonb) from public,anon,authenticated;
grant execute on function public.crm_portal(jsonb) to service_role;
-- Exact totals across all records, independent of inbox pagination.
create function public.crm_today(day_start timestamptz, day_end timestamptz) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'new_today',(select count(*) from public.crm_leads where created_at>=day_start and created_at<day_end),
 'overdue',(select count(*) from public.crm_leads where follow_up_at<now() and stage not in ('won','lost')),
 'active_projects',(select count(*) from public.crm_projects where status='active'),
 'proposals_pending',(select count(*) from public.crm_proposals where status='sent'),
 'pipeline_value',coalesce((select jsonb_agg(v) from (select currency,sum(round((i->>'qty')::numeric*(i->>'unit_price')::numeric,2)) as amount from public.crm_proposals cross join lateral jsonb_array_elements(items)i where status='sent' group by currency)v),'[]'::jsonb),
 'calls',coalesce((select jsonb_agg(b order by b.starts_at) from (select id,lead_id,event_name,starts_at,ends_at from public.crm_bookings where status='active' and starts_at>=day_start and starts_at<day_end order by starts_at limit 50)b),'[]'::jsonb),
 'milestones',coalesce((select jsonb_agg(m) from (select id,project_id,title,due_at,status from public.crm_milestones where status<>'approved' and due_at<=(day_end at time zone 'UTC')::date order by due_at limit 50)m),'[]'::jsonb)
 );
$$;
revoke all on function public.crm_today(timestamptz,timestamptz) from public,anon;
grant execute on function public.crm_today(timestamptz,timestamptz) to authenticated;
do $$declare tab text;begin foreach tab in array array['crm_projects','crm_milestones','crm_resources','crm_messages','crm_proposals'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then execute format('alter publication supabase_realtime add table public.%I',tab);end if;
 end loop;end $$;

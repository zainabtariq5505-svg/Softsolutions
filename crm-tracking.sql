begin;
alter table public.crm_leads
 add column client_ip inet,
 add column country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
 add column referrer_host text not null default '',
 add column landing_path text not null default '',
 add column utm_source text not null default '',
 add column utm_medium text not null default '',
 add column utm_campaign text not null default '',
 add column proposal_title text not null default '',
 add column proposal_amount numeric(12,2) check (proposal_amount >= 0),
 add column proposal_currency text not null default 'USD' check (proposal_currency ~ '^[A-Z]{3}$'),
 add column proposal_status text not null default 'draft' check (proposal_status in ('draft','sent','accepted','declined')),
 add column proposal_url text not null default '',
 add column proposal_sent_at timestamptz;
grant update(proposal_title,proposal_amount,proposal_currency,proposal_status,proposal_url) on public.crm_leads to authenticated;
create index crm_leads_email_lower on public.crm_leads(lower(email),created_at desc);

create table public.crm_activity (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.crm_leads(id) on delete cascade,
 kind text not null, summary text not null, detail jsonb not null default '{}', actor_id uuid,
 external_key text unique, created_at timestamptz not null default now()
);
create index crm_activity_lead_time on public.crm_activity(lead_id,created_at desc,id);
alter table public.crm_activity enable row level security;
revoke all on public.crm_activity from anon,authenticated;
grant select on public.crm_activity to authenticated;
grant select,insert on public.crm_activity to service_role;
create policy staff_read_activity on public.crm_activity for select to authenticated using (exists(select 1 from public.crm_staff where user_id=(select auth.uid())));

create table public.crm_bookings (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.crm_leads(id) on delete cascade,
 invitee_uri text not null unique, event_uri text not null, status text not null check(status in ('active','canceled')),
 starts_at timestamptz, ends_at timestamptz, event_name text not null default 'Consultation',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index crm_bookings_lead on public.crm_bookings(lead_id,starts_at);
alter table public.crm_bookings enable row level security;
revoke all on public.crm_bookings from anon,authenticated;
grant select on public.crm_bookings to authenticated;
grant all on public.crm_bookings to service_role;
create policy staff_read_bookings on public.crm_bookings for select to authenticated using (exists(select 1 from public.crm_staff where user_id=(select auth.uid())));

create table public.crm_email_reminders (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.crm_leads(id) on delete cascade,
 scheduled_for timestamptz not null, status text not null default 'queued' check(status in ('queued','processing','sent','failed','canceled')),
 attempts int not null default 0, first_claimed_at timestamptz, claimed_at timestamptz, sent_at timestamptz,
 provider_id text, last_error text, unique(lead_id,scheduled_for)
);
create index crm_reminders_queue on public.crm_email_reminders(status,claimed_at);
alter table public.crm_email_reminders enable row level security;
revoke all on public.crm_email_reminders from anon,authenticated;
grant select on public.crm_email_reminders to authenticated;
grant all on public.crm_email_reminders to service_role;
create policy staff_read_reminders on public.crm_email_reminders for select to authenticated using (exists(select 1 from public.crm_staff where user_id=(select auth.uid())));

create schema if not exists crm_private;
revoke all on schema crm_private from public,anon,authenticated;
create function crm_private.audit_lead() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
  insert into public.crm_activity(lead_id,kind,summary,detail,actor_id) values(new.id,'received',case when new.source='calendly' then 'Consultation lead received' else 'Website inquiry received' end,jsonb_build_object('source',new.source),(select auth.uid()));
 else
  if old.stage is distinct from new.stage then insert into public.crm_activity(lead_id,kind,summary,detail,actor_id) values(new.id,'stage','Pipeline stage changed',jsonb_build_object('from',old.stage,'to',new.stage),(select auth.uid())); end if;
  if old.notes is distinct from new.notes then insert into public.crm_activity(lead_id,kind,summary,actor_id) values(new.id,'notes','Team notes updated',(select auth.uid())); end if;
  if old.follow_up_at is distinct from new.follow_up_at then insert into public.crm_activity(lead_id,kind,summary,detail,actor_id) values(new.id,'follow_up','Follow-up updated',jsonb_build_object('from',old.follow_up_at,'to',new.follow_up_at),(select auth.uid())); end if;
  if (old.proposal_title,old.proposal_amount,old.proposal_currency,old.proposal_status,old.proposal_url) is distinct from (new.proposal_title,new.proposal_amount,new.proposal_currency,new.proposal_status,new.proposal_url) then insert into public.crm_activity(lead_id,kind,summary,detail,actor_id) values(new.id,'proposal','Proposal updated',jsonb_build_object('status',new.proposal_status,'amount',new.proposal_amount,'currency',new.proposal_currency),(select auth.uid())); end if;
 end if;
 return new;
end; $$;
revoke all on function crm_private.audit_lead() from public,anon,authenticated,service_role;
create trigger crm_lead_activity after insert or update on public.crm_leads for each row execute function crm_private.audit_lead();
create or replace function public.crm_touch_lead() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at=clock_timestamp();
 if new.proposal_status='sent' and old.proposal_status is distinct from new.proposal_status then new.proposal_sent_at=now(); end if;
 return new;
end; $$;

create or replace function public.crm_receive_inquiry(payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare new_id uuid;
begin
 perform pg_advisory_xact_lock(hashtext('crm-intake'));
 if (select count(*) from public.crm_leads where created_at>now()-interval '1 hour')>=100 then raise exception 'Intake limit'; end if;
 if (select count(*) from public.crm_leads where lower(email)=lower(payload->>'email') and created_at>now()-interval '24 hours')>=5 then raise exception 'Intake limit'; end if;
 if payload->>'name' is null or payload->>'email' is null or payload->>'description' is null or char_length(payload->>'name') not between 1 and 100 or char_length(payload->>'description') not between 20 and 5000 then raise exception 'Invalid inquiry'; end if;
 insert into public.crm_leads(name,email,company,website,region,service,budget,description,source,consent_at,client_ip,country_code,referrer_host,landing_path,utm_source,utm_medium,utm_campaign)
 values(payload->>'name',lower(payload->>'email'),coalesce(payload->>'company',''),coalesce(payload->>'website',''),coalesce(payload->>'region','ROW'),coalesce(payload->>'service',''),coalesce(payload->>'budget',''),payload->>'description','website',now(),nullif(payload#>>'{tracking,ip}','')::inet,nullif(payload#>>'{tracking,country}',''),left(coalesce(payload#>>'{tracking,referrer_host}',''),200),left(coalesce(payload#>>'{tracking,landing_path}',''),200),left(coalesce(payload#>>'{tracking,utm_source}',''),100),left(coalesce(payload#>>'{tracking,utm_medium}',''),100),left(coalesce(payload#>>'{tracking,utm_campaign}',''),100)) returning id into new_id;
 return new_id;
end; $$;

create function public.crm_receive_booking(payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare lead uuid; booking uuid; previous_status text; new_status text; event_key text;
begin
 perform pg_advisory_xact_lock(hashtext('calendly:'||(payload->>'invitee_uri')));
 if payload->>'email' is null or payload->>'invitee_uri' is null or payload->>'status' not in ('active','canceled') then raise exception 'Invalid booking'; end if;
 select lead_id,status into lead,previous_status from public.crm_bookings where invitee_uri=payload->>'invitee_uri';
 if lead is null then
  select id into lead from public.crm_leads where lower(email)=lower(payload->>'email') order by (stage not in ('won','lost')) desc,created_at desc limit 1;
 end if;
 if lead is null then
  insert into public.crm_leads(name,email,service,description,source) values(left(coalesce(nullif(payload->>'name',''),'Consultation guest'),100),lower(payload->>'email'),'custom','Consultation booked through Calendly.','calendly') returning id into lead;
 end if;
 new_status=case when previous_status='canceled' then 'canceled' else payload->>'status' end;
 insert into public.crm_bookings(lead_id,invitee_uri,event_uri,status,starts_at,ends_at,event_name)
 values(lead,payload->>'invitee_uri',payload->>'event_uri',new_status,nullif(payload->>'starts_at','')::timestamptz,nullif(payload->>'ends_at','')::timestamptz,left(coalesce(payload->>'event_name','Consultation'),200))
 on conflict(invitee_uri) do update set status=excluded.status,starts_at=coalesce(excluded.starts_at,crm_bookings.starts_at),ends_at=coalesce(excluded.ends_at,crm_bookings.ends_at),updated_at=now() returning id into booking;
 event_key='calendly:'||(payload->>'invitee_uri')||':'||(payload->>'status');
 if previous_status is distinct from new_status then
 insert into public.crm_activity(lead_id,kind,summary,detail,external_key) values(lead,'booking',case when new_status='canceled' then 'Consultation canceled' else 'Consultation booked' end,jsonb_build_object('starts_at',nullif(payload->>'starts_at',''),'event_name',payload->>'event_name'),event_key) on conflict(external_key) do nothing;
 end if;
 return lead;
end; $$;
revoke all on function public.crm_receive_booking(jsonb) from public,anon,authenticated;
grant execute on function public.crm_receive_booking(jsonb) to service_role;

create function public.crm_claim_reminders() returns jsonb language plpgsql security invoker set search_path='' as $$
declare results jsonb;
begin
 insert into public.crm_email_reminders(lead_id,scheduled_for) select id,follow_up_at from public.crm_leads where follow_up_at<=now() and stage not in ('won','lost') on conflict(lead_id,scheduled_for) do nothing;
 update public.crm_email_reminders r set status='canceled' from public.crm_leads l where r.lead_id=l.id and r.status in ('queued','processing') and (l.stage in ('won','lost') or l.follow_up_at is distinct from r.scheduled_for);
 update public.crm_email_reminders set status='failed',last_error='Retry window exhausted' where status in ('queued','processing') and (attempts>=3 or first_claimed_at<now()-interval '23 hours');
 with candidates as (select id from public.crm_email_reminders where status='queued' or (status='processing' and claimed_at<now()-interval '10 minutes') order by scheduled_for limit 5 for update skip locked), claimed as (update public.crm_email_reminders r set status='processing',attempts=attempts+1,claimed_at=now(),first_claimed_at=coalesce(first_claimed_at,now()) from candidates c where c.id=r.id returning r.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'lead_id',l.id,'name',l.name,'scheduled_for',r.scheduled_for)), '[]'::jsonb) into results from claimed r join public.crm_leads l on l.id=r.lead_id;
 return results;
end; $$;
revoke all on function public.crm_claim_reminders() from public,anon,authenticated;
grant execute on function public.crm_claim_reminders() to service_role;
create function public.crm_finish_reminder(reminder_id uuid,was_sent boolean,provider_message_id text default null) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.crm_email_reminders set status=case when was_sent then 'sent' when attempts>=3 then 'failed' else 'queued' end,sent_at=case when was_sent then now() else null end,provider_id=left(provider_message_id,200),last_error=case when was_sent then null else 'Email delivery failed' end where id=reminder_id and status='processing';
 return found;
end; $$;
revoke all on function public.crm_finish_reminder(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.crm_finish_reminder(uuid,boolean,text) to service_role;
create function public.crm_expire_ip() returns bigint language plpgsql security invoker set search_path='' as $$
declare changed bigint;
begin update public.crm_leads set client_ip=null where created_at<now()-interval '30 days' and client_ip is not null; get diagnostics changed=row_count; return changed; end; $$;
revoke all on function public.crm_expire_ip() from public,anon,authenticated;
grant execute on function public.crm_expire_ip() to service_role;
grant update(client_ip) on public.crm_leads to service_role;

alter publication supabase_realtime add table public.crm_leads,public.crm_activity,public.crm_bookings;
insert into public.crm_activity(lead_id,kind,summary,detail,created_at)
 select id,'received','Lead received',jsonb_build_object('source',source),created_at from public.crm_leads l
 where not exists(select 1 from public.crm_activity a where a.lead_id=l.id and a.kind='received');
commit;

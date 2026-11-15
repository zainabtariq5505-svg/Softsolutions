create function public.crm_today(day_start timestamptz, day_end timestamptz, local_day date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'new_today',(select count(*) from public.crm_leads where created_at>=day_start and created_at<day_end),
 'overdue',(select count(*) from public.crm_leads where follow_up_at<now() and stage not in ('won','lost')),
 'active_projects',(select count(*) from public.crm_projects where status='active'),
 'proposals_pending',(select count(*) from public.crm_proposals where status='sent'),
 'pipeline_value',coalesce((select jsonb_agg(v) from (select currency,sum(round((i->>'qty')::numeric*(i->>'unit_price')::numeric,2)) as amount from public.crm_proposals cross join lateral jsonb_array_elements(items)i where status='sent' group by currency)v),'[]'::jsonb),
 'calls',coalesce((select jsonb_agg(b order by b.starts_at) from (select id,lead_id,event_name,starts_at,ends_at from public.crm_bookings where status='active' and starts_at>=day_start and starts_at<day_end order by starts_at limit 50)b),'[]'::jsonb),
 'milestones',coalesce((select jsonb_agg(m) from (select id,project_id,title,due_at,status from public.crm_milestones where status<>'approved' and due_at<=local_day order by due_at limit 50)m),'[]'::jsonb)
 );
$$;
revoke all on function public.crm_today(timestamptz,timestamptz,date) from public,anon;
grant execute on function public.crm_today(timestamptz,timestamptz,date) to authenticated;

create function public.salesos_dashboard(range_start timestamptz,range_end timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'total_leads',(select count(*) from public.crm_leads),
   'new_leads',(select count(*) from public.crm_leads where created_at>=range_start and created_at<range_end),
   'qualified_leads',null,
   'emails_sent',null,'delivered',null,'replies',null,'positive_replies',null,
   'meetings',(select count(*) from public.crm_bookings where created_at>=range_start and created_at<range_end and status='active'),
   'won',(select count(*) from public.salesos_deals where stage='won' and closed_at>=range_start and closed_at<range_end),
   'revenue',null,
   'acquisition',coalesce((select jsonb_agg(to_jsonb(a) order by day) from (
      select (created_at at time zone 'UTC')::date as day,count(*) as total from public.crm_leads
      where created_at>=range_start and created_at<range_end group by 1
   ) a),'[]'::jsonb),
   'pipeline',coalesce((select jsonb_agg(to_jsonb(p) order by stage,currency) from (
      select stage,currency,count(*) as total,sum(value) as value from public.salesos_deals
      where created_at>=range_start and created_at<range_end group by stage,currency
   ) p),'[]'::jsonb),
   'leads',coalesce((select jsonb_agg(to_jsonb(l) order by created_at desc) from (
      select id,name,stage,created_at from public.crm_leads where created_at>=range_start and created_at<range_end order by created_at desc,id limit 10
   ) l),'[]'::jsonb),
   'activity',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc) from (
      select summary,created_at from public.crm_activity where created_at>=range_start and created_at<range_end order by created_at desc,id limit 10
   ) a),'[]'::jsonb),
   'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by due_at) from (
      select title,due_at from public.salesos_tasks where completed_at is null and due_at>=now() order by due_at,id limit 10
   ) t),'[]'::jsonb)
 );
$$;
revoke all on function public.salesos_dashboard(timestamptz,timestamptz) from public,anon;
grant execute on function public.salesos_dashboard(timestamptz,timestamptz) to authenticated;

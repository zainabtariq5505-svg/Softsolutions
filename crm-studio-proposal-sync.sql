create function crm_private.items_total(items jsonb) returns numeric language sql immutable set search_path='' as $$select coalesce(sum(round((i->>'qty')::numeric*(i->>'unit_price')::numeric,2)),0) from jsonb_array_elements(items)i$$;
revoke all on function crm_private.items_total(jsonb) from public,anon;
grant execute on function crm_private.items_total(jsonb) to authenticated,service_role;
alter table public.crm_proposals add constraint proposal_total_limit check(crm_private.items_total(items)<=9999999999.99);
grant update(proposal_title,proposal_amount,proposal_currency,proposal_status,proposal_url) on public.crm_leads to service_role;
create function crm_private.sync_proposal_to_lead() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status<>'draft' and (old.status is distinct from new.status) and not exists(select 1 from public.crm_proposals p where p.project_id=new.project_id and p.status<>'draft' and (p.created_at,p.id)>(new.created_at,new.id)) then
 update public.crm_leads set proposal_title=new.title,proposal_amount=crm_private.items_total(new.items),proposal_currency=new.currency,proposal_status=new.status,proposal_url='https://www.softsolutions.agency/api/crm/studio/proposals/'||new.id::text||'/print' where id=(select lead_id from public.crm_projects where id=new.project_id);
 end if;return new;
end $$;
revoke all on function crm_private.sync_proposal_to_lead() from public,anon,authenticated;
create trigger studio_sync_proposal after update of status on public.crm_proposals for each row execute function crm_private.sync_proposal_to_lead();

begin;
alter table public.crm_staff add column salesos_role text not null default 'admin'
  check (salesos_role in ('owner','admin','sales','researcher'));
grant select(salesos_role) on public.crm_staff to authenticated;
create policy salesos_staff_admission on public.crm_staff as restrictive
  for select to authenticated using (salesos_role in ('owner','admin'));
-- Set the verified owner's existing membership to owner before committing.
commit;

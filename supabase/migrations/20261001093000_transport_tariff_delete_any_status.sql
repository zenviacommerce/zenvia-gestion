-- Tariffs are user-managed configuration. Allow a workspace with Orders permission
-- to delete draft, reviewed, active or superseded versions. Child services,
-- bands and revisions are removed by their existing ON DELETE CASCADE constraints.

drop policy if exists transport_tariff_documents_delete on public.transport_tariff_documents;

create policy transport_tariff_documents_delete
on public.transport_tariff_documents
for delete
using (
  owner_id = (select private.app_workspace_owner_id())
  and (select private.app_has_permission('orders'::text))
);

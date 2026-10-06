create or replace function public.import_job_action(p_job uuid,p_actor uuid,p_action text,p_item uuid default null,p_version integer default null,p_candidate jsonb default null) returns void language plpgsql set search_path='' as $$
declare j public.import_jobs; i public.import_job_items;
begin
 select * into j from public.import_jobs where id=p_job for update;
 if j.id is null or not private.import_can_access(j.owner_id,j.module,p_actor) then raise exception 'Importación no disponible'; end if;
 if p_action='cancel' then
 update public.import_jobs set cancel_requested=true where id=j.id;
 update public.import_job_items set status='cancelled',stage='Cancelada',lease_token=null,lease_until=null,version=version+1,updated_at=now() where job_id=j.id and status in ('queued','ready','running','waiting_review','error');
 elsif p_action='retry' then
 if j.cancel_requested then raise exception 'La tarea está cancelada'; end if;
 update public.import_job_items set status='queued',attempts=0,error=null,available_at=now(),version=version+1,updated_at=now() where job_id=j.id and status='error' and retryable;
 elsif p_action='manual_review' then
 if j.cancel_requested or j.kind not in ('expense_document','sales_document') then raise exception 'Esta entrada no admite revisión manual';end if;
 select * into i from public.import_job_items where id=p_item and job_id=j.id for update;
 if i.status<>'error' or i.version is distinct from p_version then raise exception 'El documento ha cambiado. Actualiza antes de revisar';end if;
 update public.import_job_items set status='waiting_review',stage='Completar datos manualmente',result=jsonb_set(result,'{candidate}',coalesce(result->'candidate',jsonb_build_object('supplierName','','invoiceNumber','','invoiceDate','','issueDate','','currency','EUR','subtotal',0,'vat',0,'taxAmount',0,'total',0,'totalAmount',0,'withholding',0,'equivalenceSurcharge',0,'confidence',0,'lines','[]'::jsonb,'reviewReason','No se ha completado la lectura. Confirma los datos del original.'))),input=input||'{"reviewed":false}'::jsonb,error=null,version=version+1,updated_at=now() where id=i.id;
 elsif p_action='review' then
 if j.cancel_requested then raise exception 'La tarea está cancelada'; end if;
 select * into i from public.import_job_items where id=p_item and job_id=j.id for update;
 if i.status<>'waiting_review' or i.version is distinct from p_version then raise exception 'La revisión ha cambiado. Actualiza antes de guardar'; end if;
 update public.import_job_items set result=jsonb_set(result,'{candidate}',p_candidate),input=input||jsonb_build_object('reviewed',true,'reviewedBy',p_actor),status='ready',attempts=0,available_at=now(),version=version+1,updated_at=now() where id=i.id;
 else raise exception 'Acción no válida'; end if;
 perform public.import_refresh_job(j.id);
end $$;
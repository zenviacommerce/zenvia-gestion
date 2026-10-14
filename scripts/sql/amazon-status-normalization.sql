begin;
create temporary table amazon_status_normalization_test(source_channel text,source_status text);
create trigger normalization before insert on amazon_status_normalization_test for each row execute function private.normalize_fulfillment_order_status();
insert into amazon_status_normalization_test values ('amazon','UNSHIPPED'),('amazon','PENDING'),('amazon','PARTIALLY_SHIPPED'),('amazon','SHIPPED'),('shopify','unshipped'),('other','unshipped');
do $test$ begin
 if not exists(select 1 from amazon_status_normalization_test where source_channel='amazon' and source_status='UNSHIPPED') then raise exception 'Confirmed Amazon order incorrectly becomes pending payment'; end if;
 if not exists(select 1 from amazon_status_normalization_test where source_channel='amazon' and source_status='PENDING') then raise exception 'Unconfirmed Amazon payment status lost'; end if;
 if (select count(*) from amazon_status_normalization_test where source_channel<>'amazon' and source_status='Pending')<>2 then raise exception 'Other channel normalization changed'; end if;
end;$test$;
select * from amazon_status_normalization_test;
rollback;

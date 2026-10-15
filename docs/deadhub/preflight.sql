-- Run read-only as the privately provisioned deadhub_app_login after approval.
-- Does not select any personal rows or credentials.
begin read only;
select current_user as role, session_user as login,
  rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolconnlimit
from pg_roles where rolname=current_user;
select
  has_schema_privilege(current_user,'deadhub_private','USAGE') as can_use_records,
  has_schema_privilege(current_user,'deadhub_private','CREATE') as can_create,
  (has_table_privilege(current_user,'deadhub_private.accounts','SELECT') and
   has_table_privilege(current_user,'deadhub_private.accounts','INSERT') and
   has_table_privilege(current_user,'deadhub_private.accounts','UPDATE')) as can_register,
  (has_table_privilege(current_user,'deadhub_private.matches','SELECT') and
   has_table_privilege(current_user,'deadhub_private.matches','INSERT') and
   has_table_privilege(current_user,'deadhub_private.matches','UPDATE')) as can_record,
  has_table_privilege(current_user,'deadhub_private.matches','DELETE,TRUNCATE') as can_delete,
  has_table_privilege(current_user,'deadhub_private.sessions','SELECT,INSERT,UPDATE,DELETE') as can_access_sessions_directly,
  has_function_privilege(current_user,'deadhub_private.open_session(text,uuid,bigint,text,text,text)','EXECUTE') as can_open_session,
  has_function_privilege(current_user,'deadhub_private.resolve_session(text)','EXECUTE') as can_resolve_session;
select c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on c.relnamespace=n.oid
where n.nspname='deadhub_private' and c.relkind='r' order by c.relname;
select r.rolname as membership from pg_auth_members m join pg_roles r on r.oid=m.roleid
where m.member=(select oid from pg_roles where rolname=current_user);
-- All of these should be false, even if global default grants later change.
select r.rolname,
  has_schema_privilege(r.oid,'deadhub_private','USAGE,CREATE') as can_use_or_create,
  exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='deadhub_private' and c.relkind='r'
      and has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as has_table_privilege,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='deadhub_private' and has_function_privilege(r.oid,p.oid,'EXECUTE')) as can_execute_auth
from pg_roles r where r.rolname in ('anon','authenticated','service_role') order by r.rolname;
rollback;

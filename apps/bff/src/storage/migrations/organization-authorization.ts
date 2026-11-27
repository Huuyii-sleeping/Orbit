import type Database from "better-sqlite3";

/** v9：运行发起人不可变与组织控制操作审计，历史发起人保留为空。 */
export function migrateOrganizationAuthorization(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      alter table workflow_runs add column initiated_by text;
      create trigger workflow_runs_initiator_immutable before update of initiated_by on workflow_runs
        when old.initiated_by is not new.initiated_by
        begin select raise(abort, 'workflow run initiator is immutable'); end;
      create table organization_audit_events (
        id text primary key, issuer text not null, tenant_id text not null,
        operation_id text not null, subject text not null, action text not null,
        resource_type text not null, resource_id text not null,
        phase text not null check (phase in ('requested', 'succeeded', 'failed')),
        detail_json text not null, created_at integer not null,
        unique(operation_id, phase), check (issuer <> '' and tenant_id <> '' and subject <> '')
      );
      create index organization_audit_scope on organization_audit_events(issuer, tenant_id, created_at);
      create trigger organization_audit_immutable_update before update on organization_audit_events
        begin select raise(abort, 'organization audit is immutable'); end;
      create trigger organization_audit_immutable_delete before delete on organization_audit_events
        begin select raise(abort, 'organization audit is immutable'); end;
    `);
    database.prepare("insert into schema_migrations(version, applied_at) values (?, ?)").run(9, Date.now());
  })();
}

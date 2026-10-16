alter table calls add column if not exists bimpe_call_id text unique;
alter table calls add column if not exists context jsonb not null default '{}'::jsonb;
create index if not exists calls_active_idx on calls (business_id, created_at desc) where status in ('queued','ringing','answered','in_progress');

create extension if not exists pgcrypto;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null, site_url text not null, api_base_url text not null,
  shared_secret_encrypted text not null, knowledge text not null default '',
  vapi_assistant_id text, vapi_phone_number_id text, vapi_structured_output_id text,
  status text not null default 'draft', last_event_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists actions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  name text not null, description text not null, method text not null, path text not null,
  params_schema jsonb not null default '{}'::jsonb, enabled boolean not null default true,
  unique (business_id, name)
);
create table if not exists triggers (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  event_type text not null, script text not null, delay_seconds integer not null default 60,
  enabled boolean not null default true, unique (business_id, event_type)
);
create table if not exists customers (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  external_id text, name text not null, phone text not null, created_at timestamptz not null default now(),
  unique (business_id, phone)
);
create table if not exists calls (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id), vapi_call_id text unique,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null check (channel in ('phone','web')),
  status text not null default 'queued', started_at timestamptz, ended_at timestamptz,
  duration_s integer, transcript text, summary text, recording_url text,
  structured_data jsonb not null default '{}'::jsonb, trigger_event_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(), call_id uuid references calls(id) on delete set null,
  tool_name text not null, args jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb, status text not null, latency_ms integer,
  created_at timestamptz not null default now()
);
create table if not exists events (
  id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id) on delete cascade,
  type text not null, payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null, received_at timestamptz not null default now(),
  call_id uuid references calls(id), dispatched_at timestamptz,
  retry_count integer not null default 0, next_attempt_at timestamptz
);
alter table calls add constraint calls_trigger_event_fk foreign key (trigger_event_id) references events(id);
create table if not exists followups (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id), call_id uuid references calls(id),
  reason text not null, due_date date not null, done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists calls_business_started_idx on calls (business_id, started_at desc);
create index if not exists events_due_idx on events (next_attempt_at) where dispatched_at is null and signature_valid;
create index if not exists customers_business_phone_idx on customers (business_id, phone);

-- The browser reads through authenticated Aide API routes, not directly from these tables.
alter table businesses enable row level security;
alter table actions enable row level security;
alter table triggers enable row level security;
alter table customers enable row level security;
alter table calls enable row level security;
alter table tool_calls enable row level security;
alter table events enable row level security;
alter table followups enable row level security;

do $$ begin
  alter publication supabase_realtime add table calls;
exception when duplicate_object then null;
end $$;

-- Arike owns its catalogue, customers and orders. Aide only sees these through actions.
create table if not exists arike_products (
  id text primary key, name text not null, description text not null,
  material text not null, care text not null, price_naira integer not null,
  sizes jsonb not null, delivery_days integer not null, image_url text
);
create table if not exists arike_customers (
  id uuid primary key default gen_random_uuid(), full_name text not null,
  phone text not null unique, created_at timestamptz not null default now()
);
create table if not exists arike_orders (
  id text primary key, customer_id uuid not null references arike_customers(id),
  items jsonb not null, postcode text, address_text text not null,
  address_needs_review boolean not null default false,
  payment_method text not null check (payment_method = 'pay_on_delivery'),
  total_naira integer not null, estimated_delivery date not null,
  status text not null default 'placed', created_at timestamptz not null default now()
);
alter table arike_products enable row level security;
alter table arike_customers enable row level security;
alter table arike_orders enable row level security;

create policy "demo user reads calls for live dashboard" on calls for select to authenticated using (true);

insert into arike_products (id,name,description,material,care,price_naira,sizes,delivery_days,image_url) values
('ari-shirt-01','The Ada Shirt','A relaxed pre-order shirt with a curved hem and hand-finished collar.','100% cotton poplin','Cold wash and line dry',32000,'{"XS":3,"S":8,"M":12,"L":7,"XL":2}'::jsonb,7,null),
('ari-set-02','The Amara Set','A two-piece top and trouser set made for easy movement.','Linen-cotton blend','Gentle cold wash',58000,'{"S":5,"M":9,"L":4,"XL":2}'::jsonb,10,null),
('ari-dress-03','The Zuri Dress','An everyday midi dress with a softly gathered waist.','Lightweight cotton','Cold wash and air dry',45000,'{"XS":2,"S":6,"M":8,"L":5}'::jsonb,8,null)
on conflict (id) do nothing;

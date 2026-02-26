-- Category Scanner Dashboard Schema
-- Run this in Supabase SQL Editor to set up the database

-- ─── SITES ───────────────────────────────────────────────────────────────────

create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null unique,
  selector    text not null default 'li.product-grid__item',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── SCANS ───────────────────────────────────────────────────────────────────

create table if not exists public.scans (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  triggered_by    text,
  started_at      timestamptz,
  completed_at    timestamptz,
  total_pages     integer not null default 0,
  empty_count     integer not null default 0,
  error_count     integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ─── SCAN RESULTS ────────────────────────────────────────────────────────────

create table if not exists public.scan_results (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid not null references public.scans(id) on delete cascade,
  site_id         uuid references public.sites(id) on delete set null,
  site_url        text not null,
  page_url        text not null,
  product_count   integer,
  status          text not null check (status in ('ok', 'empty', 'error')),
  error_message   text,
  scanned_at      timestamptz not null default now()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────

create index if not exists scan_results_scan_id_idx on public.scan_results(scan_id);
create index if not exists scan_results_site_id_idx on public.scan_results(site_id);
create index if not exists scan_results_site_url_idx on public.scan_results(site_url);
create index if not exists scans_status_idx on public.scans(status);
create index if not exists scans_created_at_idx on public.scans(created_at desc);

-- ─── UPDATED_AT TRIGGER ──────────────────────────────────────────────────────

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_sites_updated
  before update on public.sites
  for each row execute procedure public.handle_updated_at();

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────

alter table public.sites enable row level security;
alter table public.scans enable row level security;
alter table public.scan_results enable row level security;

-- Authenticated users can read/write everything
create policy "Authenticated users can read sites"
  on public.sites for select to authenticated using (true);
create policy "Authenticated users can insert sites"
  on public.sites for insert to authenticated with check (true);
create policy "Authenticated users can update sites"
  on public.sites for update to authenticated using (true);
create policy "Authenticated users can delete sites"
  on public.sites for delete to authenticated using (true);

create policy "Authenticated users can read scans"
  on public.scans for select to authenticated using (true);
create policy "Authenticated users can insert scans"
  on public.scans for insert to authenticated with check (true);
create policy "Authenticated users can update scans"
  on public.scans for update to authenticated using (true);

create policy "Authenticated users can read scan_results"
  on public.scan_results for select to authenticated using (true);
create policy "Authenticated users can insert scan_results"
  on public.scan_results for insert to authenticated with check (true);

-- Service role (worker) bypasses RLS automatically

-- ─── REALTIME ────────────────────────────────────────────────────────────────

-- Enable Realtime for live scan progress in the dashboard.
-- In Supabase dashboard: Database > Replication > enable for scan_results and scans tables.
-- Or run:
-- alter publication supabase_realtime add table public.scan_results;
-- alter publication supabase_realtime add table public.scans;

-- ─── SEED DATA ───────────────────────────────────────────────────────────────

insert into public.sites (name, url, selector) values
  ('Avantco Refrigeration', 'https://www.avantcorefrigeration.com', 'li.product-grid__item'),
  ('Carnival King Supplies',  'https://www.carnivalkingsupplies.com', 'li.product-grid__item'),
  ('Acopa Tableware',         'https://www.acopatableware.com',       'li.product-grid__item'),
  ('Avantco Equipment',       'https://www.avantcoequipment.com',     'a.product-card'),
  ('Capora',                  'https://www.capora.com',               'a.fancy-product-card, a.simple-product-card')
on conflict (url) do nothing;

-- NAS scan rebuild template (run on PostgreSQL)
-- 0) Ensure pgcrypto is enabled for gen_random_uuid()
create extension if not exists pgcrypto;

-- 1) staging table
create table if not exists staging_nas_inventory (
  id bigserial primary key,
  nas_abs_path text not null,
  nas_rel_path text not null,
  stored_filename text not null,
  extension text null,
  file_size bigint null,
  sha256 varchar(64) not null,
  scanned_at timestamp null
);

-- 2) truncate and import (run in psql client)
truncate table staging_nas_inventory;
-- \copy staging_nas_inventory(nas_abs_path,nas_rel_path,stored_filename,extension,file_size,sha256,scanned_at)
-- from 'nas_inventory.csv' with csv header encoding 'UTF8';

-- 3) duplicate hash check
select sha256, count(*)
from staging_nas_inventory
group by sha256
having count(*) > 1
order by count(*) desc;

-- 4) insert missing materials
with src as (
  select distinct on (sha256)
    sha256,
    stored_filename
  from staging_nas_inventory
  order by sha256, id asc
),
ins as (
  insert into materials (id, title, description, status, download_count, uploader)
  select gen_random_uuid(), split_part(stored_filename, '.', 1), '灾备恢复导入', 'available', 0, null
  from src s
  where not exists (
    select 1
    from material_files mf
    where mf.sha256 = s.sha256 and mf.file_role = 'original'
  )
  returning id
)
select count(*) as inserted_materials from ins;

-- 5) insert missing material_files
insert into material_files (
  id, material_id, file_role, storage_type,
  original_filename, stored_filename, file_path,
  extension, file_size, sha256, metadata
)
select
  gen_random_uuid(),
  m.id,
  'original',
  'nas',
  s.stored_filename,
  s.stored_filename,
  s.nas_rel_path,
  nullif(s.extension, ''),
  s.file_size,
  s.sha256,
  jsonb_build_object('recovery', true, 'source', 'nas_scan')
from staging_nas_inventory s
join materials m on m.title = split_part(s.stored_filename, '.', 1)
where not exists (
  select 1 from material_files mf
  where mf.sha256 = s.sha256 and mf.file_role = 'original'
);

-- 6) fallback unorganized tag
insert into material_tags(id, material_id, tag_id)
select gen_random_uuid(), m.id, t.id
from materials m
join tags t on t.name = '未整理'
where not exists (
  select 1 from material_tags mt where mt.material_id = m.id
);

-- 7) post-check
select count(*) as materials_count from materials;
select count(*) as original_files_count from material_files where file_role = 'original';
select count(*) as invalid_sha256_count from material_files where sha256 is null or length(sha256) <> 64;
select status, count(*) from sync_operations group by status order by status;

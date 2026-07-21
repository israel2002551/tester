alter table public.products
add column if not exists images jsonb default '[]'::jsonb,
add column if not exists videos jsonb default '[]'::jsonb;

do $$
declare
  images_type text;
  videos_type text;
begin
  select data_type
    into images_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'images';

  select data_type
    into videos_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'videos';

  if images_type = 'jsonb' then
    execute $sql$
      update public.products
      set images = to_jsonb(array_remove(array[image_url], null))
      where (images is null or jsonb_array_length(coalesce(images, '[]'::jsonb)) = 0)
        and image_url is not null
        and image_url <> ''
    $sql$;
  elsif images_type = 'ARRAY' then
    execute $sql$
      update public.products
      set images = array_remove(array[image_url], null)
      where (images is null or cardinality(images) = 0)
        and image_url is not null
        and image_url <> ''
    $sql$;
  end if;

  if videos_type = 'jsonb' then
    execute $sql$
      update public.products
      set videos = to_jsonb(array_remove(array[video_url], null)),
          has_video = true
      where (videos is null or jsonb_array_length(coalesce(videos, '[]'::jsonb)) = 0)
        and video_url is not null
        and video_url <> ''
    $sql$;
  elsif videos_type = 'ARRAY' then
    execute $sql$
      update public.products
      set videos = array_remove(array[video_url], null),
          has_video = true
      where (videos is null or cardinality(videos) = 0)
        and video_url is not null
        and video_url <> ''
    $sql$;
  end if;
end $$;

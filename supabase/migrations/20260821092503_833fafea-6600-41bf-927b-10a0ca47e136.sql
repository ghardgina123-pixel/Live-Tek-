create or replace function public.storage_path_from_url(u text, bucket text)
returns text language sql immutable as $$
  select case
    when u is null then null
    when u ~ ('/object/(sign|public|authenticated)/' || bucket || '/') then
      split_part(regexp_replace(u, '^.*/object/(sign|public|authenticated)/' || bucket || '/', ''), '?', 1)
    else u end
$$;

update public.products set image_url = public.storage_path_from_url(image_url, 'product-images')
  where image_url ~ '/object/(sign|public|authenticated)/product-images/';
update public.product_videos set video_url = public.storage_path_from_url(video_url, 'product-videos')
  where video_url ~ '/object/(sign|public|authenticated)/product-videos/';
update public.product_videos set thumbnail_url = public.storage_path_from_url(thumbnail_url, 'product-videos')
  where thumbnail_url ~ '/object/(sign|public|authenticated)/product-videos/';
update public.stores set logo_url = public.storage_path_from_url(logo_url, 'store-assets')
  where logo_url ~ '/object/(sign|public|authenticated)/store-assets/';
update public.stores set cover_url = public.storage_path_from_url(cover_url, 'store-assets')
  where cover_url ~ '/object/(sign|public|authenticated)/store-assets/';
update public.profiles set avatar_url = public.storage_path_from_url(avatar_url, 'avatars')
  where avatar_url ~ '/object/(sign|public|authenticated)/avatars/';

drop function public.storage_path_from_url(text, text);
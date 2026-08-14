CREATE OR REPLACE FUNCTION public.broadcast_store_status()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    INSERT INTO public.global_notifications (kind, title, body, url, ref_id)
    VALUES ('store.new','Nova loja na Live Teká', NEW.name, '/loja/'||NEW.id::text, NEW.id);
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.broadcast_new_store()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.admin_notifications (kind, subject, payload)
  VALUES ('store.created','Nova loja registrada', jsonb_build_object('store_id',NEW.id,'name',NEW.name,'owner_id',NEW.owner_id));

  IF NEW.status = 'active' THEN
    INSERT INTO public.global_notifications (kind, title, body, url, ref_id)
    VALUES ('store.new','Nova loja na Live Teká', NEW.name, '/loja/'||NEW.id::text, NEW.id);
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.on_user_notification_push()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.dispatch_push('user', jsonb_build_object(
    'user_id', NEW.user_id,
    'title', COALESCE(NEW.title, 'Live Teká'),
    'body', COALESCE(NEW.body, ''),
    'url', COALESCE(NEW.url, '/'),
    'kind', NEW.kind
  ));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW; END;
$function$;

UPDATE public.global_notifications SET title = replace(title, 'Live Market', 'Live Teká') WHERE title LIKE '%Live Market%';
UPDATE public.payment_methods SET config = jsonb_set(config, '{holder}', '"Live Teká Lda"') WHERE config->>'holder' = 'Live Market Lda';
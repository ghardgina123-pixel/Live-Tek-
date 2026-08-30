-- 1) Remover completamente a ingestão RTSP (credenciais em texto claro / SSRF)
ALTER TABLE public.live_cameras DROP COLUMN IF EXISTS source_url;
UPDATE public.live_cameras SET source_type = 'whip' WHERE source_type NOT IN ('phone','rtmp','whip');
ALTER TABLE public.live_cameras DROP CONSTRAINT IF EXISTS live_cameras_source_type_chk;
ALTER TABLE public.live_cameras
  ADD CONSTRAINT live_cameras_source_type_chk
  CHECK (source_type IN ('phone','rtmp','whip'));

-- 2) Chat da live: tamanho máximo e apenas em lives a decorrer
ALTER TABLE public.live_messages DROP CONSTRAINT IF EXISTS live_messages_text_len_chk;
ALTER TABLE public.live_messages
  ADD CONSTRAINT live_messages_text_len_chk
  CHECK (char_length(btrim(text)) BETWEEN 1 AND 500);

DROP POLICY IF EXISTS live_messages_insert_self ON public.live_messages;
CREATE POLICY live_messages_insert_self ON public.live_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.lives l WHERE l.id = live_id AND l.status = 'live'::live_status)
  );

-- 3) Rate limiting em operações sensíveis
DROP TRIGGER IF EXISTS rl_lives_insert ON public.lives;
CREATE TRIGGER rl_lives_insert BEFORE INSERT ON public.lives
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('livecreate', '10', '60', '15');

DROP TRIGGER IF EXISTS rl_live_cameras_insert ON public.live_cameras;
CREATE TRIGGER rl_live_cameras_insert BEFORE INSERT ON public.live_cameras
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('livecam', '20', '60', '10');
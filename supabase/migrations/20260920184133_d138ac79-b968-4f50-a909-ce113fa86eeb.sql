DROP POLICY IF EXISTS live_messages_insert_self ON public.live_messages;
DROP POLICY IF EXISTS live_messages_select_active_live ON public.live_messages;

CREATE POLICY live_messages_insert_self ON public.live_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.lives l
    LEFT JOIN public.stores s ON s.id = l.store_id
    WHERE l.id = live_messages.live_id
      AND (l.status = 'live'::live_status OR s.owner_id = auth.uid())
  )
);

CREATE POLICY live_messages_select_active_live ON public.live_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.lives l
    LEFT JOIN public.stores s ON s.id = l.store_id
    WHERE l.id = live_messages.live_id
      AND (l.status = 'live'::live_status OR s.owner_id = auth.uid())
  )
);
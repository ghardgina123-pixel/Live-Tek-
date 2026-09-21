CREATE POLICY "live_messages_select_owner" ON public.live_messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lives l
    JOIN public.stores s ON s.id = l.store_id
    WHERE l.id = live_messages.live_id AND s.owner_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "live_messages_insert_owner" ON public.live_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.lives l
    JOIN public.stores s ON s.id = l.store_id
    WHERE l.id = live_messages.live_id
      AND s.owner_id = auth.uid()
      AND l.status <> 'ended'::live_status
  )
);
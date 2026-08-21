import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * URLs assinadas são geradas SEMPRE no momento da leitura e nunca guardadas
 * na base de dados. As colunas (`avatar_url`, `logo_url`, `image_url`, …)
 * guardam apenas o caminho do objeto dentro do bucket privado.
 */
export const SIGNED_URL_TTL = 60 * 60; // 1 hora

export function isStoragePath(value: string | null | undefined): value is string {
  if (!value) return false;
  return !/^(https?:|data:|blob:)/i.test(value);
}

/**
 * URLs assinadas antigas guardadas na BD expiram. Extraímos o caminho para
 * podermos voltar a assinar na leitura.
 */
export function extractStoragePath(bucket: string, value: string): string | null {
  const m = value.match(
    new RegExp(`/object/(?:sign|public|authenticated)/${bucket}/([^?]+)`),
  );
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}


const cache = new Map<string, { url: string; exp: number }>();

export async function signStorageUrl(
  bucket: string,
  value: string | null | undefined,
  ttl = SIGNED_URL_TTL,
): Promise<string | null> {
  if (!value) return null;
  if (!isStoragePath(value)) return value; // legado: URL absoluta já guardada
  const key = `${bucket}:${value}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(value, ttl);
  if (error || !data?.signedUrl) return null;
  cache.set(key, { url: data.signedUrl, exp: Date.now() + (ttl - 60) * 1000 });
  return data.signedUrl;
}

export function useStorageUrl(bucket: string, value: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(isStoragePath(value) ? null : (value ?? null));
  useEffect(() => {
    let active = true;
    if (!value) { setUrl(null); return; }
    if (!isStoragePath(value)) { setUrl(value); return; }
    signStorageUrl(bucket, value).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
  }, [bucket, value]);
  return url;
}

type StorageImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  bucket: string;
  path: string | null | undefined;
  fallback?: React.ReactNode;
};

export function StorageImage({ bucket, path, fallback = null, alt = "", ...rest }: StorageImageProps) {
  const url = useStorageUrl(bucket, path);
  if (!url) return <>{fallback}</>;
  return <img src={url} alt={alt} loading="lazy" decoding="async" {...rest} />;
}

/** Faz upload e devolve o CAMINHO do objeto (nunca uma URL assinada). */
export async function uploadToBucket(bucket: string, path: string, file: File) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}

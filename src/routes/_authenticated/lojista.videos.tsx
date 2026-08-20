import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, UploadCloud, Trash2, Film, Link as LinkIcon, Unlink } from "lucide-react";
import { LojistaShell, useLojistaStore } from "@/components/LojistaShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/lojista/videos")({
  head: () => ({ meta: [{ title: "Shorts da loja — Lojista" }] }),
  component: ShellPage,
});

const BUCKET = "product-videos";
const SIGNED_TTL = 60 * 60 * 24 * 365; // 1 ano
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB
const ACCEPT = ["video/mp4", "video/quicktime"]; // .mp4, .mov

type Product = { id: string; name: string };
type Video = {
  id: string;
  caption: string | null;
  video_url: string;
  thumbnail_url: string | null;
  views: number;
  created_at: string;
  product_id: string | null;
  product: { id: string; name: string } | null;
};

function VideosManager() {
  const { t } = useT();
  const { store } = useLojistaStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [caption, setCaption] = useState("");
  const [productId, setProductId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const storeId = store?.id;

  useEffect(() => {
    if (!storeId) return;
    supabase.from("products").select("id, name").eq("store_id", storeId).order("created_at", { ascending: false })
      .then(({ data }) => setProducts((data as Product[]) ?? []));
    loadVideos(storeId);
  }, [storeId]);

  const loadVideos = async (sid: string) => {
    const { data, error } = await supabase
      .from("product_videos")
      .select("id, caption, video_url, thumbnail_url, views, created_at, product_id, product:products(id, name)")
      .eq("store_id", sid)
      .order("created_at", { ascending: false });
    if (error) { toast.error(t("s_nao_foi_possivel_carregar_os_videos")); setVideos([]); return; }
    setVideos((data as unknown as Video[]) ?? []);
  };

  const onPick = (f: File | null) => {
    if (!f) return setFile(null);
    if (!ACCEPT.includes(f.type) && !/\.(mp4|mov)$/i.test(f.name)) {
      toast.error(t("s_formato_invalido_use_mp4_ou_mov"));
      return;
    }
    if (f.size > MAX_SIZE) {
      toast.error(t("s_arquivo_acima_do_limite_de_100_mb"));
      return;
    }
    setFile(f);
  };

  const upload = async () => {
    if (!storeId || !file) return;
    setProgress(0);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
      const path = `${storeId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || `video/${ext}`,
        upsert: false,
      });
      if (upErr) throw upErr;
      setProgress(60);

      setProgress(85);

      const { error: insErr } = await supabase.from("product_videos").insert({
        store_id: storeId,
        product_id: productId || null,
        video_url: path,
        caption: caption.trim().slice(0, 280) || null,
      });
      if (insErr) throw insErr;

      setProgress(100);
      toast.success(t("s_video_enviado"));
      setFile(null);
      setCaption("");
      setProductId("");
      if (inputRef.current) inputRef.current.value = "";
      loadVideos(storeId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    } finally {
      setTimeout(() => setProgress(null), 800);
    }
  };

  const unlink = async (v: Video) => {
      const { error } = await supabase.from("product_videos").update({ product_id: null }).eq("id", v.id);
    if (error) return toast.error(error.message);
    toast.success(t("s_produto_desvinculado"));
    if (storeId) loadVideos(storeId);
  };

  const remove = async (v: Video) => {
    if (!confirm("Apagar este vídeo? A ação não pode ser desfeita.")) return;
    // Extrai o path do storage a partir da signed URL (…/object/sign/<bucket>/<path>?token=…)
    const match = v.video_url.match(/\/object\/(?:sign|public)\/product-videos\/([^?]+)/);
    const path = match?.[1] ? decodeURIComponent(match[1]) : null;
    if (path) await supabase.storage.from(BUCKET).remove([path]);
    const { error } = await supabase.from("product_videos").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    toast.success(t("s_video_removido"));
    if (storeId) loadVideos(storeId);
  };

  return (
    <div className="space-y-6">
      {/* Uploader */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <UploadCloud size={18} className="text-primary" />
          <h2 className="text-sm font-semibold">{t("s_novo_short")}</h2>
        </div>

        <label
          htmlFor="video-file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 p-6 text-center transition hover:bg-muted"
        >
          <Film size={28} className="text-muted-foreground" />
          <p className="text-sm font-medium">{file ? file.name : "Toque para selecionar um vídeo"}</p>
          <p className="text-xs text-muted-foreground">{t("s_mp4_ou_mov_ate_100_mb")}</p>
          <Input
            id="video-file"
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            className="sr-only"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>

        <div className="mt-3 space-y-3">
          <div>
            <Label htmlFor="caption" className="text-xs">{t("s_legenda_opcional")}</Label>
            <Textarea
              id="caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={t("s_descreva_o_video")}
              maxLength={280}
              className="mt-1 resize-none"
              rows={2}
            />
            <p className="mt-1 text-right text-[10px] text-muted-foreground">{caption.length}/280</p>
          </div>

          <div>
            <Label className="text-xs">{t("s_vincular_a_um_produto_opcional")}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t("s_sem_produto_vinculado")} />
              </SelectTrigger>
              <SelectContent>
                {products.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">{t("s_nenhum_produto_cadastrado")}</div>
                )}
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {progress !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          <Button onClick={upload} disabled={!file || progress !== null} className="w-full">
            {progress !== null ? <><Loader2 className="mr-2 animate-spin" size={16} /> {t("s_enviando")}</> : "Publicar Short"}
          </Button>
        </div>
      </section>

      {/* Listagem */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("s_meus_shorts")}</h2>
          <span className="text-xs text-muted-foreground">{videos?.length ?? 0} vídeo(s)</span>
        </div>

        {videos === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
        ) : videos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum vídeo enviado ainda.
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {videos.map((v) => (
              <li key={v.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="relative aspect-[9/16] bg-black">
                  <video
                    src={v.video_url}
                    poster={v.thumbnail_url ?? undefined}
                    className="h-full w-full object-cover"
                    playsInline
                    preload="metadata"
                    controls
                    controlsList="nodownload"
                  />
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    {v.views} views
                  </span>
                </div>
                <div className="space-y-2 p-2">
                  {v.caption && <p className="line-clamp-2 text-xs">{v.caption}</p>}
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <LinkIcon size={11} />
                    {v.product?.name ?? <span className="italic">{t("s_sem_produto")}</span>}
                  </p>
                  <div className="flex gap-1.5">
                    {v.product_id && (
                      <Button variant="outline" size="sm" className="h-8 flex-1 text-xs" onClick={() => unlink(v)}>
                        <Unlink size={12} className="mr-1" /> {t("s_desvincular")}
                      </Button>
                    )}
                    <Button variant="destructive" size="sm" className="h-8 flex-1 text-xs" onClick={() => remove(v)}>
                      <Trash2 size={12} className="mr-1" /> {t("s_apagar")}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ShellPage() {
  const { t } = useT();
  return (
    <LojistaShell title={t("s_shorts_da_loja")}>
      <VideosManager />
    </LojistaShell>
  );
}
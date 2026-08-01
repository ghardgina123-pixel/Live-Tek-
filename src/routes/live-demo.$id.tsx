import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Radio, Users, ShoppingBag, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import modaAsset from "@/assets/sellers/moda.jpg.asset.json";
import organicosAsset from "@/assets/sellers/organicos.jpg.asset.json";

export const Route = createFileRoute("/live-demo/$id")({
  head: () => ({ meta: [{ title: "Live demonstrativa — Live Teká" }] }),
  component: LiveDemo,
});

type DemoData = {
  name: string;
  tagline: string;
  image: string;
  products: { id: string; name: string; price: number; emoji: string }[];
};

const DEMOS: Record<string, DemoData> = {
  "demo-kikolo-tenis": {
    name: "Kikolo Sneakers",
    tagline: "Ténis originais direto de Kikolo Shopping",
    image: modaAsset.url,
    products: [
      { id: "t1", name: "Nike Air Max 270", price: 95000, emoji: "👟" },
      { id: "t2", name: "Adidas Ultraboost", price: 110000, emoji: "👟" },
      { id: "t3", name: "Puma RS-X", price: 78000, emoji: "👟" },
    ],
  },
  "demo-kikolo-diversos": {
    name: "Kikolo Diversos",
    tagline: "Casa, moda e tecnologia do Kikolo Shopping",
    image: organicosAsset.url,
    products: [
      { id: "d1", name: "Auriculares Bluetooth", price: 18500, emoji: "🎧" },
      { id: "d2", name: "Panela elétrica 5L", price: 42000, emoji: "🍲" },
      { id: "d3", name: "Carteira em couro", price: 12000, emoji: "👜" },
    ],
  },
};

const SEED_MSGS = [
  { user: "Ana", text: "Que ténis lindo! 😍" },
  { user: "João", text: "Tem o 42?" },
  { user: "Mariana", text: "Entregam em Viana?" },
];

function LiveDemo() {
  const { id } = useParams({ from: "/live-demo/$id" });
  const demo = DEMOS[id] ?? DEMOS["demo-kikolo-tenis"];
  const [viewers, setViewers] = useState(120 + Math.floor(Math.random() * 60));
  const [msgs, setMsgs] = useState(SEED_MSGS);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setViewers((v) => v + (Math.random() > 0.5 ? 1 : -1)), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setMsgs((m) => [...m, { user: "Você", text: text.trim() }]);
    setText("");
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-black text-white">
      <div className="relative aspect-[9/16] w-full overflow-hidden">
        <img src={demo.image} alt={demo.name} className="h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
        <Link to="/home" className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur" aria-label="Voltar">
          <ArrowLeft size={18} />
        </Link>
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-[var(--live)] px-3 py-1 text-[10px] font-bold uppercase shadow-lg">
          <Radio size={11} /> ao vivo · demo
        </div>
        <div className="absolute left-3 bottom-3 rounded-full bg-black/50 px-3 py-1 text-xs backdrop-blur">
          <span className="font-semibold">{demo.name}</span>
        </div>
        <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-black/50 px-3 py-1 text-xs backdrop-blur">
          <Users size={12} /> {viewers}
        </div>
      </div>

      <div className="border-y border-white/10 bg-black/60 px-3 py-2">
        <p className="mb-1.5 text-[10px] uppercase tracking-wide text-white/60">Em destaque · {demo.tagline}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {demo.products.map((p) => (
            <button
              key={p.id}
              onClick={() => toast.success(`${p.name} — demo`)}
              className="flex w-44 shrink-0 items-center gap-2 rounded-xl bg-white/10 p-2 text-left backdrop-blur"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-lg">{p.emoji}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold">{p.name}</p>
                <p className="text-[11px] text-primary">Kz {p.price.toLocaleString("pt-AO")}</p>
              </div>
              <ShoppingBag size={14} className="shrink-0" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {msgs.map((m, i) => (
          <div key={i} className="text-sm">
            <span className="mr-1.5 text-[11px] font-bold text-primary">{m.user}</span>
            <span className="text-white/90">{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-white/10 bg-black p-2.5">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Comente nesta live demonstrativa…"
          maxLength={500}
          className="h-10 flex-1 rounded-full border-white/20 bg-white/10 text-white placeholder:text-white/50"
        />
        <button type="submit" disabled={!text.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
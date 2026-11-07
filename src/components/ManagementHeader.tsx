import { Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ManagementHeader({ title, refresh, refreshing }: { title: string; refresh: () => void; refreshing: boolean }) {
  return <header className="flex items-center gap-3 bg-primary px-5 pb-4 pt-6 text-primary-foreground">
    <Button variant="ghost" size="icon" asChild><Link to="/admin-dashboard" aria-label="Voltar ao painel"><ArrowLeft size={18} /></Link></Button>
    <h1 className="min-w-0 flex-1 text-lg font-semibold">{title}</h1>
    <Button variant="ghost" size="icon" title="Atualizar" aria-label="Atualizar" disabled={refreshing} onClick={refresh}><RefreshCw size={18} className={refreshing ? "animate-spin" : ""} /></Button>
  </header>;
}
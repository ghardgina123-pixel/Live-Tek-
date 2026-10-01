import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { reportLovableError } from "@/lib/lovable-error-reporting";

export function PanelErrorBoundary({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "panel_error_boundary" });
    // eslint-disable-next-line no-console
    console.error("[panel]", error);
  }, [error]);

  return (
    <AppShell>
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-10 text-center">
        <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-semibold text-foreground">Não foi possível carregar este painel</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Ocorreu um erro ao comunicar com o servidor. Verifique a sua ligação e tente novamente.
        </p>
        {error?.message && (
          <details className="mt-4 w-full max-w-sm rounded-md border border-border bg-muted/40 p-3 text-left text-xs">
            <summary className="cursor-pointer font-medium text-foreground">Detalhes técnicos</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {error.message}
            </pre>
          </details>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            style={{ touchAction: "manipulation" }}
          >
            Tentar novamente
          </button>
          <button
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium"
            style={{ touchAction: "manipulation" }}
          >
            Recarregar
          </button>
          <Link
            to="/home"
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
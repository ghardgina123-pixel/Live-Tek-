import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Evita re-fetches agressivos a cada clique/foco no telemóvel.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        // Retry transient network/5xx failures 2x with backoff; skip auth/permission
        // errors (4xx) which won't succeed on retry.
        retry: (failureCount, error: unknown) => {
          const err = error as { status?: number; message?: string } | null;
          const status = err?.status;
          if (status && status >= 400 && status < 500) return false;
          const msg = (err?.message ?? "").toLowerCase();
          if (msg.includes("jwt") || msg.includes("unauthorized") || msg.includes("permission")) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        networkMode: "online",
      },
      mutations: {
        retry: 0,
        networkMode: "online",
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Pré-carrega a rota assim que o utilizador toca/passa por cima do link,
    // tornando a navegação praticamente instantânea.
    defaultPreload: "intent",
    defaultPreloadDelay: 30,
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};

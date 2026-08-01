import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";

export const Route = createFileRoute("/_authenticated/lojista")({
  head: () => ({ meta: [{ title: "Painel do Lojista — Live Teká" }] }),
  component: () => <Outlet />,
  errorComponent: PanelErrorBoundary,
});
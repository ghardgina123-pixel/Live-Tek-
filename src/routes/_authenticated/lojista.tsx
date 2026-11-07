import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";

export const Route = createFileRoute("/_authenticated/lojista")({
  component: () => <Outlet />,
  errorComponent: PanelErrorBoundary,
});
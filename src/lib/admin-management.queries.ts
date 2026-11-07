import { queryOptions } from "@tanstack/react-query";
import { getManagementOverview } from "./admin-management.functions";

export const managementOverviewOptions = () => queryOptions({
  queryKey: ["admin", "management-overview"],
  queryFn: () => getManagementOverview(),
  staleTime: 0,
  gcTime: 0,
});
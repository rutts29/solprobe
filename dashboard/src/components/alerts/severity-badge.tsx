import { Badge } from "@/components/ui/badge";
import type { AlertModel } from "@/lib/types";

const variantMap = {
  CRITICAL: "destructive",
  WARNING: "warning",
  INFO: "info",
} as const;

export function SeverityBadge({ severity }: { severity: AlertModel["severity"] }) {
  return <Badge variant={variantMap[severity]}>{severity}</Badge>;
}

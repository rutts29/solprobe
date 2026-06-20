import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  className?: string;
}

const ALIGN: Record<string, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  empty,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                  ALIGN[c.align ?? "left"],
                  c.headerClassName,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                {empty ?? "No data"}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b transition-colors last:border-b-0",
                  onRowClick && "cursor-pointer hover:bg-accent/40",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2.5", ALIGN[c.align ?? "left"], c.className)}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Search className="h-3.5 w-3.5" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search..."}
        className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

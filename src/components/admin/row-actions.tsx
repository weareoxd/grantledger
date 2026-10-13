"use client";

import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function RowActions({
  label,
  onEdit,
  onDelete,
}: {
  label: string;
  onEdit: () => void;
  /** Omit to hide the Delete item. */
  onDelete?: () => void;
}) {
  return (
    // Not modal, and the dialogs open a tick later: otherwise the menu's closing focus counts as
    // a click outside the dialog it opened, which closes it again
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTimeout(onEdit, 0)}>
          <PencilIcon />
          Edit
        </DropdownMenuItem>
        {onDelete && (
          <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(onDelete, 0)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

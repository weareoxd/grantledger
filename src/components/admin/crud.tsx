"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/actions/result";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminTable } from "./admin-table";
import { ConfirmDelete } from "./confirm-delete";
import { RowActions } from "./row-actions";

type TableProps<T> = Omit<Parameters<typeof AdminTable<T>>[0], "rowActions" | "actions">;

/**
 * A list of records with Add, Edit (a dialog with `renderForm`) and Delete (a confirmation), as
 * the stocks app's admin pages work. The dialog keeps the last record while it closes, so its text
 * doesn't change during the exit animation.
 */
export function CrudTable<T>({
  table,
  label,
  addLabel,
  dialogTitle,
  dialogDescription,
  dialogClassName,
  renderForm,
  onDelete,
  deleteDescription,
  canDelete = () => true,
}: {
  table: TableProps<T>;
  label: (row: T) => string;
  addLabel?: string;
  dialogTitle: (row: T | undefined) => string;
  dialogDescription?: ReactNode;
  dialogClassName?: string;
  renderForm: (row: T | undefined, done: () => void) => ReactNode;
  onDelete?: (row: T) => Promise<ActionResult<unknown>>;
  deleteDescription?: (row: T) => ReactNode;
  canDelete?: (row: T) => boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<T>();
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<T>();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <AdminTable
        {...table}
        actions={
          addLabel ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <PlusIcon />
              {addLabel}
            </Button>
          ) : undefined
        }
        rowActions={(row) => (
          <RowActions
            label={label(row)}
            onEdit={() => {
              setEditing(row);
              setFormOpen(true);
            }}
            onDelete={
              onDelete && canDelete(row)
                ? () => {
                    setDeleting(row);
                    setDeleteOpen(true);
                  }
                : undefined
            }
          />
        )}
      />
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className={dialogClassName ?? "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle>{dialogTitle(editing)}</DialogTitle>
            {dialogDescription && <DialogDescription>{dialogDescription}</DialogDescription>}
          </DialogHeader>
          {/* Content unmounts after the close animation, so each open starts a fresh form. */}
          {formOpen && renderForm(editing, () => setFormOpen(false))}
        </DialogContent>
      </Dialog>
      {onDelete && (
        <ConfirmDelete
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={deleting ? `Delete ${label(deleting)}?` : "Delete?"}
          description={
            deleting && deleteDescription ? deleteDescription(deleting) : "This can't be undone."
          }
          onConfirm={async () => {
            if (!deleting) return;
            const result = await onDelete(deleting);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(`${label(deleting)} deleted`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** Submit a form's values to an action; on success, toast, close and refresh the page. */
export function useSave() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const save = async (
    work: () => Promise<ActionResult<unknown>>,
    message: string,
    done: () => void,
  ) => {
    setError(null);
    const result = await work();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(message);
    done();
    router.refresh();
  };
  return { error, save };
}

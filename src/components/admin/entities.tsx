"use client";

import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import {
  deleteFiscalYear,
  deleteMinistry,
  deleteOrganization,
  deleteProgram,
  deleteRecipient,
  saveFiscalYear,
  saveMinistry,
  saveOrganization,
  saveProgram,
  saveRecipient,
} from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import type {
  FiscalYearAdminRow,
  MinistryAdminRow,
  Option,
  OrganizationAdminRow,
  ProgramAdminRow,
  RecipientAdminRow,
} from "@/lib/admin/queries";
import {
  fiscalYearInput,
  ministryInput,
  organizationInput,
  programInput,
  recipientInput,
} from "@/lib/validation/admin";
import type { AdminListState } from "./admin-table";
import { ToolbarSelect } from "./admin-table";
import { CrudTable, useSave } from "./crud";
import { CheckboxField, FormError, SelectField, TextField } from "./form-fields";

const numbers = new Intl.NumberFormat("en-CA");
const count = (value: number) => numbers.format(value);

/** Cancel and Save, with Save busy while the form submits. */
export function FormFooter({
  onCancel,
  submitting,
}: {
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </Button>
    </DialogFooter>
  );
}

/** A link to the record's awards in the Awards tab. */
function AwardsLink({ filter, value, total }: { filter: string; value: number; total: number }) {
  if (!total) return <span className="text-muted-foreground">0</span>;
  return (
    <Link
      href={`/admin/awards?${filter}=${value}`}
      className="tabular-nums underline-offset-4 hover:underline"
    >
      {count(total)}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Governments
// ---------------------------------------------------------------------------

function OrganizationForm({ row, done }: { row?: OrganizationAdminRow; done: () => void }) {
  const { error, save } = useSave();
  const form = useForm({
    defaultValues: { name: row?.name ?? "", key: row?.key ?? "" },
    validators: { onSubmit: organizationInput },
    onSubmit: ({ value }) =>
      save(
        () => saveOrganization(value, row?.id),
        row ? "Government updated" : "Government added",
        done,
      ),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="name">
          {(field) => <TextField field={field} label="Name" autoFocus />}
        </form.Field>
        <form.Field name="key">
          {(field) => (
            <TextField
              field={field}
              label="Key"
              description="The importers find their government by key: federal and alberta."
            />
          )}
        </form.Field>
        <FormError message={error} />
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => <FormFooter onCancel={done} submitting={submitting} />}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}

export function OrganizationsAdmin({ rows }: { rows: OrganizationAdminRow[] }) {
  return (
    <CrudTable
      table={{
        rows,
        total: rows.length,
        state: { q: "", page: 1, size: 100, sort: "name" },
        noun: { one: "government", other: "governments" },
        rowKey: (row) => row.id,
        columns: [
          {
            key: "name",
            header: "Name",
            cell: (row) => <span className="font-medium">{row.name}</span>,
          },
          { key: "key", header: "Key", cell: (row) => <code className="text-xs">{row.key}</code> },
          {
            key: "ministries",
            header: "Ministries",
            className: "text-right",
            cell: (row) => (
              <Link
                href={`/admin/ministries?organization=${row.id}`}
                className="tabular-nums hover:underline"
              >
                {count(row.ministries)}
              </Link>
            ),
          },
          {
            key: "awards",
            header: "Current awards",
            className: "text-right",
            cell: (row) => <AwardsLink filter="organization" value={row.id} total={row.awards} />,
          },
        ],
      }}
      label={(row) => row.name}
      addLabel="Add government"
      dialogTitle={(row) => (row ? `Edit ${row.name}` : "Add government")}
      renderForm={(row, done) => <OrganizationForm row={row} done={done} />}
      onDelete={(row) => deleteOrganization({ id: row.id })}
      deleteDescription={(row) =>
        `This deletes ${row.name} with its ${count(row.ministries)} ministries, their programs and all their awards (${count(row.awards)} current). The next import brings back what its files hold.`
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Ministries
// ---------------------------------------------------------------------------

function MinistryForm({
  row,
  organizations,
  done,
}: {
  row?: MinistryAdminRow;
  organizations: Option[];
  done: () => void;
}) {
  const { error, save } = useSave();
  const form = useForm({
    defaultValues: { organizationId: row ? String(row.organizationId) : "", name: row?.name ?? "" },
    validators: { onSubmit: ministryInput },
    onSubmit: ({ value }) =>
      save(() => saveMinistry(value, row?.id), row ? "Ministry updated" : "Ministry added", done),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="organizationId">
          {(field) => (
            <SelectField
              field={field}
              label="Government"
              options={organizations}
              placeholder="Choose a government"
            />
          )}
        </form.Field>
        <form.Field name="name">
          {(field) => (
            <TextField
              field={field}
              label="Name"
              autoFocus
              description="Imports match ministries by name: a renamed ministry gets a new one on the next import of its old name."
            />
          )}
        </form.Field>
        <FormError message={error} />
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => <FormFooter onCancel={done} submitting={submitting} />}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}

export function MinistriesAdmin({
  rows,
  total,
  state,
  organizations,
  organization,
}: {
  rows: MinistryAdminRow[];
  total: number;
  state: AdminListState;
  organizations: Option[];
  organization: string;
}) {
  return (
    <CrudTable
      table={{
        rows,
        total,
        state,
        noun: { one: "ministry", other: "ministries" },
        searchPlaceholder: "Search ministries",
        toolbar: (
          <ToolbarSelect
            name="organization"
            value={organization}
            options={organizations}
            allLabel="All governments"
            label="Government"
          />
        ),
        rowKey: (row) => row.id,
        columns: [
          {
            key: "name",
            header: "Name",
            sort: "name",
            cell: (row) => <span className="font-medium">{row.name}</span>,
          },
          {
            key: "organization",
            header: "Government",
            sort: "organization",
            cell: (row) => row.organization,
          },
          {
            key: "programs",
            header: "Programs",
            className: "text-right",
            cell: (row) => (
              <Link
                href={`/admin/programs?ministry=${row.id}`}
                className="tabular-nums hover:underline"
              >
                {count(row.programs)}
              </Link>
            ),
          },
          {
            key: "awards",
            header: "Current awards",
            sort: "awards",
            className: "text-right",
            cell: (row) => <AwardsLink filter="ministry" value={row.id} total={row.awards} />,
          },
        ],
      }}
      label={(row) => row.name}
      addLabel="Add ministry"
      dialogTitle={(row) => (row ? `Edit ${row.name}` : "Add ministry")}
      renderForm={(row, done) => (
        <MinistryForm row={row} organizations={organizations} done={done} />
      )}
      onDelete={(row) => deleteMinistry({ id: row.id })}
      deleteDescription={(row) =>
        `This deletes ${row.name}, its ${count(row.programs)} programs and its awards (${count(row.awards)} current).`
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

function ProgramForm({
  row,
  ministries,
  done,
}: {
  row?: ProgramAdminRow;
  ministries: Option[];
  done: () => void;
}) {
  const { error, save } = useSave();
  const form = useForm({
    defaultValues: { ministryId: row ? String(row.ministryId) : "", name: row?.name ?? "" },
    validators: { onSubmit: programInput },
    onSubmit: ({ value }) =>
      save(() => saveProgram(value, row?.id), row ? "Program updated" : "Program added", done),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="ministryId">
          {(field) =>
            row ? (
              <div className="text-sm">
                <div className="text-muted-foreground">Ministry</div>
                <div>{row.ministry}</div>
              </div>
            ) : (
              <SelectField
                field={field}
                label="Ministry"
                options={ministries}
                placeholder="Choose a ministry"
              />
            )
          }
        </form.Field>
        <form.Field name="name">
          {(field) => <TextField field={field} label="Name" autoFocus />}
        </form.Field>
        <FormError message={error} />
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => <FormFooter onCancel={done} submitting={submitting} />}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}

export function ProgramsAdmin({
  rows,
  total,
  state,
  ministries,
  ministry,
}: {
  rows: ProgramAdminRow[];
  total: number;
  state: AdminListState;
  ministries: Option[];
  ministry: string;
}) {
  return (
    <CrudTable
      table={{
        rows,
        total,
        state,
        noun: { one: "program", other: "programs" },
        searchPlaceholder: "Search programs",
        toolbar: (
          <ToolbarSelect
            name="ministry"
            value={ministry}
            options={ministries}
            allLabel="All ministries"
            label="Ministry"
            className="w-72"
          />
        ),
        rowKey: (row) => row.id,
        columns: [
          {
            key: "name",
            header: "Name",
            sort: "name",
            cell: (row) => <span className="font-medium">{row.name}</span>,
          },
          {
            key: "ministry",
            header: "Ministry",
            cell: (row) => (
              <div>
                <div>{row.ministry}</div>
                <div className="text-muted-foreground text-xs">{row.organization}</div>
              </div>
            ),
          },
          {
            key: "awards",
            header: "Current awards",
            sort: "awards",
            className: "text-right",
            cell: (row) => <AwardsLink filter="program" value={row.id} total={row.awards} />,
          },
        ],
      }}
      label={(row) => row.name}
      addLabel="Add program"
      dialogTitle={(row) => (row ? `Edit ${row.name}` : "Add program")}
      renderForm={(row, done) => <ProgramForm row={row} ministries={ministries} done={done} />}
      onDelete={(row) => deleteProgram({ id: row.id })}
      deleteDescription={(row) => `Its ${count(row.awards)} current awards stay, with no program.`}
    />
  );
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

function RecipientForm({ row, done }: { row?: RecipientAdminRow; done: () => void }) {
  const { error, save } = useSave();
  const form = useForm({
    defaultValues: {
      name: row?.name ?? "",
      displayName: row?.displayName ?? "",
      isPlaceholder: row?.isPlaceholder ?? false,
    },
    validators: { onSubmit: recipientInput },
    onSubmit: ({ value }) =>
      save(
        () => saveRecipient(value, row?.id),
        row ? "Recipient updated" : "Recipient added",
        done,
      ),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="displayName">
          {(field) => <TextField field={field} label="Display name" autoFocus />}
        </form.Field>
        <form.Field name="name">
          {(field) => (
            <TextField
              field={field}
              label="Matching key"
              description="The normalised name both sources' spellings resolve to (upper case, accents and punctuation removed). Imports find the recipient by it."
            />
          )}
        </form.Field>
        <form.Field name="isPlaceholder">
          {(field) => (
            <CheckboxField
              field={field}
              label="Placeholder"
              description="A stand-in (withheld individuals, recipients not disclosed): counted in totals, left out of rankings."
            />
          )}
        </form.Field>
        <FormError message={error} />
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => <FormFooter onCancel={done} submitting={submitting} />}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}

export function RecipientsAdmin({
  rows,
  total,
  state,
  placeholders,
}: {
  rows: RecipientAdminRow[];
  total: number;
  state: AdminListState;
  placeholders: string;
}) {
  return (
    <CrudTable
      table={{
        rows,
        total,
        state,
        noun: { one: "recipient", other: "recipients" },
        searchPlaceholder: "Search recipients",
        toolbar: (
          <ToolbarSelect
            name="placeholders"
            value={placeholders}
            options={[
              { value: "hide", label: "Named recipients" },
              { value: "only", label: "Placeholders" },
            ]}
            allLabel="All recipients"
            label="Placeholders"
          />
        ),
        rowKey: (row) => row.id,
        columns: [
          {
            key: "name",
            header: "Recipient",
            sort: "name",
            cell: (row) => (
              <div>
                <div className="font-medium">
                  {row.displayName}{" "}
                  {row.isPlaceholder && (
                    <Badge variant="secondary" className="ml-1">
                      Placeholder
                    </Badge>
                  )}
                </div>
                {row.name !== row.displayName && (
                  <div className="text-muted-foreground text-xs">{row.name}</div>
                )}
              </div>
            ),
          },
          {
            key: "awards",
            header: "Current awards",
            sort: "awards",
            className: "text-right",
            cell: (row) => <AwardsLink filter="recipient" value={row.id} total={row.awards} />,
          },
        ],
      }}
      label={(row) => row.displayName}
      addLabel="Add recipient"
      dialogTitle={(row) => (row ? `Edit ${row.displayName}` : "Add recipient")}
      renderForm={(row, done) => <RecipientForm row={row} done={done} />}
      onDelete={(row) => deleteRecipient({ id: row.id })}
      deleteDescription={(row) =>
        `This deletes the recipient and its awards (${count(row.awards)} current).`
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Fiscal years
// ---------------------------------------------------------------------------

function FiscalYearForm({ row, done }: { row?: FiscalYearAdminRow; done: () => void }) {
  const { error, save } = useSave();
  const form = useForm({
    defaultValues: {
      year: row ? String(row.year) : "",
      startDate: row?.startDate ?? "",
      endDate: row?.endDate ?? "",
    },
    validators: { onSubmit: fiscalYearInput },
    onSubmit: ({ value }) =>
      save(
        () => saveFiscalYear(value, row?.id),
        row ? "Fiscal year updated" : "Fiscal year added",
        done,
      ),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="year"
          listeners={{
            onChange: ({ value }) => {
              // Fill the usual April-March span for a new year
              if (!/^\d{4}$/.test(value)) return;
              const year = Number(value);
              if (!form.getFieldValue("startDate"))
                form.setFieldValue("startDate", `${year}-04-01`);
              if (!form.getFieldValue("endDate"))
                form.setFieldValue("endDate", `${year + 1}-03-31`);
            },
          }}
        >
          {(field) => (
            <TextField
              field={field}
              label="Year"
              inputMode="numeric"
              description="2024 is April 2024 to March 2025."
              autoFocus
            />
          )}
        </form.Field>
        <form.Field name="startDate">
          {(field) => <TextField field={field} label="Start date" type="date" />}
        </form.Field>
        <form.Field name="endDate">
          {(field) => <TextField field={field} label="End date" type="date" />}
        </form.Field>
        <FormError message={error} />
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => <FormFooter onCancel={done} submitting={submitting} />}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}

export function FiscalYearsAdmin({ rows }: { rows: FiscalYearAdminRow[] }) {
  return (
    <CrudTable
      table={{
        rows,
        total: rows.length,
        state: { q: "", page: 1, size: 100, sort: "-year" },
        noun: { one: "fiscal year", other: "fiscal years" },
        rowKey: (row) => row.id,
        columns: [
          {
            key: "year",
            header: "Fiscal year",
            cell: (row) => <span className="font-medium">FY{row.year}</span>,
          },
          { key: "start", header: "Starts", cell: (row) => row.startDate },
          { key: "end", header: "Ends", cell: (row) => row.endDate },
        ],
      }}
      label={(row) => `FY${row.year}`}
      addLabel="Add fiscal year"
      dialogTitle={(row) => (row ? `Edit FY${row.year}` : "Add fiscal year")}
      dialogDescription="Imports keep these matching the span of the awards; an edit lasts until the next import."
      renderForm={(row, done) => <FiscalYearForm row={row} done={done} />}
      onDelete={(row) => deleteFiscalYear({ id: row.id })}
    />
  );
}

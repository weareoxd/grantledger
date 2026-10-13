"use client";

import { useForm } from "@tanstack/react-form";
import { cn } from "cn";
import { useCallback, useState } from "react";
import { deleteAward, saveAward, searchPrograms, searchRecipients } from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import type { AwardAdminRow, Option } from "@/lib/admin/queries";
import { AGREEMENT_TYPE_CODES, RECIPIENT_TYPE_CODES, RECORD_KINDS } from "@/lib/domain";
import { AGREEMENT_TYPES, RECIPIENT_TYPES } from "@/lib/grants/constants";
import { awardInput } from "@/lib/validation/admin";
import type { AdminListState } from "./admin-table";
import { ToolbarSelect } from "./admin-table";
import { AsyncPicker } from "./async-picker";
import { CrudTable, useSave } from "./crud";
import { FormFooter } from "./entities";
import { CheckboxField, FormError, SelectField, TextareaField, TextField } from "./form-fields";

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

function errorsOf(errors: unknown[]) {
  return errors.map((error) =>
    typeof error === "string" ? { message: error } : (error as { message?: string }),
  );
}

function AwardForm({
  row,
  ministries,
  done,
}: {
  row?: AwardAdminRow;
  ministries: (Option & { organizationId: number })[];
  done: () => void;
}) {
  const { error, save } = useSave();
  const [programLabel, setProgramLabel] = useState<string | null>(row?.program ?? null);
  const [recipientLabel, setRecipientLabel] = useState<string | null>(row?.recipient ?? null);
  const form = useForm({
    defaultValues: {
      ministryId: row ? String(row.ministryId) : "",
      programId: row?.programId ? String(row.programId) : "",
      recipientId: row ? String(row.recipientId) : "",
      recordKind: row?.recordKind ?? "payment",
      reference: row?.reference ?? "",
      agreementNumber: row?.agreementNumber ?? "",
      amendmentNumber: String(row?.amendmentNumber ?? 0),
      amendmentDate: row?.amendmentDate ?? "",
      isCurrent: row?.isCurrent ?? true,
      agreementType: (row?.agreementType ?? "") as "" | (typeof AGREEMENT_TYPE_CODES)[number],
      recipientType: (row?.recipientType ?? "") as "" | (typeof RECIPIENT_TYPE_CODES)[number],
      recipientProvince: row?.recipientProvince ?? "",
      recipientCity: row?.recipientCity ?? "",
      value: row?.value ?? "",
      startDate: row?.startDate ?? "",
      startDateEstimated: row?.startDateEstimated ?? false,
      endDate: row?.endDate ?? "",
      title: row?.title ?? "",
      description: row?.description ?? "",
      naics: row?.naics ?? "",
      businessUnit: row?.businessUnit ?? "",
      lotteryFund: (row?.lotteryFund === null || row?.lotteryFund === undefined
        ? ""
        : row.lotteryFund
          ? "yes"
          : "no") as "" | "yes" | "no",
    },
    validators: { onSubmit: awardInput },
    onSubmit: ({ value }) =>
      save(
        () => saveAward(value, row?.id),
        row ? "Award updated; totals rebuilt" : "Award added; totals rebuilt",
        done,
      ),
  });

  const recipientSearch = useCallback((q: string) => searchRecipients(q), []);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup className="max-h-[70vh] overflow-y-auto pr-1">
        <FieldSet>
          <FieldLegend variant="label">Who and where</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="recordKind">
              {(field) => (
                <SelectField
                  field={field}
                  label="Kind"
                  options={RECORD_KINDS.map((kind) => ({
                    value: kind,
                    label: kind === "agreement" ? "Agreement (federal)" : "Payment (Alberta)",
                  }))}
                />
              )}
            </form.Field>
            <form.Field
              name="ministryId"
              listeners={{
                onChange: () => {
                  form.setFieldValue("programId", "");
                  setProgramLabel(null);
                },
              }}
            >
              {(field) => (
                <SelectField
                  field={field}
                  label="Ministry"
                  placeholder="Choose a ministry"
                  options={ministries.map((m) => ({
                    value: m.value,
                    label: `${m.label} (${m.hint})`,
                  }))}
                />
              )}
            </form.Field>
          </div>
          <form.Subscribe selector={(s) => s.values.ministryId}>
            {(ministryId) => (
              <form.Field name="programId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="programId">Program</FieldLabel>
                    <AsyncPicker
                      id="programId"
                      value={String(field.state.value ?? "")}
                      selectedLabel={programLabel}
                      disabled={!ministryId}
                      placeholder={ministryId ? "No program" : "Choose a ministry first"}
                      noneLabel="No program"
                      search={(q) => searchPrograms(Number(ministryId), q)}
                      onChange={(value, label) => {
                        field.handleChange(value);
                        setProgramLabel(label);
                      }}
                    />
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>
          <form.Field name="recipientId">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="recipientId">Recipient</FieldLabel>
                  <AsyncPicker
                    id="recipientId"
                    value={String(field.state.value ?? "")}
                    selectedLabel={recipientLabel}
                    placeholder="Search recipients"
                    invalid={invalid}
                    search={recipientSearch}
                    onChange={(value, label) => {
                      field.handleChange(value);
                      setRecipientLabel(label);
                    }}
                  />
                  {invalid && <FieldError errors={errorsOf(field.state.meta.errors)} />}
                </Field>
              );
            }}
          </form.Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">The award</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="reference">
              {(field) => <TextField field={field} label="Reference" />}
            </form.Field>
            <form.Field name="value">
              {(field) => (
                <TextField
                  field={field}
                  label="Value (CAD)"
                  inputMode="decimal"
                  placeholder="1500.00"
                />
              )}
            </form.Field>
            <form.Field name="startDate">
              {(field) => <TextField field={field} label="Start or payment date" type="date" />}
            </form.Field>
            <form.Field name="endDate">
              {(field) => <TextField field={field} label="End date" type="date" />}
            </form.Field>
          </div>
          <form.Field name="startDateEstimated">
            {(field) => (
              <CheckboxField
                field={field}
                label="Date estimated"
                description="The source gave no date: it's the fiscal year's first day."
              />
            )}
          </form.Field>
          <form.Field name="title">
            {(field) => <TextField field={field} label="Title" />}
          </form.Field>
          <form.Field name="description">
            {(field) => <TextareaField field={field} label="Description" rows={3} />}
          </form.Field>
        </FieldSet>

        <form.Subscribe selector={(s) => s.values.recordKind}>
          {(kind) =>
            kind === "agreement" ? (
              <FieldSet>
                <FieldLegend variant="label">Agreement</FieldLegend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="agreementNumber">
                    {(field) => <TextField field={field} label="Agreement number" />}
                  </form.Field>
                  <form.Field name="agreementType">
                    {(field) => (
                      <SelectField
                        field={field}
                        label="Agreement type"
                        noneLabel="Not given"
                        options={AGREEMENT_TYPE_CODES.map((code) => ({
                          value: code,
                          label: AGREEMENT_TYPES[code] as string,
                        }))}
                      />
                    )}
                  </form.Field>
                  <form.Field name="amendmentNumber">
                    {(field) => <TextField field={field} label="Amendment" inputMode="numeric" />}
                  </form.Field>
                  <form.Field name="amendmentDate">
                    {(field) => <TextField field={field} label="Amendment date" type="date" />}
                  </form.Field>
                  <form.Field name="recipientType">
                    {(field) => (
                      <SelectField
                        field={field}
                        label="Recipient type"
                        noneLabel="Not given"
                        options={RECIPIENT_TYPE_CODES.map((code) => ({
                          value: code,
                          label: RECIPIENT_TYPES[code] as string,
                        }))}
                      />
                    )}
                  </form.Field>
                  <form.Field name="naics">
                    {(field) => <TextField field={field} label="NAICS code" />}
                  </form.Field>
                  <form.Field name="recipientProvince">
                    {(field) => <TextField field={field} label="Province" />}
                  </form.Field>
                  <form.Field name="recipientCity">
                    {(field) => <TextField field={field} label="City" />}
                  </form.Field>
                </div>
                <form.Field name="isCurrent">
                  {(field) => (
                    <CheckboxField
                      field={field}
                      label="Latest amendment"
                      description="Only the latest amendment of an agreement counts in totals. The next federal import sets this again."
                    />
                  )}
                </form.Field>
              </FieldSet>
            ) : (
              <FieldSet>
                <FieldLegend variant="label">Payment</FieldLegend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="businessUnit">
                    {(field) => <TextField field={field} label="Business unit" />}
                  </form.Field>
                  <form.Field name="lotteryFund">
                    {(field) => (
                      <SelectField
                        field={field}
                        label="Lottery fund"
                        noneLabel="Not given"
                        options={[
                          { value: "yes", label: "Yes" },
                          { value: "no", label: "No" },
                        ]}
                      />
                    )}
                  </form.Field>
                </div>
              </FieldSet>
            )
          }
        </form.Subscribe>
        {row?.sourceFile && (
          <p className="text-muted-foreground text-xs">
            Imported from {row.sourceFile}
            {row.importDate && ` on ${row.importDate}`}. Re-importing that file replaces this award
            with the file's version.
          </p>
        )}
      </FieldGroup>
      <div className="mt-4 space-y-3">
        <FormError message={error} />
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => <FormFooter onCancel={done} submitting={submitting} />}
        </form.Subscribe>
      </div>
    </form>
  );
}

export function AwardsAdmin({
  rows,
  total,
  approximate,
  state,
  ministries,
  organizations,
  filters,
  filterLabel,
}: {
  rows: AwardAdminRow[];
  total: number;
  approximate: boolean;
  state: AdminListState;
  ministries: (Option & { organizationId: number })[];
  organizations: Option[];
  filters: { organization: string; ministry: string; current: string };
  /** A recipient or program the list is narrowed to (from a link), to show and clear. */
  filterLabel?: string | null;
}) {
  const shownMinistries = ministries
    .filter((m) => !filters.organization || String(m.organizationId) === filters.organization)
    .map((m) => ({ value: m.value, label: m.label }));
  return (
    <CrudTable
      table={{
        rows,
        total,
        approximate,
        state,
        noun: { one: "award", other: "awards" },
        searchPlaceholder: "Reference or recipient",
        toolbar: (
          <>
            <ToolbarSelect
              name="organization"
              value={filters.organization}
              options={organizations}
              allLabel="All governments"
              label="Government"
              className="w-48"
            />
            <ToolbarSelect
              name="ministry"
              value={filters.ministry}
              options={shownMinistries}
              allLabel="All ministries"
              label="Ministry"
              className="w-64"
            />
            <ToolbarSelect
              name="current"
              value={filters.current}
              options={[
                { value: "yes", label: "Latest amendments" },
                { value: "no", label: "Superseded amendments" },
              ]}
              allLabel="Every amendment"
              label="Amendments"
              className="w-48"
            />
            {filterLabel && (
              <Badge variant="secondary" className="h-8 px-3">
                {filterLabel}
              </Badge>
            )}
          </>
        ),
        rowKey: (row) => row.id,
        columns: [
          {
            key: "start",
            header: "Date",
            sort: "start_date",
            className: "whitespace-nowrap",
            cell: (row) => (
              <span className={cn(row.startDateEstimated && "text-muted-foreground italic")}>
                {row.startDate}
              </span>
            ),
          },
          {
            key: "reference",
            header: "Reference",
            sort: "reference",
            cell: (row) => (
              <div className="font-mono text-xs">
                {row.reference}
                {row.recordKind === "agreement" && (
                  <div className="text-muted-foreground">
                    Amendment {row.amendmentNumber}
                    {!row.isCurrent && " · superseded"}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "recipient",
            header: "Recipient",
            cell: (row) => <div className="max-w-64 truncate">{row.recipient}</div>,
          },
          {
            key: "ministry",
            header: "Ministry",
            cell: (row) => (
              <div className="max-w-64">
                <div className="truncate">{row.ministry}</div>
                <div className="truncate text-muted-foreground text-xs">
                  {row.program ?? "No program"}
                </div>
              </div>
            ),
          },
          {
            key: "value",
            header: "Value",
            sort: "value",
            className: "text-right",
            cell: (row) => (
              <span className="tabular-nums">
                {row.value === null ? "—" : money.format(Number(row.value))}
              </span>
            ),
          },
        ],
      }}
      label={(row) => row.reference}
      addLabel="Add award"
      dialogTitle={(row) => (row ? `Edit ${row.reference}` : "Add award")}
      dialogDescription="Saving rebuilds the totals of the award's ministry, so lists and overviews show it at once."
      dialogClassName="sm:max-w-2xl"
      renderForm={(row, done) => <AwardForm row={row} ministries={ministries} done={done} />}
      onDelete={(row) => deleteAward({ id: row.id })}
      deleteDescription={(row) =>
        `This deletes ${row.reference} (${row.recipient}, ${row.value === null ? "no value" : money.format(Number(row.value))}). Re-importing ${row.sourceFile ?? "its file"} brings it back.`
      }
    />
  );
}

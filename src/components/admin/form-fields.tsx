"use client";

import type { AnyFieldApi } from "@tanstack/react-form";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Shared wiring between TanStack Form fields and shadcn `Field` layout. */

/** Radix Select can't hold "": this stands for "none" in a select's options. */
export const NONE = "__none__";

function isInvalid(field: AnyFieldApi) {
  return field.state.meta.isTouched && !field.state.meta.isValid;
}

function errorsOf(field: AnyFieldApi): { message?: string }[] {
  return (field.state.meta.errors as unknown[]).map((error) =>
    typeof error === "string" ? { message: error } : (error as { message?: string }),
  );
}

export function TextField({
  field,
  label,
  type = "text",
  placeholder,
  description,
  inputMode,
  autoFocus,
  autoComplete,
}: {
  field: AnyFieldApi;
  label: string;
  type?: "text" | "date" | "password" | "number";
  placeholder?: string;
  description?: ReactNode;
  inputMode?: "decimal" | "numeric" | "text";
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  const invalid = isInvalid(field);
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        value={String(field.state.value ?? "")}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={invalid}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      {invalid && <FieldError errors={errorsOf(field)} />}
    </Field>
  );
}

export function TextareaField({
  field,
  label,
  rows = 4,
}: {
  field: AnyFieldApi;
  label: string;
  rows?: number;
}) {
  const invalid = isInvalid(field);
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Textarea
        id={field.name}
        name={field.name}
        rows={rows}
        value={String(field.state.value ?? "")}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={invalid}
      />
      {invalid && <FieldError errors={errorsOf(field)} />}
    </Field>
  );
}

/** A select over string values; "" (none) is offered as `noneLabel` when given. */
export function SelectField({
  field,
  label,
  options,
  placeholder,
  noneLabel,
  description,
  onValueChange,
}: {
  field: AnyFieldApi;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  noneLabel?: string;
  description?: ReactNode;
  onValueChange?: (value: string) => void;
}) {
  const invalid = isInvalid(field);
  const value = String(field.state.value ?? "");
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Select
        name={field.name}
        value={value === "" ? (noneLabel ? NONE : "") : value}
        onValueChange={(next) => {
          const stored = next === NONE ? "" : next;
          field.handleChange(stored);
          onValueChange?.(stored);
        }}
      >
        <SelectTrigger
          id={field.name}
          aria-invalid={invalid}
          onBlur={field.handleBlur}
          className="w-full"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      {invalid && <FieldError errors={errorsOf(field)} />}
    </Field>
  );
}

export function CheckboxField({
  field,
  label,
  description,
}: {
  field: AnyFieldApi;
  label: string;
  description?: ReactNode;
}) {
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={field.name}
        name={field.name}
        checked={Boolean(field.state.value)}
        onCheckedChange={(checked) => field.handleChange(checked === true)}
      />
      <div className="grid gap-1">
        <FieldLabel htmlFor={field.name} className="font-normal">
          {label}
        </FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </div>
    </Field>
  );
}

/** Errors from the server that don't belong to one field. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

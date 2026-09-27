import { useId, type HTMLInputTypeAttribute, type ReactNode } from 'react';

interface FieldFrameProps {
  label: string;
  error: string | undefined;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}

function FieldFrame({ label, error, children }: FieldFrameProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy: error ? errorId : undefined })}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string;
  type?: HTMLInputTypeAttribute;
  autoComplete?: string;
  placeholder?: string;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  type = 'text',
  ...rest
}: TextFieldProps) {
  return (
    <FieldFrame label={label} error={error}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type={type}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </FieldFrame>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  error?: string;
  step?: number;
}

export function NumberField({ label, value, onChange, error, step }: NumberFieldProps) {
  return (
    <FieldFrame label={label} error={error}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          value={value ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : event.target.valueAsNumber)
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
      )}
    </FieldFrame>
  );
}

interface YesNoFieldProps {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}

/** Tri-state: yes, no, or not specified. */
export function YesNoField({ label, value, onChange }: YesNoFieldProps) {
  const selected = value === undefined ? '' : value ? 'yes' : 'no';
  return (
    <FieldFrame label={label} error={undefined}>
      {({ id }) => (
        <select
          id={id}
          value={selected}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : event.target.value === 'yes')
          }
        >
          <option value="">Not specified</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )}
    </FieldFrame>
  );
}

interface SelectFieldProps {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  error?: string;
}

/** One of a fixed set of choices, or not specified. */
export function SelectField({ label, options, value, onChange, error }: SelectFieldProps) {
  return (
    <FieldFrame label={label} error={error}>
      {({ id, describedBy }) => (
        <select
          id={id}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        >
          <option value="">Not specified</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

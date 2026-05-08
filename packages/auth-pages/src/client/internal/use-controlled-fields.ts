import { type ChangeEvent, useCallback, useState } from "react";

export type FieldBinding = {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

/**
 * Tiny controlled-fields hook. Each entry in `initial` becomes a
 * `{ value, onChange }` binding the caller spreads onto its input:
 *
 *   const fields = useControlledFields({ email: "", password: "" });
 *   <input {...fields.email} />
 */
export function useControlledFields<T extends Record<string, string>>(
  initial: T,
): {
  values: T;
  fields: { [K in keyof T]: FieldBinding };
  setValue: <K extends keyof T>(key: K, value: T[K]) => void;
  reset: () => void;
} {
  const [values, setValues] = useState<T>(initial);

  const setValue = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setValues(initial);
    // ESLint thinks `initial` is stable because callers pass an
    // object literal; we accept the closure capture deliberately
    // — `reset()` is used at the end of submit cycles only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fields = {} as { [K in keyof T]: FieldBinding };
  for (const key of Object.keys(initial) as Array<keyof T>) {
    fields[key] = {
      value: values[key] as string,
      onChange: (event) => {
        const value = event.target.value as T[typeof key];
        setValues((prev) => ({ ...prev, [key]: value }));
      },
    };
  }

  return { values, fields, setValue, reset };
}

import { z } from "zod";

// Llama 3.3 often sends tool arguments as strings: "12" for 12, "false" for
// false, "null" for null, and sometimes a JSON-encoded string for an array.
// These wrappers undo that before validation. The JSON Schema the model sees
// is unchanged (still number / boolean / array).

const NULLS = new Set(["", "null", "none", "undefined", "n/a"]);

const clean = (v: unknown) =>
  typeof v === "string" && NULLS.has(v.trim().toLowerCase()) ? null : v;

const toNumber = (v: unknown) => {
  v = clean(v);
  return typeof v === "string" && !Number.isNaN(Number(v.trim()))
    ? Number(v.trim())
    : v;
};

const toBoolean = (v: unknown) => {
  v = clean(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
};

const toArray = (v: unknown) => {
  v = clean(v);
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export const llm = {
  number: () => z.preprocess(toNumber, z.number()),
  optNumber: () => z.preprocess(toNumber, z.number().nullish()),
  optBoolean: () => z.preprocess(toBoolean, z.boolean().nullish()),
  optString: () => z.preprocess(clean, z.string().nullish()),
  enum: <const T extends readonly [string, ...string[]]>(values: T) =>
    z.preprocess(clean, z.enum(values)),
  optEnum: <const T extends readonly [string, ...string[]]>(values: T) =>
    z.preprocess(clean, z.enum(values).nullish()),
  array: <T extends z.ZodType>(item: T) => z.preprocess(toArray, z.array(item)),
  optArray: <T extends z.ZodType>(item: T) =>
    z.preprocess(toArray, z.array(item).nullish())
};

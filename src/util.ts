export const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const isNonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Array of imps, or [] when imp is missing or malformed. */
export const imps = (req: any): any[] => (Array.isArray(req?.imp) ? req.imp : []);

/** Number of digits after the decimal point. */
export const decimals = (n: number): number => {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
};

/**
 * Accepts a plain OpenRTB bid request, or a Prebid Server test file
 * (which wraps the request in "mockBidRequest").
 */
export function unwrap(input: any): any {
  if (isObj(input) && isObj(input.mockBidRequest)) return input.mockBidRequest;
  return input;
}

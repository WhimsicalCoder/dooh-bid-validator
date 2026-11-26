import { REF } from "../refs.js";
import { RuleContext } from "../types.js";
import { imps, isNum, isObj } from "../util.js";

const sizesOf = (banner: any): Array<{ w: number; h: number }> => {
  const out: Array<{ w: number; h: number }> = [];
  if (isNum(banner.w) && isNum(banner.h)) out.push({ w: banner.w, h: banner.h });
  if (Array.isArray(banner.format)) {
    for (const f of banner.format) if (isObj(f) && isNum(f.w) && isNum(f.h)) out.push({ w: f.w, h: f.h });
  }
  return out;
};

const ratioClose = (a: { w: number; h: number }, b: { w: number; h: number }) =>
  a.h > 0 && b.h > 0 && Math.abs(a.w / a.h - b.w / b.h) / (b.w / b.h) <= 0.02;

/** What can be shown on the screen. */
export function creative({ req, add }: RuleContext): void {
  const dev = req.device;
  const screen = isNum(dev?.w) && isNum(dev?.h) && dev.w > 0 && dev.h > 0 ? { w: dev.w, h: dev.h } : undefined;

  imps(req).forEach((imp, i) => {
    if (!isObj(imp)) return;
    const p = `$.imp[${i}]`;

    if (!isObj(imp.banner) && !isObj(imp.video)) {
      const other = ["native", "audio"].filter((k) => isObj(imp[k]));
      add({ ruleId: "CRE-001", severity: other.length ? "info" : "error", path: p, ref: REF.ortbImp,
        message: other.length
          ? `Impression ${i} offers only ${other.join("/")}, which is rare for DOOH screens.`
          : `Impression ${i} has no banner or video object, so there is nothing to bid on.` });
    }

    if (isObj(imp.banner)) {
      const sizes = sizesOf(imp.banner);
      if (sizes.length === 0) {
        add({ ruleId: "CRE-002", severity: "warning", path: `${p}.banner`, ref: REF.ortbBanner,
          message: "Banner has no size (no w/h and no format). DOOH creatives are pre-approved for exact sizes." });
      } else if (screen && !sizes.some((s) => ratioClose(s, screen))) {
        add({ ruleId: "CRE-005", severity: "info", path: `${p}.banner`, ref: REF.buyer,
          message: `No banner size has the same shape as the screen (${screen.w}x${screen.h}). Fine if the slot is a zone of the screen; otherwise check the sizes.` });
      }
    }

    if (isObj(imp.video)) {
      const v = imp.video;
      if (!Array.isArray(v.mimes) || v.mimes.length === 0) {
        add({ ruleId: "CRE-003", severity: "error", path: `${p}.video.mimes`, ref: REF.ortbVideo,
          message: "video.mimes is missing (required)." });
      }
      if (!isNum(v.w) || !isNum(v.h)) {
        add({ ruleId: "CRE-004", severity: "warning", path: `${p}.video`, ref: REF.ortbVideo,
          message: "Video has no w/h. On a screen, buyers need the exact size." });
      } else if (screen && !ratioClose({ w: v.w, h: v.h }, screen)) {
        add({ ruleId: "CRE-005", severity: "info", path: `${p}.video`, ref: REF.buyer,
          message: `Video size ${v.w}x${v.h} has a different shape from the screen (${screen.w}x${screen.h}).` });
      }
      if (v.maxduration === undefined && !Array.isArray(v.rqddurs)) {
        add({ ruleId: "CRE-006", severity: "warning", path: `${p}.video.maxduration`, ref: REF.ortbVideo,
          message: "Video has no maxduration or rqddurs. DOOH spots have a fixed length, so buyers need to know it." });
      }
    }
  });
}

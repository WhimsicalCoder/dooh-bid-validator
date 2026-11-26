import { readFileSync } from "node:fs";

/** Reads one JSON document, a JSON array, or JSON Lines from a file path ("-" = stdin). */
export function load(path: string): Array<{ label: string; data: unknown }> {
  const text = readFileSync(path === "-" ? 0 : path, "utf8").trim();
  const name = path === "-" ? "stdin" : path;
  if (text === "") return [];
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data.map((d, i) => ({ label: `${name}[${i}]`, data: d }));
    return [{ label: name, data }];
  } catch {
    // Not one JSON document: treat as JSON Lines.
    return text.split(/\r?\n/).flatMap((line, i) => {
      if (line.trim() === "") return [];
      try {
        return [{ label: `${name}:${i + 1}`, data: JSON.parse(line) }];
      } catch {
        return [{ label: `${name}:${i + 1}`, data: undefined }];
      }
    });
  }
}

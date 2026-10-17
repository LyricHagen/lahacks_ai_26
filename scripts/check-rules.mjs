#!/usr/bin/env node
// Mechanical check of the non-negotiable UI/UX rules in CLAUDE.md. Run: pnpm check:rules
// Fails (exit 1) with file:line for every violation. Run it before finishing any prompt.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_DIRS = ["src", "drizzle", "docker", "scripts", "data", "fixtures"];
const SCAN_ROOT_FILES = ["CLAUDE.md", "DEBUGGING.md", "README.md"];
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".md", ".json", ".sql", ".txt", ".csv", ".yml", ".yaml"]);
const SELF = "scripts/check-rules.mjs";

const RULES = [
  { name: "em dash", re: /—/ },
  { name: "en dash", re: /–/ },
  { name: "emoji", re: /\p{Extended_Pictographic}/u, skip: /\.(css)$/ },
  { name: "icon or component package import", re: /from\s+["'](lucide-react|lucide|react-icons[^"']*|@heroicons\/[^"']*|@radix-ui\/[^"']*|@mui\/[^"']*|@chakra-ui\/[^"']*|@headlessui\/[^"']*|@phosphor-icons\/[^"']*|@tabler\/icons[^"']*|shadcn[^"']*)["']/ },
  { name: "rounded corners", re: /(?<![\w-])rounded(?!-none)(-[a-z0-9[\]]+)*(?![\w-])/, only: /\.(tsx|ts)$/ },
  { name: "shadow utility", re: /(?<![\w-])(drop-)?shadow(-[a-z0-9[\]/]+)?(?![\w-])/, only: /\.(tsx)$/ },
  { name: "gradient", re: /(bg-gradient|linear-gradient|radial-gradient|conic-gradient|from-\w+-\d{2,3}\s+to-)/ },
  { name: "blur or glass", re: /(?<![\w-])(backdrop-blur|blur)(-[a-z0-9]+)?(?![\w-])/, only: /\.(tsx|css)$/ },
  { name: "hover motion", re: /hover:(scale|translate|rotate|-translate|skew)/ },
  { name: "animation utility", re: /(?<![\w-])animate-(spin|ping|pulse|bounce)/ },
  { name: "forbidden font", re: /\b(Inter|Geist|Space[_ ]Grotesk)\b(?!\w)/, only: /\.(tsx|ts|css)$/ },
];

// Lines that intentionally mention a forbidden thing (comments documenting the rule) can opt out.
const ALLOW_MARKER = "rules-allow";

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name))) out.push(p);
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
for (const f of SCAN_ROOT_FILES) {
  try {
    statSync(join(ROOT, f));
    files.push(join(ROOT, f));
  } catch {
    // optional file
  }
}

const problems = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel === SELF) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(rel)) continue;
      if (rule.skip && rule.skip.test(rel)) continue;
      // Rules about Tailwind classes only apply to markdown when they are in code, so skip .md.
      if (rel.endsWith(".md") && !["em dash", "en dash", "emoji"].includes(rule.name)) continue;
      // Class and font rules ignore comment lines, so docs can name what is banned.
      const isComment = /^\s*(\/\/|\/\*|\*)/.test(line);
      if (isComment && !["em dash", "en dash", "emoji"].includes(rule.name)) continue;
      const m = rule.re.exec(line);
      if (m) problems.push(`${rel}:${i + 1}  ${rule.name}: "${m[0]}"  ${line.trim().slice(0, 100)}`);
    }
  });
}

if (problems.length) {
  console.error(`check-rules: ${problems.length} violation(s)\n`);
  for (const p of problems) console.error("  " + p);
  console.error("\nSee CLAUDE.md UI/UX RULES. Add the comment marker rules-allow to a line only if it documents a rule.");
  process.exit(1);
}
console.log(`check-rules: ok (${files.length} files scanned)`);

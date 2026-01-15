import { readFile, writeFile } from "node:fs/promises";
import { chmod } from "node:fs/promises";
import path from "node:path";

const target = path.resolve("dist/index.js");
const shebang = "#!/usr/bin/env node\n";

const content = await readFile(target, "utf8");
if (!content.startsWith(shebang)) {
  const updated = `${shebang}${content}`;
  await writeFile(target, updated, "utf8");
  await chmod(target, 0o755);
}

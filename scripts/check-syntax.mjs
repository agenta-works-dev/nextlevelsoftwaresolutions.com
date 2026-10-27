import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? walk(`${dir}/${entry.name}`)
          : /\.(m?js)$/.test(entry.name)
            ? [`${dir}/${entry.name}`]
            : [],
      ),
    )
  ).flat();
}
for (const file of [...(await walk("scripts")), ...(await walk("server"))]) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}
console.log("Application and server syntax checked.");

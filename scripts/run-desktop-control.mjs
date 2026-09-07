import { spawnSync } from "node:child_process";
import { buildPlvsCli } from "./build-plvs-cli.mjs";

let executable;
try {
  executable = buildPlvsCli({ identity: "development" }).executable;
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const child = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
if (child.error) {
  console.error(`Unable to launch the PLVS development CLI: ${child.error.message}`);
  process.exit(2);
}
process.exit(child.status ?? 2);

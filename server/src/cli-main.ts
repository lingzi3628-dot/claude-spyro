/** Entry point for the headless CLI. */
import { runCli } from "./cli.js";

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`error: ${err?.message || String(err)}\n`);
    process.exit(1);
  });

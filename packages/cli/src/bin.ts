#!/usr/bin/env node
import {runCli} from "./index.js";
void runCli(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  process.stderr.write("ZAACI_UNEXPECTED: " + String(error) + "\n");
  process.exitCode = 1;
});

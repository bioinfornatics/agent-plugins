#!/usr/bin/env node
/** Public evaluation entrypoint: objectives share mandatory discovery isolation. */
import { main } from "./evaluation_protocol.js";
export { main };
if (!import.meta.url.includes("/$bunfs/") && import.meta.url === "file://" + process.argv[1]) {
  main().then(code => { process.exitCode = code; });
}

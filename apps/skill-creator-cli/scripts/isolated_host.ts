/** Host execution context: inherit normal configuration/authentication, isolate only cwd/process lifetime.
 * Historical filename retained for the contained runtime source mapping; no discovery or OS isolation.
 */
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

export const HOST_ENVIRONMENT_POLICY = "inherit-operator-environment-v1";

/** Take a snapshot for each child. Never rewrite HOME/XDG/keyring or inspect/copy stored credentials. */
export function hostEnvironment():NodeJS.ProcessEnv { return {...process.env}; }

/** A grader/version probe gets a private cwd, not a private HOME or authentication store. */
export function temporaryHost(){
 const cwd=mkdtempSync(join(tmpdir(),"skill-grader-"));
 return {cwd,env:hostEnvironment(),cleanup:()=>rmSync(cwd,{recursive:true,force:true})};
}

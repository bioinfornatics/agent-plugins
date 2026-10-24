/** Discovery/config isolation only, not an OS sandbox. No ambient profiles or secret files are copied. */
import { mkdirSync,mkdtempSync,rmSync,existsSync,lstatSync } from "node:fs";
import { join,dirname,resolve } from "node:path";
import { tmpdir,homedir } from "node:os";
import yaml from "js-yaml";
import {readTrustedSnapshot} from "./trusted_snapshot.js";
const selector=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&!/[\x00-\x1f\x7f]/.test(value);
export function isolatedHostEnvironment(root:string):NodeJS.ProcessEnv {
 const home=join(resolve(root),".host");mkdirSync(home,{recursive:true,mode:0o700});if(lstatSync(home).isSymbolicLink()||!lstatSync(home).isDirectory())throw new TypeError("Isolated host state must be a regular directory");
 const env:NodeJS.ProcessEnv={...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:join(home,"config"),XDG_DATA_HOME:join(home,"data"),XDG_STATE_HOME:join(home,"state"),GOOSE_PATH_ROOT:home};
 // Config docs: active_provider/providers.<id>.model; legacy flat selectors remain readable.
 // Transport credentials/endpoints must be supplied by environment; file/keyring-only transport is unproven.
 const config=process.env.GOOSE_PATH_ROOT?join(process.env.GOOSE_PATH_ROOT,"config","config.yaml"):process.platform==="win32"&&process.env.APPDATA?join(process.env.APPDATA,"Block","goose","config","config.yaml"):join(process.env.XDG_CONFIG_HOME??join(homedir(),".config"),"goose","config.yaml");
 if(existsSync(config)){const snapshot=readTrustedSnapshot(dirname(config),config,"host selector config",{maxBytes:256*1024,allowEmpty:true});const value=yaml.load(snapshot.bytes.toString("utf8"),{schema:yaml.JSON_SCHEMA}) as any;
  const configuredProvider=selector(value?.active_provider)?value.active_provider:selector(value?.GOOSE_PROVIDER)?value.GOOSE_PROVIDER:undefined;
  if(!env.GOOSE_PROVIDER&&configuredProvider)env.GOOSE_PROVIDER=configuredProvider;
  if(!env.GOOSE_MODEL){const model=value?.providers&&Object.hasOwn(value.providers,env.GOOSE_PROVIDER??"")?value.providers[env.GOOSE_PROVIDER!]?.model:undefined;
   if(selector(model))env.GOOSE_MODEL=model;else if(env.GOOSE_PROVIDER===configuredProvider&&selector(value?.GOOSE_MODEL))env.GOOSE_MODEL=value.GOOSE_MODEL;
  }
 }return env;
}
export function temporaryHost(){const cwd=mkdtempSync(join(tmpdir(),"skill-grader-"));try{return {cwd,env:isolatedHostEnvironment(cwd),cleanup:()=>rmSync(cwd,{recursive:true,force:true})};}catch(error){rmSync(cwd,{recursive:true,force:true});throw error;}}

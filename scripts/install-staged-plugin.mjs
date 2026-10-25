#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandOutput } from "./command-output.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(path.join(root,"bun-release.json"),"utf8"));
const args=process.argv.slice(2), has=(name)=>args.includes(name);
let cli;
try { cli=commandOutput(args,root); } catch(error) { console.error("Failed: "+error.message); process.exit(1); }
function fail(message){cli.fail(message);}
function option(name){const inline=args.find(arg=>arg.startsWith(name+"="));if(inline)return inline.slice(name.length+1);const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith("--"))fail(name+" requires a path");return args[i+1];}
function usage(){console.log("Usage: node scripts/install-staged-plugin.mjs [options]\n\nInstall a validated current-platform runtime staging tree.\n\nOptions:\n  --source <path>       Staging tree (default: release-staging/<current-target>)\n  --destination <path>  Install directory (default: .agents/plugins/agent-plugins)\n  --dry-run             Validate and describe without writing\n  --force               Replace an existing plain destination; symlinks are always refused\n  --format json|human   Output format (default: json)\n  --progress <mode>     auto, none, or creators\n  --verbose             Stream detailed diagnostics\n  --log-file <path>     Append detailed diagnostics to a safe plain file\n  --help                Show this help");}
if(has("--help")||has("-h")){usage();process.exit(0);}
const known=new Set(["--source","--destination","--dry-run","--force","--format","--progress","--verbose","--log","--log-file","--help","-h"]);for(let i=0;i<args.length;i++){const key=args[i].split("=")[0];if(!known.has(key))fail("unknown option: "+args[i]);if((key==="--source"||key==="--destination"||key==="--format"||key==="--progress"||key==="--log"||key==="--log-file")&&!args[i].includes("="))i++;}
const releaseKey=process.platform+"-"+process.arch,target=config.targets[releaseKey];if(!target)fail("no pinned release target for "+releaseKey);
const source=path.resolve(option("--source")||path.join(root,config.stagingRoot,releaseKey));
const destination=path.resolve(option("--destination")||path.join(root,".agents","plugins","agent-plugins"));
const force=has("--force"),dryRun=has("--dry-run");
try { cli.prepareLog([{path:source,label:"source"},{path:destination,label:"destination"}]); } catch(error) { console.error("Failed: "+error.message); process.exit(1); }
function stat(file){try{return lstatSync(file);}catch(error){if(error?.code==="ENOENT")return undefined;throw error;}}
function assertNoSymlinkSegments(targetPath,label){const parsed=path.parse(targetPath);let current=parsed.root;for(const part of targetPath.slice(parsed.root.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const s=stat(current);if(s?.isSymbolicLink())fail(label+" contains a symbolic link: "+current);}}
function walk(directory,base=directory){const files=[];for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"))){const absolute=path.join(directory,entry.name),relative=path.relative(base,absolute).split(path.sep).join("/"),s=lstatSync(absolute);if(s.isSymbolicLink())fail("staging contains a symbolic link: "+relative);if(s.isDirectory())files.push(...walk(absolute,base));else if(s.isFile())files.push({path:relative,mode:(s.mode&0o777).toString(8).padStart(3,"0"),size:s.size,sha256:createHash("sha256").update(readFileSync(absolute)).digest("hex")});else fail("staging contains an unsupported entry: "+relative);}return files;}
cli.detail(`Validate staging: ${cli.relative(source)}\n`);
const sourceStat=stat(source);if(!sourceStat?.isDirectory()||sourceStat.isSymbolicLink())fail("source must be a plain staging directory: "+source);assertNoSymlinkSegments(source,"source path");
const manifestPath=path.join(source,"release-manifest.json"),manifestStat=stat(manifestPath);if(!manifestStat?.isFile()||manifestStat.isSymbolicLink())fail("source has no plain release-manifest.json");
let manifest;try{manifest=JSON.parse(readFileSync(manifestPath,"utf8"));}catch{fail("release manifest is not valid JSON");}
if(manifest.schemaVersion!==1||manifest.releaseKey!==releaseKey||manifest.bunTarget!==target||manifest.bunVersion!==config.bunVersion)fail("staging is not validated for current target "+releaseKey);
if(manifest.runtimeMode!=="native-bun")fail("staging runtime mode must be native-bun");const actual=walk(source).filter(entry=>entry.path!=="release-manifest.json");if(JSON.stringify(actual)!==JSON.stringify(manifest.files))fail("staging failed path, mode, size, or checksum validation");if(!actual.some(entry=>entry.path==="plugin.json"))fail("staging does not contain plugin.json");
if(destination===path.parse(destination).root||destination===root||destination===source||source.startsWith(destination+path.sep)||destination.startsWith(source+path.sep))fail("unsafe destination: "+destination);assertNoSymlinkSegments(destination,"destination path");
const destinationStat=stat(destination);if(destinationStat&&!force)fail("destination already exists; pass --force to replace it: "+destination);
cli.detail(`${dryRun?"Plan":"Copy"} destination: ${cli.relative(destination)}\n`);
const result={status:dryRun?"dry-run":"installed",source,destination,releaseKey,files:actual.length+1,replacing:Boolean(destinationStat)};if(dryRun){cli.write(JSON.stringify(result));cli.emit({...result,human:`Would install: ${cli.relative(destination)}`});process.exit(0);}if(destinationStat)rmSync(destination,{recursive:true,force:true});mkdirSync(path.dirname(destination),{recursive:true});cpSync(source,destination,{recursive:true,errorOnExist:true,force:false,dereference:false});cli.write(JSON.stringify(result));cli.emit({...result,human:`Installed: ${cli.relative(destination)}`});

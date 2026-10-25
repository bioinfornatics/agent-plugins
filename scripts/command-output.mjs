import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";

export function commandOutput(args, root) {
  const value = (name) => { const inline=args.find((arg)=>arg.startsWith(name+"=")); if(inline)return inline.slice(name.length+1); const index=args.indexOf(name); return index<0?undefined:args[index+1]; };
  for(const name of ["--format","--progress","--log","--log-file"]){const index=args.indexOf(name);if(index>=0&&(!args[index+1]||args[index+1].startsWith("--")))throw new Error(name+" requires a value");}
  const format=value("--format")||"json",verbose=args.includes("--verbose"),rawLog=value("--log-file")||value("--log");
  const progress=value("--progress")||(format==="human"?"auto":"none");
  if(!["json","human"].includes(format))throw new Error("--format must be json or human");
  if(!["auto","none","creators"].includes(progress))throw new Error("--progress must be auto, none, or creators");
  const log=rawLog?path.resolve(rawLog):undefined;
  let logReady=false;
  const stat=(file)=>{try{return lstatSync(file);}catch(error){if(error?.code==="ENOENT")return undefined;throw error;}};
  const currentUid=typeof process.getuid==="function"?process.getuid():undefined;
  const assertOwned=(entry,label)=>{if(currentUid!==undefined&&entry.uid!==currentUid)throw new Error(label+" must be owned by the current user");};
  const inside=(file,boundary)=>file===boundary||file.startsWith(boundary+path.sep);
  function prepareLog(boundaries=[]){
    if(!log||logReady)return;
    for(const item of boundaries){const boundary=path.resolve(item.path||item);if(inside(log,boundary))throw new Error("log must be outside "+(item.label||"operation boundary")+": "+boundary);}
    const parsed=path.parse(log);let current=parsed.root;
    for(const part of path.dirname(log).slice(parsed.root.length).split(path.sep).filter(Boolean)){
      current=path.join(current,part);let entry=stat(current);
      if(entry?.isSymbolicLink())throw new Error("log path contains a symbolic link: "+current);
      if(entry&&!entry.isDirectory())throw new Error("log parent is not a directory: "+current);
      if(!entry){mkdirSync(current,{mode:0o700});entry=stat(current);}
      if(!entry?.isDirectory())throw new Error("log parent is not a directory: "+current);
    }
    const parent=stat(path.dirname(log));
    if(!parent?.isDirectory())throw new Error("log parent is not a directory: "+path.dirname(log));
    assertOwned(parent,"log parent");
    if((parent.mode&0o022)!==0)throw new Error("log parent must not be writable by group or others: "+path.dirname(log));
    const existing=stat(log);
    if(existing?.isSymbolicLink())throw new Error("log path contains a symbolic link: "+log);
    if(existing&&(!existing.isFile()||existing.nlink!==1))throw new Error("log must be a plain, unlinked file: "+log);
    if(existing)assertOwned(existing,"log file");
    const descriptor=openSync(log,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|(constants.O_NOFOLLOW||0),0o600);
    try{const opened=fstatSync(descriptor);if(!opened.isFile()||opened.nlink!==1)throw new Error("log must be a plain, unlinked file: "+log);assertOwned(opened,"log file");fchmodSync(descriptor,0o600);}finally{closeSync(descriptor);}
    logReady=true;
  }
  const write=(text)=>{if(!log)return;if(!logReady)throw new Error("log path was not validated against operation boundaries");const descriptor=openSync(log,constants.O_WRONLY|constants.O_APPEND|(constants.O_NOFOLLOW||0));try{const opened=fstatSync(descriptor);if(!opened.isFile()||opened.nlink!==1)throw new Error("log must be a plain, unlinked file: "+log);assertOwned(opened,"log file");fchmodSync(descriptor,0o600);writeSync(descriptor,text.endsWith("\n")?text:text+"\n");}finally{closeSync(descriptor);}};
  const detail=(text,stream="stdout")=>{write(text);if(verbose)(stream==="stderr"?process.stderr:process.stdout).write(text);};
  const relative=(file)=>path.relative(root,file).split(path.sep).join("/")||".";
  const emit=(result)=>{const {human,...machine}=result;console.log(format==="json"?JSON.stringify(machine):human);};
  const fail=(message,code=1)=>{if(logReady)write("ERROR: "+message);console.error("Failed: "+message+(logReady?" (details: "+relative(log)+")":""));process.exit(code);};
  return {format,progress,verbose,log,value,prepareLog,write,detail,relative,emit,fail};
}

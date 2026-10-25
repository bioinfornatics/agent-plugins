import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
function stat(path: string) { try { return lstatSync(path); } catch { return null; } }
export function safePluginPath(pluginRoot: string, relativePath: string, label: string): string {
 let root: string; try { root=realpathSync(resolve(pluginRoot)); } catch(error) { throw new Error(label+": plugin root is inaccessible: "+(error as Error).message); }
 if(isAbsolute(relativePath)) throw new Error(label+": path must be plugin-relative: "+relativePath);
 const target=resolve(root,relativePath), rel=relative(root,target);
 if(rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel)) throw new Error(label+": path escapes plugin root: "+relativePath);
 let cursor=root; for(const part of rel.split(sep).filter(Boolean)){cursor=resolve(cursor,part);const value=stat(cursor);if(!value)break;if(value.isSymbolicLink())throw new Error(label+": symlink targets are not allowed: "+relativePath);} return target;
}
export function regularFile(root:string,rel:string,label:string):{path:string;exists:boolean}{const path=safePluginPath(root,rel,label),value=stat(path);if(value&&!value.isFile())throw new Error(label+": target must be a regular file: "+rel);return {path,exists:!!value};}
export function directoryOrMissing(root:string,rel:string,label:string):{path:string;exists:boolean}{const path=safePluginPath(root,rel,label),value=stat(path);if(value&&!value.isDirectory())throw new Error(label+": target must be a directory: "+rel);return {path,exists:!!value};}

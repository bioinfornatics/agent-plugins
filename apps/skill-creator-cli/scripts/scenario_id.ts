import { isAbsolute, relative, resolve, sep } from "node:path";
/** Portable scenario identifiers are safe as one path segment on POSIX and Windows. */
export const MAX_SCENARIO_ID_BYTES = 128;
const PORTABLE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function scenarioDirectory(root:string,value:unknown):string{const id=assertPortableScenarioId(value),base=resolve(root),target=resolve(base,"eval-"+id),rel=relative(base,target);if(!rel||isAbsolute(rel)||rel.split(sep).some(part=>part===".."))throw new TypeError("scenario path must remain contained");return target;}
export function assertPortableScenarioId(value:unknown,label="scenario id"):string {
 if((typeof value!=="string"&&typeof value!=="number")||typeof value==="number"&&!Number.isSafeInteger(value))throw new TypeError(label+" must be a string or safe integer");
 const id=String(value);
 if(!id||Buffer.byteLength(id,"utf8")>MAX_SCENARIO_ID_BYTES||!PORTABLE_ID.test(id)||id==="."||id===".."||WINDOWS_RESERVED.test(id))throw new TypeError(label+" must be a portable 1-128 byte identifier using ASCII letters, digits, dot, underscore, or hyphen");
 return id;
}

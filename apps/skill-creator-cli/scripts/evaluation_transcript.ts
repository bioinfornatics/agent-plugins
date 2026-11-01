/** Read-only, bounded projection of hash-bound visible session evidence. Never reads raw logs. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
export interface VisibleTranscript {
 status: 'available' | 'unavailable'; reason?: string;
 messages: Array<{role: 'user' | 'assistant'; text: string}>;
 omitted: Record<string, number>; truncated: boolean;
 path?: string; sha256?: string;
}
export interface TranscriptBudget { remaining: number; readRemaining: number }
export const transcriptBudget = (): TranscriptBudget => ({remaining: 512 * 1024, readRemaining: 16 * 1024 * 1024});
const fileLimit = 2 * 1024 * 1024, sideLimit = 128 * 1024;
const omissionKeys = new Set(['hidden_message','toolRequest','toolResponse','thinking','redactedThinking','image','document','systemNotification','error','actionRequired','toolConfirmationRequest','other_content']);
/** Linux descriptor anchoring rejects ancestor/final symlinks, special files and hardlinks.
 * The hash binds local bytes to the untrusted report, not to receipt authenticity. */
export function readVisibleTranscript(root: unknown, run: any, budget = transcriptBudget()): VisibleTranscript {
 const binding = run?.session_log;
 const unavailable = (reason: string): VisibleTranscript => ({status:'unavailable',reason,messages:[],omitted:{},truncated:false});
 if (!binding || binding.status !== 'retained') return unavailable('Visible conversation unavailable: session capture missing or unavailable.');
 if (process.platform !== 'linux') return unavailable('Visible conversation unavailable: safe local reader requires Linux.');
 const safeRelative = (v: unknown): v is string => typeof v === 'string' && !!v && !path.isAbsolute(v) && !v.includes('\\') && !v.includes('\0') && v.split('/').every(p=>p!=='.'&&p!=='..'&&!!p);
 if (typeof root !== 'string' || !root || root.includes('\0') || root.split(/[\/\\]/).includes('..') || !safeRelative(run.directory) || !safeRelative(binding.path) || binding.path !== 'session-log.json' || !/^[a-f0-9]{64}$/.test(binding.sha256) || !Number.isSafeInteger(binding.bytes) || binding.bytes < 0)
  return unavailable('Visible conversation unavailable: invalid path/hash binding.');
 if(binding.bytes>fileLimit) return unavailable('Visible conversation unavailable: transcript exceeds file size limit (2 MiB); archive unchanged.');
 if(binding.bytes>budget.readRemaining) return unavailable('Visible conversation unavailable: report read limit reached; archive unchanged.');
 budget.readRemaining -= binding.bytes;
 let parent: number | undefined, fd: number | undefined;
 try {
  const filename=path.join(path.resolve(root),run.directory,binding.path), parts=filename.split('/').filter(Boolean), leaf=parts.pop()!;
  parent=fs.openSync('/',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  for(const part of parts){const next=fs.openSync('/proc/self/fd/'+parent+'/'+part,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);fs.closeSync(parent);parent=next;}
  fd=fs.openSync('/proc/self/fd/'+parent+'/'+leaf,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const before=fs.fstatSync(fd);
  if(!before.isFile()||before.nlink!==1||before.size!==binding.bytes)throw Error('binding');
  const bytes=Buffer.alloc(binding.bytes+1);let count=0;
  while(count<bytes.length){const n=fs.readSync(fd,bytes,count,bytes.length-count,null);if(!n)break;count+=n;}
  const after=fs.fstatSync(fd);
  if(count!==binding.bytes||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||createHash('sha256').update(bytes.subarray(0,count)).digest('hex')!==binding.sha256)throw Error('binding');
  const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)));
  if(source.protocol!=='goose-session-log-v1'||typeof binding.session_name!=='string'||source.session_name!==binding.session_name||source.redacted!==false||!Array.isArray(source.messages)||source.messages.length>4096)throw Error('projection');
  const out: VisibleTranscript={status:'available',messages:[],omitted:{},truncated:source.completeness!=='complete-visible-text',path:run.directory+'/'+binding.path,sha256:binding.sha256};
  for(const [key,n] of Object.entries(source.omitted??{}))if(omissionKeys.has(key)&&Number.isSafeInteger(n)&&Number(n)>0)out.omitted[key]=Number(n);
  let remaining=Math.min(sideLimit,budget.remaining);
  for(const message of source.messages){
   if(!message||!['user','assistant'].includes(message.role)||message.metadata?.userVisible===false||(message.annotations?.audience!==undefined&&(!Array.isArray(message.annotations.audience)||!message.annotations.audience.includes('user')))){out.omitted.hidden_message=(out.omitted.hidden_message??0)+1;continue;}
   if(!Array.isArray(message.text)||message.text.length>4096||message.text.some((s:unknown)=>typeof s!=='string'))throw Error('projection');
   const full=message.text.join('\n\n'), value=full.slice(0,remaining);
   if(value.length)out.messages.push({role:message.role,text:value});
   if(value.length<full.length)out.truncated=true;
   remaining-=value.length;budget.remaining-=value.length;
  }
  return out;
 } catch {return unavailable('Visible conversation unavailable: missing, unsafe, changed, hash-mismatched or unsupported transcript.');}
 finally {if(fd!==undefined)fs.closeSync(fd);if(parent!==undefined)fs.closeSync(parent);}
}

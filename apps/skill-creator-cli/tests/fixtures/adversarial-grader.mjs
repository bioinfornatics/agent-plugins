import {readFileSync} from "node:fs";
const mode=process.argv[2];readFileSync(0,"utf8");const value={verdict:"pass",evidence_quote:"valid result",rationale:"matches"};const emit=v=>console.log(JSON.stringify(v));
if(mode==="ignore-term"){process.on("SIGTERM",()=>{});setInterval(()=>{},1000);}
else if(mode==="error-complete"){emit({type:"error",error:"private provider error"});emit({type:"complete",output:JSON.stringify(value)});}
else if(mode==="partial")emit({type:"message",message:{content:[{type:"text",text:JSON.stringify(value)}]}});
else if(mode==="failed-terminal")emit({type:"complete",status:"failed",output:JSON.stringify(value)});
else emit({type:"complete",output:JSON.stringify(value)});

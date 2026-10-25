import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
if (process.argv.includes("--version")) { console.log("adversarial-host 1"); process.exit(0); }
const mode = process.argv[2];
readFileSync(0, "utf8");
const event = value => console.log(JSON.stringify(value));
if (mode === "partial") event({type:"message",message:{role:"assistant",content:[{type:"text",text:"I will start now"}]}});
else if (mode === "error-complete") {event({type:"error",error:"HTTP 404 model unavailable secret"});event({type:"complete",output:"failed but exit zero"});}
else if (mode === "failed-terminal") event({type:"complete",status:"failed",output:"not a result"});
else if (mode === "clean-timeout") {process.on("SIGTERM",()=>{event({type:"complete",output:"late result"});process.exit(0);});setInterval(()=>{},1000);}
else if (mode === "ignore-term") {process.on("SIGTERM",()=>{});event({type:"progress"});setInterval(()=>{},1000);}
else if (mode === "descendant") {spawn(process.execPath,["-e",'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:["ignore","inherit","inherit"]});event({type:"progress"});setInterval(()=>{},1000);}
else event({type:"complete",output:"valid result"});

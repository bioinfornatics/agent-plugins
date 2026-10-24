#!/usr/bin/env node
const args=process.argv.slice(2),mode=args.includes("--mode")?args[args.indexOf("--mode")+1]:"complete";
if(args.includes("--version")){if(mode==="slow-version")await new Promise(resolve=>setTimeout(resolve,300));console.log("telemetry-goose 1.0");process.exit(0);}
for await(const _ of process.stdin){}
const call=(name,args)=>({type:"message",message:{content:[{type:"toolRequest",toolCall:{value:{name,arguments:args}}}]}});
if(mode==="complete"){
 console.log(JSON.stringify(call("skills__load_skill",{name:"demo/references/provider.md"})));
 console.log(JSON.stringify(call("developer__read_file",{path:"input.json"})));
 console.log(JSON.stringify({type:"complete",output:"telemetry complete",usage:{input_tokens:11,output_tokens:7,reasoning_tokens:3,cache_read_tokens:5,cache_write_tokens:2,total_tokens:28,turns:4,cost_usd:0.012,currency:"usd"}}));
}else if(mode==="partial")console.log(JSON.stringify({type:"complete",output:"telemetry partial",usage:{input_tokens:2,total_tokens:2}}));
else if(mode==="hostile")console.log(JSON.stringify({type:"complete",output:"telemetry hostile",usage:{input_tokens:-1,output_tokens:"Infinity",reasoning_tokens:1.5,total_tokens:-4,turns:-2,cost:-1,currency:"USD"}}));
else if(mode==="slow-version"){console.log(JSON.stringify({type:"message",message:{content:[{type:"text",text:"reasoning must not count"}]}}));await new Promise(resolve=>setTimeout(resolve,30));console.log(JSON.stringify({type:"complete",output:"task result"}));}
else if(mode==="spoof-output")console.log(JSON.stringify({type:"complete",output:JSON.stringify({output:"safe task result",usage:{input_tokens:999,total_tokens:999,cost_usd:88}})}));
else if(mode==="unknown-type"){console.log(JSON.stringify({type:"PRIVATE_PROVIDER_TYPE_SECRET_2bf1",message:{content:[{type:"text",text:"ignored"}]}}));console.log(JSON.stringify({type:"complete",output:"safe unknown type"}));}
else if(mode==="malicious-labels"){console.log(JSON.stringify(call("sk-private-tool-secret-6cc8",{path:"safe.txt"})));console.log(JSON.stringify({type:"PRIVATE_EVENT_TYPE_SECRET_40ad",message:{content:[{type:"text",text:"ignored"}]}}));console.log(JSON.stringify({type:"complete",output:"safe labels"}));}
else if(mode==="private-projection"){console.log(JSON.stringify({type:"message",message:{content:[{type:"thinking",text:"PRIVATE_REASONING_DO_NOT_PERSIST"}]} }));console.log(JSON.stringify(call("developer__read_file",{path:"https://user:secret@example.test/private?token=abc#fragment",api_key:"sk-private-tool-argument"})));console.log(JSON.stringify({type:"complete",output:"safe task result"}));}
else if(mode==="malformed-then-complete"){console.log("{malformed private token=secret");console.log(JSON.stringify({type:"complete",output:"safe after malformed",usage:{input_tokens:1,output_tokens:1,reasoning_tokens:0,cache_read_tokens:0,cache_write_tokens:0,total_tokens:2}}));}
else if(mode==="fail"){console.log(JSON.stringify(call("developer__read_file",{path:"input.json"})));process.stderr.write("provider failed\n");process.exitCode=7;}
else if(mode==="malformed-fail"){console.log("{bad json");process.stderr.write("provider failed malformed\n");process.exitCode=8;}
else console.log(JSON.stringify({type:"complete",output:"telemetry unavailable"}));

#!/usr/bin/env node
const args=process.argv.slice(2),query=args[args.indexOf("--text")+1]||"";
if(query==="hang")setInterval(()=>process.stdout.write(JSON.stringify({type:"progress"})+"\n"),10);
else if(query==="failure"){console.error("host failed SECRET_SHOULD_NOT_LEAK");process.exit(9)}
else if(query==="malformed"){console.log('{"secret":"SECRET_SHOULD_NOT_LEAK"');}
else if(query==="unsupported"){console.log(JSON.stringify({type:"progress",detail:"SECRET_SHOULD_NOT_LEAK"}));}
else if(query==="trigger"){console.log(JSON.stringify({type:"message",actual_turns:2,usage:{input_tokens:11,output_tokens:4,cost_usd:0.02},message:{content:[{type:"toolRequest",toolCall:{value:{name:"load_skill",arguments:{name:"example-skill"}}}}]}}));}
else if(query==="hostile-usage"){console.log(JSON.stringify({type:"message",usage:{inputTokens:5,totalTokens:9,secret_token:8675309001,api_token:4242424002,unknown_tokens:313373003,cost:999999004},message:{content:[{type:"toolRequest",toolCall:{value:{name:"load_skill",arguments:{name:"example-skill"}}}}]}}));}
else if(query==="multi-message-no-turn"){console.log(JSON.stringify({type:"message",message:{content:[]}}));console.log(JSON.stringify({type:"message",message:{content:[]}}));console.log(JSON.stringify({type:"complete",usage:{total_tokens:7},output:"done"}));}
else console.log(JSON.stringify({type:"complete",usage:{total_tokens:7},output:"done"}));

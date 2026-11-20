import fs from 'node:fs'; import readline from 'node:readline';
fs.writeFileSync(process.argv[2], 'started\n');
const rl=readline.createInterface({input:process.stdin});
rl.on('line',l=>{let m;try{m=JSON.parse(l)}catch{return}; if(m.id===undefined)return;
 const r = m.method==='initialize'?{protocolVersion:m.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'stub',version:'0'}}
   : m.method==='tools/list'?{tools:[]}: null;
 process.stdout.write(JSON.stringify(r?{jsonrpc:'2.0',id:m.id,result:r}:{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'nf'}})+'\n');});

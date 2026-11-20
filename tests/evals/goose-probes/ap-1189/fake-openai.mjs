import http from 'node:http'; import fs from 'node:fs';
const log = process.argv[3];
const srv = http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  fs.appendFileSync(log, JSON.stringify({url:req.url, body:b?JSON.parse(b):null})+'\n');
  if(!req.url.includes('chat/completions')){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({data:[{id:'fake-model',object:'model'}]}));}
  const body=JSON.parse(b); const hasTool=body.messages.some(m=>m.role==='tool');
  const tools=(body.tools||[]).map(t=>t.function.name);
  const shell=tools.find(n=>n==='shell')||tools.find(n=>/shell$/.test(n));
  const msg = (!hasTool && shell) ? {role:'assistant',content:null,tool_calls:[{id:'call_probe1',type:'function',function:{name:shell,arguments:JSON.stringify({command:'echo PROBE_SHOULD_NOT_RUN > /tmp/ap1189-probe/out/shell-ran'})}}]} : {role:'assistant',content:'probe done'};
  const finish = msg.tool_calls?'tool_calls':'stop';
  if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});
    const delta = msg.tool_calls?{role:'assistant',tool_calls:[{index:0,...msg.tool_calls[0]}]}:{role:'assistant',content:msg.content};
    res.write('data: '+JSON.stringify({id:'x',object:'chat.completion.chunk',created:1,model:'fake-model',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
    res.write('data: '+JSON.stringify({id:'x',object:'chat.completion.chunk',created:1,model:'fake-model',choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');
    res.end('data: [DONE]\n\n');}
  else {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'x',object:'chat.completion',created:1,model:'fake-model',choices:[{index:0,message:msg,finish_reason:finish}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));}
});}); srv.listen(+process.argv[2],'127.0.0.1');

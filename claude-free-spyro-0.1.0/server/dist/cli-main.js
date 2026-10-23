// Spyro Studio - closed source. Licensed to Spyro Technologies. Unauthorised use or redistribution is prohibited.
import{spawn as O}from"node:child_process";import{existsSync as j}from"node:fs";import{dirname as q,join as E,resolve as b}from"node:path";import{fileURLToPath as N}from"node:url";import C from"node:http";import{WebSocket as S}from"ws";var M=`Spyro Studio \u2014 headless agent

Usage:
  claude-free -p "your prompt"            run one task and print the result
  claude-free -p "..." --json             emit JSON events (one per line)

Options:
  -p, --print <prompt>      Prompt to run (required)
      --json                JSON output instead of plain text
      --model <id>          Override the model
      --provider <id>       Override the provider
      --cwd <path>          Run inside this directory
      --system <text>       Extra system prompt
      --output-style <name> Apply a stored output style
      --allowed-tools <a,b> Auto-approve these tools
      --disallowed-tools <a,b>
                            Never run these tools
      --permission-mode <m> default | acceptEdits | plan | bypass
      --max-turns <n>       Stop after n tool-use rounds (default 25)
      --timeout <s>         Give up if nothing happens for n seconds (default 1800)
      --effort <level>      How hard to think: auto | low | medium | high
      --resume <id>         Continue an existing session
      --port <n>            Connect to a specific server port
  -q, --quiet               Suppress progress lines
  -h, --help                This help
  -v, --version             Print the version

Examples:
  claude-free -p "summarise README.md"
  claude-free -p "run the tests and fix failures" --max-turns 40
  claude-free -p "review the diff" --permission-mode bypass --json > out.jsonl`;function P(t){let e={json:!1,maxTurns:25,help:!1,version:!1,quiet:!1,timeoutSec:1800},r=o=>(o||"").split(",").map(i=>i.trim()).filter(Boolean);for(let o=0;o<t.length;o++){let i=t[o],n=()=>t[++o];switch(i){case"-p":case"--print":e.prompt=n();break;case"--json":e.json=!0;break;case"--model":e.model=n();break;case"--provider":e.provider=n();break;case"--cwd":e.cwd=n();break;case"--system":e.system=n();break;case"--output-style":e.outputStyle=n();break;case"--allowed-tools":e.allowedTools=r(n());break;case"--disallowed-tools":e.disallowedTools=r(n());break;case"--permission-mode":e.permissionMode=n();break;case"--max-turns":e.maxTurns=Number(n())||e.maxTurns;break;case"--timeout":e.timeoutSec=Number(n())||e.timeoutSec;break;case"--effort":e.effort=n();break;case"--resume":e.resume=n();break;case"--port":e.port=Number(n());break;case"-q":case"--quiet":e.quiet=!0;break;case"-h":case"--help":e.help=!0;break;case"-v":case"--version":e.version=!0;break;default:!i.startsWith("-")&&e.prompt===void 0&&(e.prompt=i);break}}return e}function w(t,e=1200){return new Promise(r=>{let o=C.get(t,i=>{i.resume(),r((i.statusCode??0)>=200&&(i.statusCode??0)<500)});o.setTimeout(e,()=>{o.destroy(),r(!1)}),o.on("error",()=>r(!1))})}async function $(t,e=40){for(let r=t;r<t+e;r++)if(!await w(`http://127.0.0.1:${r}/api/state`,500))return r;return t}function J(){let t=q(N(import.meta.url));return[E(t,"index.js"),b(t,"../../server/dist/index.js"),b(t,"../../../server/dist/index.js")].find(r=>j(r))||null}var l=t=>process.stdout.write(t),a=t=>process.stderr.write(t);async function k(t){let e=P(t);if(e.help||!e.prompt&&!e.version)return l(M+`
`),e.help?0:1;if(e.version)return l(`Spyro Studio 0.1.0
`),0;if(!e.prompt)return a(`error: no prompt given. Use -p "your prompt".
`),1;let r=e.port||Number(process.env.CLAUDE_FREE_PORT)||8787,o=r,i=null;if(!await w(`http://127.0.0.1:${o}/api/state`)){let y=J();if(!y)return a("error: could not find server/dist/index.js \u2014 run `npm run build`.\n"),1;o=await $(r),i=O(process.execPath,[y],{stdio:["ignore","ignore","pipe"],env:{...process.env,PORT:String(o),...e.cwd?{CLAUDE_FREE_CWD:b(e.cwd)}:{}}});let p=!1;for(let c=0;c<60&&!p;c++)await new Promise(g=>setTimeout(g,400)),p=await w(`http://127.0.0.1:${o}/api/state`);if(!p)return i.kill("SIGTERM"),a(`error: the local server did not start.
`),1}let T=()=>{try{i?.kill("SIGTERM")}catch{}};return new Promise(y=>{let p=new S(`ws://127.0.0.1:${o}`),c="",g=Date.now(),f=0,h=!1,m=d=>{if(!h){h=!0,clearTimeout(_),clearTimeout(v);try{p.close()}catch{}T(),y(d)}},u=d=>{p.readyState===S.OPEN&&p.send(JSON.stringify(d))};p.on("error",()=>{a(`error: could not talk to the local server.
`),m(1)}),p.on("open",()=>{e.model&&u({type:"set_model",model:{provider:e.provider||void 0,model:e.model,baseUrl:void 0,apiKey:void 0}}),e.permissionMode&&u({type:"set_permission_mode",mode:e.permissionMode}),e.effort&&u({type:"set_reasoning_effort",effort:e.effort}),e.cwd&&u({type:"set_cwd",path:b(e.cwd)}),e.resume&&u({type:"load_session",id:e.resume}),(e.allowedTools?.length||e.disallowedTools?.length)&&u({type:"set_permissions",permissions:{allow:e.allowedTools||[],deny:e.disallowedTools||[],ask:[]}}),setTimeout(()=>{let d=e.system?`${e.system}

${e.prompt}`:e.prompt;u({type:"user_message",text:d})},120)}),p.on("message",d=>{g=Date.now();let s;try{s=JSON.parse(d.toString())}catch{return}switch(s.type){case"assistant_text":c+=s.text,!e.json&&!e.quiet&&l(s.text);break;case"assistant_reasoning":e.json?l(JSON.stringify({type:"reasoning",text:s.text})+`
`):e.quiet||a(s.text);break;case"tool_start":f++,e.json?l(JSON.stringify({type:"tool_start",name:s.name,args:s.args})+`
`):e.quiet||a(`
\xB7 ${s.name}
`);break;case"tool_end":e.json&&l(JSON.stringify({type:"tool_end",name:s.name,result:s.result})+`
`),f>=e.maxTurns&&s.name&&(e.json&&l(JSON.stringify({type:"stopped",reason:"max-turns"})+`
`),e.quiet||a(`
[stopped: reached --max-turns ${e.maxTurns}]
`),m(0));break;case"usage":e.json&&l(JSON.stringify({type:"usage",usage:s.usage})+`
`);break;case"error":e.json?l(JSON.stringify({type:"error",message:s.message})+`
`):a(`
error: ${s.message}
`),m(1);break;case"approval_request":u({type:"approval_response",id:s.id,approved:!1});break;case"user_question":u({type:"user_question_response",id:s.id,answers:[]});break;case"run_end":e.json?l(JSON.stringify({type:"result",result:c,turns:f,usage:s.usage,cost:s.cost})+`
`):e.quiet||a(`
[done \xB7 ${f} tool call${f===1?"":"s"}]
`),m(0);break;case"cancelled":m(130);break}});let _=setTimeout(()=>{h||(a(`
error: timed out after ${e.timeoutSec}s
`),m(1))},Math.max(30,e.timeoutSec)*1e3),v=setTimeout(x,Math.min(120,Math.max(30,e.timeoutSec))*1e3);function x(){h||(v=setTimeout(x,Math.min(120,Math.max(30,e.timeoutSec))*1e3),Date.now()-g>Math.max(120,e.timeoutSec)*1e3&&(a(`
error: no activity; giving up
`),m(1)))}})}k(process.argv.slice(2)).then(t=>process.exit(t)).catch(t=>{process.stderr.write(`error: ${t?.message||String(t)}
`),process.exit(1)});

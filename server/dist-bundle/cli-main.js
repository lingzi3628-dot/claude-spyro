// Spyro Studio - closed source. Licensed to Spyro Technologies. Unauthorised use or redistribution is prohibited.
import{spawn as P}from"node:child_process";import{existsSync as O,readFileSync as J}from"node:fs";import{dirname as q,join as A,resolve as c}from"node:path";import{fileURLToPath as N}from"node:url";import D from"node:http";import{WebSocket as _}from"ws";var R=`Spyro Studio \u2014 headless agent

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
  -c, --continue            Continue the most recent session
      --add-dir <path>      Also allow work in this folder (repeatable)
      --output-format <f>   text | json | stream-json (default: text)
      --dangerously-skip-permissions
                            Same as --permission-mode bypass
      --port <n>            Connect to a specific server port
  -q, --quiet               Suppress progress lines
  -h, --help                This help
  -v, --version             Print the version

Examples:
  claude-free -p "summarise README.md"
  claude-free -p "run the tests and fix failures" --max-turns 40
  claude-free -p "review the diff" --permission-mode bypass --json > out.jsonl`;function U(t){let e={json:!1,maxTurns:25,help:!1,version:!1,quiet:!1,timeoutSec:1800,continueSession:!1,addDirs:[]},r=n=>(n||"").split(",").map(i=>i.trim()).filter(Boolean);for(let n=0;n<t.length;n++){let i=t[n],o=()=>t[++n];switch(i){case"-p":case"--print":e.prompt=o();break;case"--json":e.json=!0;break;case"--model":e.model=o();break;case"--provider":e.provider=o();break;case"--cwd":e.cwd=o();break;case"--system":e.system=o();break;case"--output-style":e.outputStyle=o();break;case"--allowed-tools":e.allowedTools=r(o());break;case"--disallowed-tools":e.disallowedTools=r(o());break;case"--permission-mode":e.permissionMode=o();break;case"--max-turns":e.maxTurns=Number(o())||e.maxTurns;break;case"--timeout":e.timeoutSec=Number(o())||e.timeoutSec;break;case"--effort":e.effort=o();break;case"--resume":e.resume=o();break;case"-c":case"--continue":e.continueSession=!0;break;case"--add-dir":e.addDirs.push(...r(o()));break;case"--output-format":{let g=o();g==="json"||g==="stream-json"?e.json=!0:e.json=!1;break}case"--dangerously-skip-permissions":e.permissionMode="bypass";break;case"--port":e.port=Number(o());break;case"-q":case"--quiet":e.quiet=!0;break;case"-h":case"--help":e.help=!0;break;case"-v":case"--version":e.version=!0;break;default:!i.startsWith("-")&&e.prompt===void 0&&(e.prompt=i);break}}return e}function x(t,e=1200){return new Promise(r=>{let n=D.get(t,i=>{i.resume(),r((i.statusCode??0)>=200&&(i.statusCode??0)<500)});n.setTimeout(e,()=>{n.destroy(),r(!1)}),n.on("error",()=>r(!1))})}async function G(t,e=40){for(let r=t;r<t+e;r++)if(!await x(`http://127.0.0.1:${r}/api/state`,500))return r;return t}function F(){let t=q(N(import.meta.url));return[A(t,"index.js"),c(t,"../../server/dist/index.js"),c(t,"../../../server/dist/index.js")].find(r=>O(r))||null}var l=t=>process.stdout.write(t),a=t=>process.stderr.write(t);function I(){let t=q(N(import.meta.url));for(let e of[c(t,"../../package.json"),c(t,"../package.json")])try{if(O(e))return JSON.parse(J(e,"utf8")).version||"unknown"}catch{}return"unknown"}async function E(t){let e=U(t);if(e.help||!e.prompt&&!e.version)return l(R+`
`),e.help?0:1;if(e.version)return l(`Spyro Studio ${I()}
`),0;if(!e.prompt)return a(`error: no prompt given. Use -p "your prompt".
`),1;let r=e.port||Number(process.env.CLAUDE_FREE_PORT)||8787,n=r,i=null;if(!await x(`http://127.0.0.1:${n}/api/state`)){let h=F();if(!h)return a("error: could not find server/dist/index.js \u2014 run `npm run build`.\n"),1;n=await G(r),i=P(process.execPath,[h],{stdio:["ignore","ignore","pipe"],env:{...process.env,PORT:String(n),...e.cwd?{CLAUDE_FREE_CWD:c(e.cwd)}:{}}});let u=!1;for(let f=0;f<60&&!u;f++)await new Promise(b=>setTimeout(b,400)),u=await x(`http://127.0.0.1:${n}/api/state`);if(!u)return i.kill("SIGTERM"),a(`error: the local server did not start.
`),1}let g=()=>{try{i?.kill("SIGTERM")}catch{}};return new Promise(h=>{let u=new _(`ws://127.0.0.1:${n}`),f="",b=Date.now(),y=0,w=!1,m=d=>{if(!w){w=!0,clearTimeout(C),clearTimeout(j);try{u.close()}catch{}g(),h(d)}},p=d=>{u.readyState===_.OPEN&&u.send(JSON.stringify(d))};u.on("error",()=>{a(`error: could not talk to the local server.
`),m(1)});let S=()=>{let d=e.system?`${e.system}

${e.prompt}`:e.prompt;p({type:"user_message",text:d})},v=!1;u.on("open",()=>{e.model&&p({type:"set_model",model:{provider:e.provider||void 0,model:e.model,baseUrl:void 0,apiKey:void 0}}),e.permissionMode&&p({type:"set_permission_mode",mode:e.permissionMode}),e.effort&&p({type:"set_reasoning_effort",effort:e.effort}),e.cwd&&p({type:"set_cwd",path:c(e.cwd)}),e.resume&&p({type:"load_session",id:e.resume});for(let d of e.addDirs)p({type:"add_dir",path:c(d)});if((e.allowedTools?.length||e.disallowedTools?.length)&&p({type:"set_permissions",permissions:{allow:e.allowedTools||[],deny:e.disallowedTools||[],ask:[]}}),e.continueSession&&!e.resume){v=!0,p({type:"list_sessions"});return}setTimeout(S,e.resume?400:120)}),u.on("message",d=>{b=Date.now();let s;try{s=JSON.parse(d.toString())}catch{return}switch(s.type){case"sessions":if(!v)break;v=!1;{let k=[...s.sessions||[]].sort(($,M)=>(M.updatedAt||0)-($.updatedAt||0))[0];k?(!e.quiet&&!e.json&&a(`\xB7 continuing session ${k.id} \u2014 ${k.title}
`),p({type:"load_session",id:k.id}),setTimeout(S,400)):(!e.quiet&&!e.json&&a(`\xB7 no previous session found; starting a new one
`),S())}break;case"assistant_text":f+=s.text,!e.json&&!e.quiet&&l(s.text);break;case"assistant_reasoning":e.json?l(JSON.stringify({type:"reasoning",text:s.text})+`
`):e.quiet||a(s.text);break;case"tool_start":y++,e.json?l(JSON.stringify({type:"tool_start",name:s.name,args:s.args})+`
`):e.quiet||a(`
\xB7 ${s.name}
`);break;case"tool_end":e.json&&l(JSON.stringify({type:"tool_end",name:s.name,result:s.result})+`
`),y>=e.maxTurns&&s.name&&(e.json&&l(JSON.stringify({type:"stopped",reason:"max-turns"})+`
`),e.quiet||a(`
[stopped: reached --max-turns ${e.maxTurns}]
`),m(0));break;case"usage":e.json&&l(JSON.stringify({type:"usage",usage:s.usage})+`
`);break;case"error":e.json?l(JSON.stringify({type:"error",message:s.message})+`
`):a(`
error: ${s.message}
`),m(1);break;case"approval_request":p({type:"approval_response",id:s.id,approved:!1});break;case"user_question":p({type:"user_question_response",id:s.id,answers:[]});break;case"run_end":e.json?l(JSON.stringify({type:"result",result:f,turns:y,usage:s.usage,cost:s.cost})+`
`):e.quiet||a(`
[done \xB7 ${y} tool call${y===1?"":"s"}]
`),m(0);break;case"cancelled":m(130);break}});let C=setTimeout(()=>{w||(a(`
error: timed out after ${e.timeoutSec}s
`),m(1))},Math.max(30,e.timeoutSec)*1e3),j=setTimeout(T,Math.min(120,Math.max(30,e.timeoutSec))*1e3);function T(){w||(j=setTimeout(T,Math.min(120,Math.max(30,e.timeoutSec))*1e3),Date.now()-b>Math.max(120,e.timeoutSec)*1e3&&(a(`
error: no activity; giving up
`),m(1)))}})}E(process.argv.slice(2)).then(t=>process.exit(t)).catch(t=>{process.stderr.write(`error: ${t?.message||String(t)}
`),process.exit(1)});

import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compare } from './core/compare.js';
import { exitCode,markdown,summary } from './core/report.js';
import { parseFixtures } from './core/fixtures.js';
import { replay } from './replay.js';
import { InputError,LIMITS } from './core/types.js';
const help=`Boundary — directional API compatibility gate

boundary compare baseline.yaml candidate.yaml [--fixtures fixtures.json] [--json report.json] [--markdown report.md]
boundary replay baseline.yaml candidate.yaml --fixtures fixtures.json --base-url http://127.0.0.1:8084 [--json replay.json]

Exit codes: 0 PASS, 1 BLOCK, 2 REVIEW required, 3 input/usage/I/O error.
The browser, CLI, and local API share one comparison engine. No remote references are fetched.
Replay performs bounded HTTP calls only to a literal loopback address; redirects are rejected.
`;
async function input(path:string):Promise<string>{const value=await readFile(path,'utf8');if(Buffer.byteLength(value)>LIMITS.bytes)throw new InputError('Input file exceeds 512 KiB');return value;}
async function output(path:string,content:string):Promise<void>{await mkdir(dirname(path),{recursive:true});await writeFile(path,content);}
export async function run(args:string[],io:{out:(s:string)=>void;error:(s:string)=>void}={out:console.log,error:console.error}):Promise<number>{
  if(args.length===0||args[0]==='--help'||args[0]==='help'){io.out(help);return 0;}
  if(args[0]==='--version'){io.out('Boundary 1.0.0');return 0;}
  try{
    const [command,baseline,candidate,...rest]=args;if(!['compare','replay'].includes(command??'')||!baseline||!candidate)throw new InputError(help);
    const options=new Map<string,string>();for(let i=0;i<rest.length;i+=2){const key=rest[i]!,value=rest[i+1];if(!['--fixtures','--json','--markdown','--base-url'].includes(key)||!value||value.startsWith('--')||options.has(key))throw new InputError('Unknown, duplicate, or incomplete CLI option: '+key);options.set(key,value);}
    const b=await input(baseline),a=await input(candidate),fixtures=options.has('--fixtures')?parseFixtures(await input(options.get('--fixtures')!)):[];
    if(command==='replay'){
      if(options.has('--markdown'))throw new InputError('--markdown is only valid for compare');
      if(!options.has('--fixtures')||!options.has('--base-url'))throw new InputError('Replay requires --fixtures and --base-url');
      const results=await replay(b,a,fixtures,options.get('--base-url')!);if(!results.length)throw new InputError('Replay requires at least one request fixture');
      if(options.has('--json'))await output(options.get('--json')!,JSON.stringify(results,null,2)+'\n');for(const r of results)io.out(`${r.verdict} ${r.method} ${r.url}: ${r.detail}`);
      return results.some(r=>r.verdict==='BLOCK')?1:results.some(r=>r.verdict==='REVIEW')?2:0;
    }
    if(options.has('--base-url'))throw new InputError('--base-url is only valid for replay');
    const report=compare(b,a,fixtures);if(options.has('--json'))await output(options.get('--json')!,JSON.stringify(report,null,2)+'\n');if(options.has('--markdown'))await output(options.get('--markdown')!,markdown(report));io.out(summary(report));return exitCode(report);
  }catch(e){io.error(e instanceof Error?e.message:'Boundary input error');return 3;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await run(process.argv.slice(2));

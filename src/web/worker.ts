import { compare } from '../core/compare.js';
import { markdown } from '../core/report.js';
self.onmessage=(event:MessageEvent<{baseline:string;candidate:string;fixtures:unknown}>)=>{try{const report=compare(event.data.baseline,event.data.candidate,event.data.fixtures??[]);self.postMessage({report,markdown:markdown(report)});}catch(e){self.postMessage({error:e instanceof Error?e.message:'Comparison input is invalid'});}};

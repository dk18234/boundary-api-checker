import type { Obj,Fixture } from './core/types.js';
export interface ExampleCase { id:string; name:string; label:string; description:string; expected:'PASS'|'BLOCK'|'REVIEW'; baseline:string; candidate:string; fixtures:Fixture[] }
export function exampleDocuments(){
  const job:Obj={type:'object',required:['id','state'],properties:{id:{type:'string'},state:{type:'string',enum:['queued','running','done']},completedAt:{type:'string',nullable:true}}};
  const jobRef:Obj={$ref:'#/components/schemas/Job'};
  const baseline:Obj={openapi:'3.0.4',info:{title:'Research Jobs API',version:'1.4.0'},paths:{
    '/jobs':{
      get:{operationId:'listJobs',parameters:[{name:'limit',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:100}}],responses:{'200':{description:'Jobs',content:{'application/json':{schema:{type:'array',items:jobRef}}}}}},
      post:{operationId:'submitJob',requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['label','queue','cores'],properties:{label:{type:'string',minLength:1,maxLength:80},queue:{type:'string',enum:['cpu','gpu']},cores:{type:'integer',minimum:1,maximum:64}}}}}},responses:{'202':{description:'Accepted',content:{'application/json':{schema:jobRef}}}}}
    },
    '/jobs/{jobId}':{parameters:[{name:'jobId',in:'path',required:true,schema:{type:'string'}}],get:{operationId:'getJob',responses:{'200':{description:'Job',content:{'application/json':{schema:jobRef}}}}},delete:{operationId:'cancelJob',responses:{'204':{description:'Cancelled'}}}}
  },components:{schemas:{Job:job}}};
  const safe=structuredClone(baseline),breaking=structuredClone(baseline),review=structuredClone(baseline),direction=structuredClone(baseline);
  const path=(doc:Obj):any=>doc.paths;const schema=(doc:Obj):any=>path(doc)['/jobs'].post.requestBody.content['application/json'].schema;
  (safe.info as Obj).version='1.5.0';schema(safe).properties.tag={type:'string'};schema(safe).properties.cores.maximum=128;schema(safe).properties.queue.enum.push('highmem');path(safe)['/health']={get:{responses:{'200':{description:'Healthy',content:{'application/json':{schema:{type:'object',required:['status'],properties:{status:{type:'string',enum:['ok']}}}}}}}}};
  (breaking.info as Obj).version='2.0.0';delete path(breaking)['/jobs/{jobId}'].delete;path(breaking)['/jobs'].get.parameters[0].required=true;schema(breaking).required.push('projectId');schema(breaking).properties.projectId={type:'string'};schema(breaking).properties.cores.maximum=32;schema(breaking).properties.queue.enum=['cpu'];const newJob=(breaking.components as any).schemas.Job;newJob.properties.id.type='integer';newJob.properties.state.enum.push('cancelled');path(breaking)['/jobs/{jobId}'].get.responses['429']={description:'Throttled'};
  (review.info as Obj).version='1.4.1';schema(review).properties.label.pattern='^[a-z0-9-]+$';
  (direction.info as Obj).version='1.5.0-experiment';schema(direction).properties.queue.enum.push('highmem');(direction.components as any).schemas.Job.properties.state.enum.push('cancelled');
  return{baseline,safe,breaking,review,direction};
}
export function requestFixtures():Fixture[]{return[
  {name:'GPU research job',method:'POST',path:'/jobs',request:{body:{label:'spectra-analysis',queue:'gpu',cores:8}}},
  {name:'Large CPU job',method:'POST',path:'/jobs',request:{body:{label:'simulation',queue:'cpu',cores:64}}},
  {name:'List with default limit',method:'GET',path:'/jobs',request:{}},
  {name:'Fetch an existing job',method:'GET',path:'/jobs/{jobId}',request:{parameters:{'path:jobId':'job_001'}}}
];}
export function examples():ExampleCase[]{
  const d=exampleDocuments(),stringify=(o:Obj)=>JSON.stringify(o,null,2)+'\n',baseline=stringify(d.baseline);
  return[
    {id:'breaking',name:'A release that breaks clients',label:'Breaking release',description:'A required project ID, fewer queues, a smaller CPU limit, and changed response types.',expected:'BLOCK',baseline,candidate:stringify(d.breaking),fixtures:[...requestFixtures(),{name:'Observed candidate job response',method:'GET',path:'/jobs/{jobId}',response:{status:200,source:'candidate',body:{id:17,state:'cancelled'}}}]},
    {id:'compatible',name:'An additive release',label:'Compatible change',description:'Optional input for a closed request schema, more accepted queues, and an added health endpoint.',expected:'PASS',baseline,candidate:stringify(d.safe),fixtures:requestFixtures()},
    {id:'review',name:'A rule outside the profile',label:'Review required',description:'A new regular expression needs a dedicated validator. Boundary keeps the CI gate closed.',expected:'REVIEW',baseline,candidate:stringify(d.review),fixtures:[]},
    {id:'direction',name:'Same edit, opposite impact',label:'Direction matters',description:'An enum addition widens accepted requests but also widens emitted responses.',expected:'BLOCK',baseline,candidate:stringify(d.direction),fixtures:requestFixtures()}
  ];
}

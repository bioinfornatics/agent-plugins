import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyzeSessions, main, validateSession, type StudySession } from "../dist/scripts/usability_study.js";

const fixture=(name:string)=>JSON.parse(readFileSync(resolve(process.env.SKILL_CREATOR_SKILL_ROOT ?? "../../skills/skill-creator", "assets/usability-study/fixtures",name),"utf8"));
const assignments=[
 ["novice-skill","nonexpert","skill"],["novice-agent","nonexpert","agent"],["novice-plugin","nonexpert","plugin"],
 ["developer-skill","developer","skill"],["developer-agent","developer","agent"],["developer-plugin","developer","plugin"],
] as const;
function completeSample():StudySession[]{const base=fixture("synthetic-valid.json") as StudySession;return assignments.map(([task_id,cohort,expected_artifact],i)=>({...base,session_id:`S-SYNTH00${i+1}`,cohort,tasks:[{...base.tasks[0],task_id,expected_artifact,initial_artifact:expected_artifact==="skill"?"agent":"skill",final_artifact:expected_artifact,wrong_artifact_recovered:true}],findings:i===0?base.findings:[]}))}

test("strict session validation accepts governed synthetic shape and rejects identifiers",()=>{
 const ok=validateSession(fixture("synthetic-valid.json"));assert.equal(ok.valid,true,ok.errors.join("\n"));
 const bad=validateSession(fixture("synthetic-invalid-identifier.json"));assert.equal(bad.valid,false);assert.match(bad.errors.join("\n"),/participant_email: direct identifiers/);assert.match(bad.errors.join("\n"),/tasks: must contain exactly one/);
 const noConsent=fixture("synthetic-valid.json");delete noConsent.consent;assert.equal(validateSession(noConsent).valid,false);
 const noRetention=fixture("synthetic-valid.json");delete noRetention.retention;assert.equal(validateSession(noRetention).valid,false);
 for(const text of ["Contact user@example.invalid","See https://github.com/acme/private","Clone git://host/repo","Read /home/alice/project","Read C:\\Users\\Alice\\repo"]){const embedded=fixture("synthetic-valid.json");embedded.findings[0].description=text;assert.match(validateSession(embedded).errors.join("\n"),/(?:email address|URL|handle|phone number|home path) is prohibited/)}
});

test("task IDs are strict and bound to cohort and expected artifact",()=>{
 for(const mutate of [(x:any)=>x.tasks[0].task_id="custom-task",(x:any)=>x.tasks[0].expected_artifact="plugin",(x:any)=>x.cohort="developer",(x:any)=>x.findings[0].task_id="custom-task",(x:any)=>x.findings[0].task_id="novice-plugin"]){const value=fixture("synthetic-valid.json");mutate(value);assert.equal(validateSession(value).valid,false)}
 const multiple=fixture("synthetic-valid.json");multiple.tasks.push({...multiple.tasks[0]});assert.match(validateSession(multiple).errors.join("\n"),/exactly one attempted task/);
});

test("analysis is deterministic, coverage-gated, and never executes follow-ups",()=>{
 const sessions=completeSample();const report=analyzeSessions(sessions);
 assert.equal(report.status,"threshold-met");assert.equal(report.threshold.parent_minimum_sessions,5);assert.equal(report.threshold.minimum_sessions,6);assert.equal(report.threshold.eligible,true);assert.equal(report.metrics.task_coverage.percent,100);assert.deepEqual(report.sample.coverage.missing_task_ids,[]);assert.deepEqual(report.sample.coverage.covered_artifacts,["skill","agent","plugin"]);assert.equal(report.metrics.completion_without_correction.percent,100);assert.equal(report.metrics.question_burden.total,6);assert.equal(report.metrics.wrong_artifact_recovery.percent,100);assert.equal(report.suggested_followups.executed,false);assert.equal(report.suggested_followups.commands.length,1);assert.match(report.suggested_followups.commands[0].command,/^bd create --title '\[P1\]/);assert.deepEqual(report,analyzeSessions([...sessions].reverse()));
});

test("eligibility requires six sessions, all task IDs, artifacts, and cohorts",()=>{
 const sessions=completeSample();assert.equal(analyzeSessions(sessions.slice(0,5)).threshold.eligible,false);
 const duplicateTask=completeSample();duplicateTask[5]={...duplicateTask[5],tasks:[{...duplicateTask[5].tasks[0],task_id:"developer-agent",expected_artifact:"agent"}]};const report=analyzeSessions(duplicateTask);assert.equal(report.status,"insufficient-sample");assert.deepEqual(report.sample.coverage.missing_task_ids,["developer-plugin"]);assert.equal(report.metrics.task_coverage.percent,83.33);
});

test("duplicate session IDs are rejected",()=>{
 const sessions=completeSample();sessions[1]={...sessions[1],session_id:sessions[0].session_id};assert.throws(()=>analyzeSessions(sessions),/duplicate session_id/);
});


test("CLI validation rejects duplicate session IDs before analysis",()=>{
 const dir=mkdtempSync(join(tmpdir(),"skill-creator-usability-"));try{const sessions=completeSample().slice(0,2);sessions[1]={...sessions[1],session_id:sessions[0].session_id};const input=join(dir,"sessions.json"),output=join(dir,"result.json");writeFileSync(input,JSON.stringify(sessions));assert.equal(main(["--validate",input,"--output",output]),1);const result=JSON.parse(readFileSync(output,"utf8"));assert.equal(result.status,"invalid");assert.match(result.errors.join("\n"),/session_id: duplicate/)}finally{rmSync(dir,{recursive:true,force:true})}
});

test("privacy checks reject network, organization, and likely full-name identifiers",()=>{
 for(const text of ["Observed from 192.168.10.4","Endpoint 2001:db8:85a3::8a2e:370:7334 failed","participant works at acme","Escalated to Acme Corporation","Asked Alice Smith for help","Asked Dr. Alice Smith for help"]){const value=fixture("synthetic-valid.json");value.findings[0].description=text;assert.equal(validateSession(value).valid,false,text)}
 const reviewed=fixture("synthetic-valid.json");delete reviewed.findings[0].privacy_reviewed;assert.match(validateSession(reviewed).errors.join("\n"),/privacy_reviewed: required|privacy_reviewed: must be true/);
});

test("runtime enforces schema lengths, enums, integer bounds, and recovery semantics",()=>{
 const mutations=[
  (x:any)=>x.findings[0].title="x".repeat(121),
  (x:any)=>x.findings[0].description="x".repeat(501),
  (x:any)=>x.findings[0].classification="other",
  (x:any)=>x.tasks[0].confidence=6,
  (x:any)=>x.tasks[0].participant_questions=0.5,
  (x:any)=>{x.tasks[0].initial_artifact="agent";x.tasks[0].final_artifact="agent";x.tasks[0].wrong_artifact_recovered=true},
  (x:any)=>{x.tasks[0].initial_artifact="skill";x.tasks[0].final_artifact="plugin";x.tasks[0].wrong_artifact_recovered=true},
 ];
 for(const mutate of mutations){const value=fixture("synthetic-valid.json");mutate(value);assert.equal(validateSession(value).valid,false)}
});

test("retention follows consent date and the 90-day policy bound",()=>{
 for(const date of ["2029-12-31","2030-04-02","2030-02-30"]){const value=fixture("synthetic-valid.json");value.retention.delete_after=date;assert.equal(validateSession(value).valid,false,date)}
 for(const date of ["2030-01-01","2030-04-01"]){const value=fixture("synthetic-valid.json");value.retention.delete_after=date;assert.equal(validateSession(value).valid,true,date)}
});

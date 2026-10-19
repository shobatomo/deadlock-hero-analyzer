// Synthetic audit records only. Not evidence of a real user or scheduler run.
export const auditRun=(outcome='success',overrides={})=>({
  started_at:'2026-10-18T21:00:00.000Z',finished_at:outcome==='started'?null:'2026-10-18T21:00:30.000Z',outcome,
  result_code:({success:'complete',failed:'provider_timeout',partial:'page_limit',skipped:'cooldown',started:null})[outcome],
  processed_count:outcome==='success'?0:outcome==='partial'?5:null,...overrides,
})
export const auditSource=(latest=null,overrides={})=>({latest,last_success:latest?.outcome==='success'?latest:null,last_failure:latest?.outcome==='failed'?latest:null,unfinished_count:latest?.outcome==='started'?'1':'0',oldest_unfinished_at:latest?.outcome==='started'?latest.started_at:null,...overrides})
export const auditSnapshot=(overrides={})=>({available:true,evidence:'recorded_attempts_only',cron_origin_verified:false,observed_at:'2026-10-19T00:15:00.000Z',sources:{manual:auditSource(),registration:auditSource(),cron_endpoint:auditSource(),...overrides}})
export const mixedAudit=()=>auditSnapshot({
  manual:auditSource(auditRun('success'),{last_failure:auditRun('failed',{started_at:'2026-10-17T23:00:00Z',finished_at:'2026-10-17T23:00:30Z'}),unfinished_count:'2',oldest_unfinished_at:'2026-10-16T00:00:00Z'}),
  registration:auditSource(auditRun('partial')),
  cron_endpoint:auditSource(auditRun('started'),{last_success:auditRun('success',{started_at:'2026-10-17T21:00:00Z',finished_at:'2026-10-17T21:00:30Z'})}),
})

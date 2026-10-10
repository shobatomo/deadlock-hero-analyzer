import {validateSnapshotVersion} from './reference-contract-v2.js'
// Public app exposes only a bounded read-only transaction; no publish/write methods.
export function createReadOnlyReferenceStore(db){
 if(typeof db?.readOnlyTransaction!=='function')throw Error('Read-only SQL executor required')
 return {async readActiveSnapshot(configKey){
  const result=await db.readOnlyTransaction(tx=>tx.query(`SELECT s.id,s.config_key,s.context,s.manifest,s.published_at,
   (SELECT jsonb_agg(h.payload ORDER BY h.hero_id,h.cohort) FROM fyth_private.hero_baselines h WHERE h.snapshot_id=s.id) AS groups
   FROM fyth_private.baseline_current c JOIN fyth_private.baseline_snapshots s ON s.id=c.snapshot_id
   WHERE c.config_key=$1 AND s.status='published'`,[configKey]))
  const row=result.rows[0];if(!row)return null
  validateSnapshotVersion({config_key:row.config_key,context:row.context,manifest:row.manifest,groups:row.groups})
  return row
 }}
}

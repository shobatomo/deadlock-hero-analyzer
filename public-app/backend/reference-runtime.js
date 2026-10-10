import {referenceSelection} from '../shared/reference-config.mjs'
import {createSqlExecutor} from './sql-executor.js'
import {createReadOnlyReferenceStore} from './read-only-reference-store.js'
import {createSnapshotReader} from './snapshot-reader.js'
// Lazy and opt-in: no network connection at module load or without explicit mode.
export function createRuntimeReferences({baselineVersion}={}){
 let reader
 return async function references(){
 if(!reader){const enabled=process.env.FYTH_REFERENCE_SOURCE==='database',url=enabled?process.env.FYTH_DB_READ_URL:null
  let store
  if(enabled)try{if(!url)throw Error('Missing configuration');store=createReadOnlyReferenceStore(createSqlExecutor({connectionString:url,role:'fyth_reader',ca:process.env.FYTH_DB_CA_CERT}))}catch{store={readActiveSnapshot:async()=>{throw Error('Unavailable')}}}
  reader=createSnapshotReader({store,configKey:referenceSelection(baselineVersion??process.env.FYTH_BASELINE_VERSION).configKey})
 }
 return reader()
}

}
export const runtimeReferences=createRuntimeReferences()

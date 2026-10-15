import {createDeadhubApp} from '../backend/deadhub/app.js'
import {createRecordRuntime} from '../backend/deadhub/runtime.js'
export default createDeadhubApp({...createRecordRuntime(),cronSecret:process.env.CRON_SECRET})
export const config={maxDuration:65}

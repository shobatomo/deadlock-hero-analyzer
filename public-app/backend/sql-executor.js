import pg from 'pg'
// Connection values supplied by the user through server-only configuration.
// Never log URLs, query values or raw driver errors.
export function createSqlExecutor({connectionString,role,ca,Pool=pg.Pool}={}){
 if(!connectionString || !['fyth_reader','fyth_writer'].includes(role))throw new Error('Database configuration required')
 let url;try{url=new URL(connectionString)}catch{throw new Error('Invalid database configuration')}
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Invalid database configuration')
 // URI ssl flags can override pg ssl options; retain explicit certificate verification.
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','ssl'])url.searchParams.delete(key)
 const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,query_timeout:10000})
 pool.on?.('error',()=>{}) // Idle errors are handled without exposing driver/credential details.
 async function transaction(fn,{rollbackOnly=false,readOnly=false}={}){const client=await pool.connect();let broken=false
  const deadline=Date.now()+15000
  const query=(sql,values)=>{
   if(!readOnly)return client.query(sql,values)
   const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Read-only deadline exceeded')
   return client.query({text:sql,values,query_timeout:Math.min(3000,remaining)})
  }
  const tx=readOnly?new Proxy(client,{get(target,key){if(key==='query')return query;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}}):client
  try{await query(readOnly?'BEGIN READ ONLY':'BEGIN');await query(`SET LOCAL ROLE ${role}`);await query(readOnly?"SET LOCAL statement_timeout='3s'":"SET LOCAL statement_timeout='8s'");await query(readOnly?"SET LOCAL lock_timeout='1s'":"SET LOCAL lock_timeout='3s'");const result=await fn(tx);await query(rollbackOnly?'ROLLBACK':'COMMIT');return result}
  catch(error){try{await client.query(readOnly?{text:'ROLLBACK',query_timeout:3000}:'ROLLBACK')}catch{broken=true}throw error}
  finally{client.release(broken)}
 }
 return {transaction,readOnlyTransaction:fn=>transaction(fn,{rollbackOnly:true,readOnly:true}),rollbackTransaction:fn=>transaction(fn,{rollbackOnly:true}),query:(sql,values)=>transaction(tx=>tx.query(sql,values)),close:()=>pool.end()}
}

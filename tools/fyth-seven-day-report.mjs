// Offline formatter only. No database client, env, credentials or network.
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
const usageFields=['diagnosis_requested','diagnosis_ready','diagnosis_withheld','diagnosis_error','diagnosis_disconnected']
const feedbackFields=['feedback_wanted','feedback_unwanted','feedback_unsure']
function exactKeys(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw Error('invalid')
}
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('invalid')
 const parsed=new Date(value+'T00:00:00Z')
 if(!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value)throw Error('invalid')
 return parsed
}
function count(value){
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return BigInt(value)
 if(typeof value==='string'&&/^\d{1,100}$/.test(value))return BigInt(value)
 throw Error('invalid')
}
function rows(input,fields){
 if(!Array.isArray(input)||input.length!==7)throw Error('invalid')
 const end=input[0]?.window_end_utc,anchor=date(end),byDay=new Map()
 for(const row of input){
  exactKeys(row,['window_end_utc','day_utc',...fields]);date(row.day_utc)
  if(row.window_end_utc!==end||byDay.has(row.day_utc))throw Error('invalid')
  byDay.set(row.day_utc,Object.fromEntries(fields.map(key=>[key,count(row[key])])))
 }
 const ordered=[]
 for(let offset=6;offset>=0;offset--){const day=new Date(anchor.valueOf()-offset*86400000).toISOString().slice(0,10);if(!byDay.has(day))throw Error('invalid');ordered.push({day,...byDay.get(day)})}
 return {end,ordered}
}
export function formatSevenDayReport(input){
 exactKeys(input,['usage','feedback'])
 const usage=rows(input.usage,usageFields),feedback=rows(input.feedback,feedbackFields)
 if(usage.end!==feedback.end)throw Error('invalid')
 const totals=fields=>Object.fromEntries(fields.map(k=>[k,0n]))
 const uTotals=totals(usageFields),fTotals=totals(feedbackFields)
 const table=(data,fields,labels,sum)=>{
  const lines=['| UTC日付 | '+labels.join(' | ')+' |','| '+Array(fields.length+1).fill('---').join(' | ')+' |']
  for(const row of data){for(const k of fields)sum[k]+=row[k];lines.push('| '+row.day+' | '+fields.map(k=>row[k].toString()).join(' | ')+' |')}
  lines.push('| 7日合計 | '+fields.map(k=>sum[k].toString()).join(' | ')+' |');return lines.join('\n')
 }
 return [
  '# FYTH 日別の保存件数（UTC）',
  `期間：${usage.ordered[0].day} ～ ${usage.end}。UTC当日分は途中の値です。`,
  '## 診断イベント',table(usage.ordered,usageFields,['診断要求','推薦あり応答完了','推薦なし応答完了','エラー応答完了','接続切断'],uTotals),
  '## 任意の3択回答',table(feedback.ordered,feedbackFields,['使ってみたいと思った','使ってみたいとは思わなかった','まだ分からない'],fTotals),
  '## 読み方',
  '- 件数は保存済みのイベント・回答です。ユーザー数ではありません。同じ利用者の連続実行や本人テストを分離できません。',
  '- 推薦あり（ready）はサーバーの応答完了で、画面描画・本人の閲覧確認ではありません。',
  '- usageと回答は個人単位に結合できません。再試行は別要求で、通信・保存失敗やUTC日付境界による差もあります。',
  '- 2種類の集計は別々の取得時点です。取得の間に件数が増えることがあります。',
  '- 0件補完は、その日・項目の保存行がない意味です。計測開始前の利用がゼロだったとは言えず、未導入・受付停止・欠測・利用なしを区別できません。',
  '- この表だけで離脱率・改善効果・ヒーローの評価を断定しません。少数データで変更を決めず、追加の意見と合わせて確認します。',
  '',
 ].join('\n\n')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try {
  if(process.argv.length!==3)throw Error('invalid')
  const text=await readFile(process.argv[2],'utf8');if(Buffer.byteLength(text)>100000)throw Error('invalid')
  process.stdout.write(formatSevenDayReport(JSON.parse(text)))
 }catch{process.stderr.write('{"status":"failed","code":"report_input_invalid"}\n');process.exitCode=1}
}

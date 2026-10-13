import {useEffect, useRef, useState} from 'react'
import {FEEDBACK_QUESTION, FEEDBACK_CHOICES} from '../../../shared/feedback.mjs'
import {feedbackAvailable, sendFeedback} from '../lib/feedback'
import './RecommendationFeedback.css'
export default function RecommendationFeedback({available = feedbackAvailable, submit = sendFeedback}) {
 const [enabled, setEnabled] = useState(false)
 const [choice, setChoice] = useState('')
 const [state, setState] = useState('idle')
 const busy = useRef(false), mounted = useRef(false)
 useEffect(() => {
  mounted.current = true
  let current = true
  Promise.resolve().then(available).then(value => { if (current) setEnabled(value === true) }).catch(() => {})
  return () => { current = false; mounted.current = false }
 }, [available])
 const locked = !enabled || ['sending', 'stored', 'unknown', 'blocked'].includes(state)
 async function send(event) {
  event.preventDefault()
  if (busy.current || locked || !choice) return
  busy.current = true
  setState('sending')
  let retryAllowed = false
  try {
   const result = await submit(choice)
   retryAllowed = result?.status === 'not_stored' && result.retryable === true
   if (mounted.current) setState(result?.status === 'stored' ? 'stored' : result?.status === 'not_stored' ? (result.retryable ? 'retry' : 'blocked') : 'unknown')
  } catch { if (mounted.current) setState('unknown') }
  finally { busy.current = !retryAllowed }
 }
 return <section className="feedback-panel" aria-label="任意のフィードバック">
  <form onSubmit={send}>
   <fieldset disabled={locked} aria-describedby="feedback-note">
    <legend>{FEEDBACK_QUESTION}</legend>
    <p id="feedback-note" className="muted">回答は任意です。次の試合で試したくなったかを教えてください。選択肢だけを送信し、日付・選択肢・件数の通常の集計を30日間保持します。バックアップには別途残る可能性があります。ID・試合履歴・自由記述・個別回答は保存しません。</p>
    <div className="feedback-options">{FEEDBACK_CHOICES.map(value => <label key={value}><input type="radio" name="feedback-choice" value={value} checked={choice === value} onChange={() => setChoice(value)}/>{value}</label>)}</div>
    <button className="secondary-button" type="submit" disabled={!choice || locked}>{state === 'retry' ? 'もう一度送信する' : '回答を送信する'}</button>
   </fieldset>
   <p role="status" aria-live="polite">{!enabled ? '現在、回答の受付は停止しています。回答は送信されません。' : state === 'sending' ? '送信しています…' : state === 'stored' ? '回答を集計に保存しました。ありがとうございます。' : state === 'retry' ? '保存されませんでした。時間をおいて、もう一度送信できます。' : state === 'blocked' ? '保存されませんでした。現在は送信できません。' : state === 'unknown' ? '保存できたか確認できませんでした。重複を防ぐため、この画面からの再送信を停止しています。' : ''}</p>
  </form>
 </section>
}

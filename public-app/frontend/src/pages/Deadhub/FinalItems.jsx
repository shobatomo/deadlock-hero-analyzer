import {useEffect, useId, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {safeFinalItems} from '../../../../shared/final-items.mjs'
import {loadItemDetails} from './item-details.mjs'
import './FinalItems.css'

function ItemIcon({item}) {
  const [failed, setFailed] = useState(false)
  return item.image && !failed ? <img src={item.image} alt="" loading="lazy" draggable="false" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> :
    <span className="dh-item-fallback" aria-hidden="true">{item.name}</span>
}

function ItemDetailsModal({item, opener, onClose}) {
  const dialog = useRef(null), closeButton = useRef(null), backdropPress = useRef(false)
  const titleId = useId(), [details, setDetails] = useState(null), [failed, setFailed] = useState(false)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    closeButton.current.focus()
    return () => { element.close(); if (opener?.isConnected) opener.focus({preventScroll:true}) }
  }, [opener])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = setTimeout(() => controller.abort(), 8000)
    loadItemDetails(item.id, {signal:controller.signal}).then(value => {
      if (active) setDetails(value)
    }).catch(() => { if (active) setFailed(true) }).finally(() => clearTimeout(timeout))
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [item.id])
  function outside(event) {
    if (event.target !== dialog.current) return false
    const box = dialog.current.getBoundingClientRect()
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
  }
  function trapFocus(event) {
    if (event.key !== 'Tab') return
    const targets = [...dialog.current.querySelectorAll('button, [tabindex="0"]')]
    const first = targets[0], last = targets.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }
  return createPortal(<dialog ref={dialog} className="dh-item-modal" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={trapFocus}
    onPointerDown={event => { backdropPress.current = outside(event) }}
    onClick={event => { if (backdropPress.current && outside(event)) onClose(); backdropPress.current = false }}>
    <header className="dh-item-modal-header">
      <div className="dh-item-modal-icon"><ItemIcon item={item}/></div>
      <h2 id={titleId}>{item.name}</h2>
      <button type="button" ref={closeButton} className="dh-item-modal-close" aria-label="アイテム説明を閉じる" onClick={onClose}>×</button>
    </header>
    <div className="dh-item-modal-body" tabIndex={0} role="region" aria-label="アイテムの効果">
      {!details && <p role="status">{failed ? '効果の説明を取得できませんでした。' : '効果を読み込み中…'}</p>}
      {details && !details.sections.length && <p>このアイテムの効果の説明は未取得です。</p>}
      {details?.sections.map((section, index) => <section key={index} className="dh-item-effect">
        <h3>{section.title}</h3>
        {section.blocks.map((block, blockIndex) => <div key={blockIndex}>
          {block.text && <p>{block.text}</p>}
          {block.rows.length > 0 && <dl>{block.rows.map((row, rowIndex) => <div key={rowIndex}>
            <dt>{row.label}{row.condition && <small>（{row.condition}）</small>}</dt><dd>{row.value}</dd>
          </div>)}</dl>}
        </div>)}
      </section>)}
      {details?.incomplete && <p className="dh-item-modal-note">一部の効果・条件は未取得です。</p>}
    </div>
    <p className="dh-item-modal-note dh-item-modal-footer">現在の基本値です。試合当時や試合中の補正後の数値ではありません。</p>
  </dialog>, document.body)
}

export default function FinalItems({items}) {
  const values = safeFinalItems(items), [selected, setSelected] = useState(null), [opened, setOpened] = useState(null)
  const gesture = useRef(null), touchClick = useRef(false), suppressReleaseClick = useRef(false)
  const current = values?.find(item => item.id === selected) ?? values?.[0]
  const modalItem = values?.find(item => item.id === opened?.id)
  function cancelPress() { clearTimeout(gesture.current?.timer); gesture.current = null }
  useEffect(() => {
    const cancel = () => cancelPress()
    const otherTouch = event => {
      suppressReleaseClick.current = false
      if (gesture.current && event.pointerId !== gesture.current.id) cancelPress()
    }
    // Opening under a held finger can retarget its release click to the dialog's
    // close button. Ignore that one click; any new pointer/keyboard action resets it.
    const releaseClick = event => {
      if (!suppressReleaseClick.current) return
      suppressReleaseClick.current = false
      if (event.detail > 0 || ['touch','pen'].includes(event.pointerType)) {
        event.preventDefault(); event.stopPropagation()
      }
    }
    const keyboard = () => { suppressReleaseClick.current = false }
    window.addEventListener('scroll', cancel, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerdown', otherTouch, true)
    window.addEventListener('click', releaseClick, true)
    window.addEventListener('keydown', keyboard, true)
    document.addEventListener('visibilitychange', cancel)
    return () => {
      cancelPress()
      window.removeEventListener('scroll', cancel, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerdown', otherTouch, true)
      window.removeEventListener('click', releaseClick, true)
      window.removeEventListener('keydown', keyboard, true)
      document.removeEventListener('visibilitychange', cancel)
    }
  }, [])
  useEffect(() => { cancelPress() }, [items])
  // Discard a removed selection so a later resync cannot reopen its dialog.
  useEffect(() => { if (opened && !modalItem) setOpened(null) }, [opened, modalItem])
  function startPress(event, item) {
    cancelPress()
    touchClick.current = event.pointerType === 'touch' || event.pointerType === 'pen'
    if (!touchClick.current || event.isPrimary === false || event.button !== 0) return
    const opener = event.currentTarget
    gesture.current = {id:event.pointerId, x:event.clientX, y:event.clientY,
      timer:setTimeout(() => {
        gesture.current = null
        suppressReleaseClick.current = true
        setSelected(item.id)
        setOpened({id:item.id, opener})
      }, 550)}
  }
  return <div className="dh-final-items">
    <h3>終了時の所持アイテム</h3>
    {values === null ? <p className="dh-items-note">アイテム情報は未取得です。</p> : !values.length ?
      <p className="dh-items-note">取得済みデータ上は所持アイテムなし</p> : <>
      <ul className="dh-items-list" aria-label="終了時の所持品一覧">
        {values.map(item => <li key={item.id}><button type="button" aria-label={item.name} aria-haspopup="dialog"
          aria-pressed={current.id === item.id} onFocus={() => setSelected(item.id)}
          onPointerDown={event => startPress(event, item)} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress}
          onPointerMove={event => {
            const press = gesture.current
            if (press && (event.pointerId !== press.id || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10)) cancelPress()
          }}
          onContextMenu={event => { if (touchClick.current) event.preventDefault() }}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { touchClick.current = false; cancelPress() } }}
          onClick={event => {
            setSelected(item.id)
            if ((touchClick.current && event.detail > 0) || ['touch','pen'].includes(event.nativeEvent.pointerType) || event.nativeEvent.sourceCapabilities?.firesTouchEvents) return
            setOpened({id:item.id, opener:event.currentTarget})
          }}>
          <ItemIcon key={item.image ?? 'missing'} item={item}/>
        </button></li>)}
      </ul>
      <p className="dh-item-name" role="status">{current.name}</p>
      <p className="dh-items-note">PCはクリック、スマホは長押しで効果を表示。ゲーム内のスロット順ではありません。</p>
    </>}
    {modalItem && <ItemDetailsModal key={modalItem.id} item={modalItem} opener={opened.opener} onClose={() => setOpened(null)}/>}
  </div>
}

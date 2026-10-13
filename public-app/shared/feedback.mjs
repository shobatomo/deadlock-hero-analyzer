export const FEEDBACK_QUESTION = 'おすすめを見て、使ってみたいヒーローはありましたか？'
export const FEEDBACK_CHOICES = Object.freeze([
 '使ってみたいと思った',
 '使ってみたいとは思わなかった',
 'まだ分からない',
])
export function validFeedback(body) {
 return body !== null && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).length === 1 && Object.hasOwn(body, 'choice')
  && FEEDBACK_CHOICES.includes(body.choice)
}

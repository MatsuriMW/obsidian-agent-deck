// Only explicit approval states or a final request for confirmation should interrupt the user.
export function attentionReason(session) {
  if (session.state === 'error' && /^首轮需要审批或交互/.test(session.error || '')) return '需要授权';
  if (session.state === 'needs-approval') return '需要授权';
  if (!['wait', 'done'].includes(session.state)) return '';
  const text = (session.lastText || session.result || '').trim().split('\n').filter(Boolean).at(-1) || '';
  return /^(?:请(?:你)?(?:确认|批准|授权|允许|选择)|需要你(?:确认|批准|授权|选择))[^。！\n]*[？?]?$/.test(text) || /^(?:Can|Could|Would) you (?:please )?(?:confirm|approve|allow|choose)\b[^.!\n]*\?$/i.test(text) ? '需要确认' : '';
}

export class AttentionTracker {
  constructor() { this.pending = new Map(); }
  update(sessions) {
    const next = new Map(), fresh = [];
    for (const session of sessions) {
      const key = `${session.agent}:${session.sid || session.sessionId || session.id}`;
      if (next.has(key)) continue;
      // A managed job is authoritative even if scanned logs still show an old question.
      next.set(key, { session, reason: attentionReason(session) });
    }
    for (const [key, value] of next) {
      if (!value.reason) { next.delete(key); continue; }
      if (this.pending.get(key)?.reason !== value.reason) fresh.push({ key, ...value });
    }
    this.pending = next;
    return fresh;
  }
}

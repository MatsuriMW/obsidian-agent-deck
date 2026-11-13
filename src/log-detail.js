// A setting change applies to rounds that start afterwards, including existing sessions.
export const logDetail = value => ['standard', 'detailed'].includes(value) ? value : 'brief';
export function changeLogDetail(settings, value, at = Date.now()) {
  const previous = logDetail(settings.autoLogDetail), next = logDetail(value);
  if (previous === next) return;
  if (!settings.autoLogDetailHistory?.length) settings.autoLogDetailHistory = [{ at: 0, detail: previous }];
  const history = settings.autoLogDetailHistory;
  history.push({ at, detail: next });
  settings.autoLogDetail = next;
}
export function detailForRound(detail, history, round) {
  const at = round.at || round.doneAt;
  if (at && history?.length) {
    for (let i = history.length - 1; i >= 0; i--) if (history[i].at <= at) return logDetail(history[i].detail);
  }
  return logDetail(detail);
}

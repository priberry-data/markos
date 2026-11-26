/** A meeting time the founder reads at a glance, e.g. "Mon, 19 Oct, 11:00 am". Safe on server and client. */
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

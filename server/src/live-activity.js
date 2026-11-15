// Drives the Live Activity on the phone from the server, so it keeps rotating with the phone locked.
//
// Every 30 seconds while one of my starters' games is on, it polls the feed and pushes the next slide.
// With auto start on, it starts the Live Activity itself (push-to-start, iOS 17.2+) when the first of my
// games kicks off, ends it when my last game is final, and replaces it before iOS's 8-hour limit.

const TICK = 30 * 1000, IDLE_TICK = 5 * 60 * 1000;
const MAX_AGE = 7.5 * 60 * 60 * 1000;       // iOS ends a Live Activity after 8 hours
const MANUAL_GRACE = 60 * 60 * 1000;        // one started by hand with no game on keeps rotating this long

export const ATTRIBUTES_TYPE = 'ScoresActivityAttributes';

export class LiveActivityDriver {
  constructor({ feed, apns, store, now = Date.now, log = console }) {
    Object.assign(this, { feed, apns, store, now, log });
  }

  get pushConfigured() { return this.apns.configured; }

  status() {
    const live = this.store.live();
    return { push: this.pushConfigured, auto: live.auto, canAutoStart: Boolean(live.pushToStart), active: Boolean(live.activity?.token) };
  }

  // The phone reports tokens as iOS hands them out. Returns the new status.
  saveTokens({ pushToStart, activityId, activityToken, ended }) {
    const live = this.store.live(), patch = {};
    if (pushToStart !== undefined) patch.pushToStart = pushToStart || null;
    if (activityId && activityToken) {
      const old = live.activity, same = old?.id === activityId, serverStarted = !same && Boolean(live.pending);
      const startedAt = same ? old.startedAt ?? this.now() : serverStarted ? live.pending.startedAt : this.now();
      // Started from the app rather than by the server's push-to-start.
      const manual = same ? Boolean(old.manual) : !serverStarted;
      patch.activity = { id: activityId, token: activityToken, startedAt, manual };
      patch.pending = null;
      // Only one Live Activity at a time: a new one replaces the old, which is dismissed right away.
      if (old?.token && !same) this.dismiss(old.token);
    }
    if (ended && live.activity?.id === ended) patch.activity = null;
    if (Object.keys(patch).length) this.store.setLive(patch);
    return this.status();
  }

  setAuto(auto) { this.store.setLive({ auto: Boolean(auto) }); return this.status(); }

  async tick() {
    if (!this.pushConfigured) return IDLE_TICK; // without push, the feed polls only when the app asks
    await this.feed.refresh(TICK - 5000);
    const window = this.feed.gameWindow(), live = this.store.live();
    if (live.activity && !live.activity.token) {
      // Older servers kept a token-less placeholder in `activity`; it means the same as `pending`.
      this.store.setLive({ activity: null, pending: { startedAt: live.activity.startedAt || this.now() } });
      return this.tick();
    }
    const activity = live.activity;

    if (!activity && live.pending) {
      // The server started one and the phone hasn't reported its token yet. Starting another would stack a
      // second Live Activity on the lock screen, so wait; give up when my games are over or iOS would have
      // ended it anyway.
      if (window === 'off' || this.now() - live.pending.startedAt > MAX_AGE) this.store.setLive({ pending: null });
      return TICK;
    }

    if (activity) {
      const age = this.now() - (activity.startedAt || 0);
      // Ends with my last game. One started by hand when nothing is on (to try it out) gets an hour first.
      const over = window === 'off' && !(activity.manual && age < MANUAL_GRACE);
      if (over || age > MAX_AGE) {
        await this.end(activity, { immediate: !over });
        if (window !== 'off' && live.auto && live.pushToStart) await this.start(live.pushToStart);
        return window === 'off' ? IDLE_TICK : TICK;
      }
      const slide = this.feed.next();
      if (slide) await this.push(activity.token, updatePayload(slide, this.now()));
      return TICK;
    }

    if (window === 'live' && live.auto && live.pushToStart) { await this.start(live.pushToStart); return TICK; }
    return window === 'off' ? IDLE_TICK : TICK;
  }

  async start(pushToStart) {
    const slide = this.feed.next();
    if (!slide) return;
    const result = await this.apns.send(pushToStart, startPayload(slide, this.feed.board?.week ?? 0, this.now()));
    if (result.ok) this.store.setLive({ pending: { startedAt: this.now() } });
    else {
      this.log.warn?.(`Live Activity start failed: ${result.status} ${result.reason}`);
      if (result.gone) this.store.setLive({ pushToStart: null });
    }
  }

  // Ends it after my games, leaving the final score up for 30 minutes, or right away when replacing it.
  async end(activity, { immediate = false } = {}) {
    const slide = this.feed.scores()[0] || this.feed.current;
    if (slide) await this.apns.send(activity.token, endPayload(slide, this.now(), { immediate }));
    this.store.setLive({ activity: null });
  }

  // Ends a replaced Live Activity and removes it from the lock screen now.
  async dismiss(token) {
    const slide = this.feed.current || this.feed.scores()[0] || { kind: 'score' };
    try { await this.apns.send(token, endPayload(slide, this.now(), { immediate: true })); } catch {}
  }

  async push(token, payload) {
    const result = await this.apns.send(token, payload);
    if (!result.ok) {
      this.log.warn?.(`Live Activity update failed: ${result.status} ${result.reason}`);
      if (result.gone) this.store.setLive({ activity: null });
    }
    return result;
  }

  // Runs forever; each tick decides how long until the next.
  run({ setTimeout = globalThis.setTimeout } = {}) {
    const loop = async () => {
      let wait = IDLE_TICK;
      try { wait = await this.tick(); } catch (error) { this.log.error?.('Live Activity tick failed:', error.message); }
      setTimeout(loop, wait).unref?.();
    };
    setTimeout(loop, 1000).unref?.();
  }
}

const seconds = ms => Math.floor(ms / 1000);

export function updatePayload(slide, now) {
  const aps = { timestamp: seconds(now), event: 'update', 'content-state': slide, 'stale-date': seconds(now + 5 * 60 * 1000) };
  // An alert makes the Dynamic Island expand and the lock screen light up.
  if (slide.kind === 'touchdown') aps.alert = { title: 'Touchdown!', body: slide.text, sound: 'default' };
  return { aps };
}

export function startPayload(slide, week, now) {
  return { aps: {
    timestamp: seconds(now), event: 'start', 'content-state': slide, 'stale-date': seconds(now + 5 * 60 * 1000),
    'attributes-type': ATTRIBUTES_TYPE, attributes: { week },
    alert: { title: 'I Formation', body: 'Following your matchups live.' },
  } };
}

export function endPayload(slide, now, { immediate = false } = {}) {
  return { aps: { timestamp: seconds(now), event: 'end', 'content-state': slide, 'dismissal-date': seconds(immediate ? now : now + 30 * 60 * 1000) } };
}

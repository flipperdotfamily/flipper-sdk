/**
 * The coin's motion, ported from flipper.family's hero coin (apps/web/src/components/coin/Coin.tsx) without a motion
 * library: a small keyframe tween engine on requestAnimationFrame that writes transforms straight to the DOM (no
 * re-render per frame). Idle: floats and sways. Spinning: crouch, toss, spin at cruise speed until the randomness
 * lands. Revealed: decelerates onto the drawn face with no velocity seam, falls, clatters, reacts.
 */

export type CoinState =
  | { status: "idle" }
  | { status: "spinning" }
  | { status: "revealed"; side: "heads" | "tails"; won: boolean; key: string };

type Prop = "flip" | "omega" | "wobble" | "sway" | "y" | "squash" | "glow" | "dull";
type Ease = (t: number) => number;

const linear: Ease = (t) => t;
const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
const easeIn: Ease = (t) => t ** 3;
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutQuad: Ease = (t) => 1 - (1 - t) * (1 - t);
const easeInQuad: Ease = (t) => t * t;
const riseEase: Ease = (t) => cubicBezier(0.2, 0.8, 0.2, 1, t);

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  // Newton-Raphson on the x curve, then y(t)
  let t = x;
  for (let i = 0; i < 6; i++) {
    const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x;
    const dx = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
    if (Math.abs(dx) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - cx / dx));
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
}

interface Tween {
  frames: number[];
  times: number[];
  eases: Ease[];
  start: number;
  dur: number;
  mirror: boolean;
  resolve: (done: boolean) => void;
}

/**
 * requestAnimationFrame outside Angular's zone when zone.js is present: the idle float runs every frame, and inside
 * the app zone each frame would trigger a change detection pass over the whole host app.
 */
const raf = (cb: FrameRequestCallback): number => {
  const root = (globalThis as { Zone?: { root?: { run<T>(fn: () => T): T } } }).Zone?.root;
  return root ? root.run(() => requestAnimationFrame(cb)) : requestAnimationFrame(cb);
};

const SPIN_DPS = 1080; // cruise angular velocity while waiting on randomness (3 rev/s)
const MIN_TRAVEL = 720; // at least two more full turns after the result arrives
const REST_TILT = 12; // resting tilt so the rim stays visible
const APEX_RATIO = -0.34; // toss height as a share of the coin's rendered size

export interface CoinElements {
  stage: HTMLElement;
  lift: HTMLElement;
  coin: HTMLElement;
  halo: HTMLElement;
  shadow: HTMLElement;
  fx: HTMLElement;
}

export class CoinAnimator {
  private v: Record<Prop, number> = { flip: REST_TILT, omega: 0, wobble: 0, sway: -10, y: 0, squash: 1, glow: 0, dull: 0 };
  private tweens = new Map<Prop, Tween>();
  private spinning = false;
  private raf = 0;
  private last = 0;
  private visible = true;
  private state: CoinState = { status: "idle" };
  private revealKey: string | undefined;
  private io?: IntersectionObserver;
  private destroyed = false;
  onLanded?: (won: boolean, key: string) => void;

  constructor(
    private els: CoinElements,
    private reduced: () => boolean,
  ) {
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible) this.kick();
      });
      this.io.observe(els.stage);
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    this.render();
    this.enterIdle();
  }

  get stage(): HTMLElement {
    return this.els.stage;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.io?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const t of this.tweens.values()) t.resolve(false);
    this.tweens.clear();
  }

  private onVisibility = () => {
    if (!document.hidden) this.kick();
  };

  private get size() {
    return this.els.stage.offsetWidth || 96;
  }

  setState(next: CoinState) {
    const prev = this.state;
    this.state = next;
    if (next.status === "idle" && prev.status !== "idle") this.enterIdle();
    else if (next.status === "spinning" && prev.status !== "spinning") void this.toss();
    else if (next.status === "revealed" && next.key !== this.revealKey) {
      this.revealKey = next.key;
      void this.land(next.side, next.won, next.key);
    }
  }

  /** Re-apply the idle loops after reduced-motion changes. */
  refresh() {
    if (this.state.status === "idle") this.enterIdle();
  }

  // ── tween engine ────────────────────────────────────────────────────────────────────────────────────
  private to(prop: Prop, frames: number[], seconds: number, opts: { ease?: Ease | Ease[]; times?: number[]; mirror?: boolean } = {}): Promise<boolean> {
    this.tweens.get(prop)?.resolve(false);
    const kf = frames.length === 1 ? [this.v[prop], frames[0]!] : frames;
    const n = kf.length - 1;
    const times = opts.times ?? kf.map((_, i) => i / n);
    const eases = Array.isArray(opts.ease) ? opts.ease : Array.from({ length: n }, () => (opts.ease as Ease) ?? easeOut);
    return new Promise<boolean>((resolve) => {
      this.tweens.set(prop, { frames: kf, times, eases, start: performance.now(), dur: Math.max(1, seconds * 1000), mirror: !!opts.mirror, resolve });
      this.kick();
    });
  }

  private stop(...props: Prop[]) {
    for (const p of props) {
      this.tweens.get(p)?.resolve(false);
      this.tweens.delete(p);
    }
  }

  private kick() {
    if (this.destroyed || this.raf) return;
    this.last = performance.now();
    this.raf = raf(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.destroyed) return;
    const dt = Math.min(now - this.last, 64);
    this.last = now;
    for (const [prop, tw] of this.tweens) {
      let t = (now - tw.start) / tw.dur;
      let done = false;
      if (tw.mirror) {
        t = t % 2;
        if (t > 1) t = 2 - t;
      } else if (t >= 1) {
        t = 1;
        done = true;
      }
      let i = 0;
      while (i < tw.times.length - 2 && t > tw.times[i + 1]!) i++;
      const t0 = tw.times[i]!;
      const t1 = tw.times[i + 1]!;
      const local = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
      const a = tw.frames[i]!;
      const b = tw.frames[i + 1]!;
      this.v[prop] = a + (b - a) * (tw.eases[i] ?? linear)(local);
      if (done) {
        this.tweens.delete(prop);
        tw.resolve(true);
      }
    }
    if (this.spinning) this.v.flip += (this.v.omega * dt) / 1000;
    this.render();
    // keep going while anything moves; offscreen or hidden tabs pause (tweens resume from where time says)
    if ((this.tweens.size > 0 || this.spinning) && this.visible && !document.hidden) this.kick();
  };

  private render() {
    const { flip, wobble, sway, y, squash, glow, dull } = this.v;
    const { lift, coin, halo, shadow, stage } = this.els;
    lift.style.transform = `translateY(${y.toFixed(2)}px) scaleY(${squash.toFixed(4)})`;
    coin.style.transform = `rotateY(${sway.toFixed(2)}deg) rotateX(${(flip + wobble).toFixed(2)}deg)`;
    coin.style.setProperty("--spec", (((((flip % 360) + 360) % 360) / 360) as number).toFixed(4));
    halo.style.opacity = glow.toFixed(3);
    halo.style.transform = `scale(${(0.7 + 0.4 * glow).toFixed(3)})`;
    const apex = this.size * APEX_RATIO;
    const lifted = Math.min(1, Math.max(0, y / apex));
    shadow.style.transform = `scaleX(${(1 - 0.5 * lifted).toFixed(3)})`;
    shadow.style.opacity = (0.85 - 0.6 * lifted).toFixed(3);
    // a filter on the perspective root only while dulled: any filter flattens preserve-3d below it otherwise
    stage.style.filter = dull < 0.001 ? "" : `saturate(${(1 - 0.7 * dull).toFixed(3)}) brightness(${(1 - 0.2 * dull).toFixed(3)})`;
  }

  // ── phases ──────────────────────────────────────────────────────────────────────────────────────────
  private enterIdle() {
    if (this.spinning) {
      // back to idle mid-toss (wallet rejected, tx failed): settle on the nearest face
      this.spinning = false;
      this.v.omega = 0;
      const f = this.v.flip;
      void this.to("flip", [Math.round((f - REST_TILT) / 180) * 180 + REST_TILT], 0.7, { ease: easeOut });
    }
    void this.to("glow", [0], 0.6);
    void this.to("dull", [0], 0.6);
    void this.to("wobble", [0], 0.3);
    void this.to("squash", [1], 0.3);
    if (this.reduced()) {
      this.stop("y", "sway");
      void this.to("y", [0], 0.2);
      return;
    }
    const amp = Math.max(3, this.size * 0.045);
    void this.to("y", [this.v.y, -amp], 2.1, { ease: easeInOut, mirror: true });
    void this.to("sway", [this.v.sway, 12], 3.8, { ease: easeInOut, mirror: true });
  }

  private async toss() {
    this.revealKey = undefined;
    if (this.reduced()) {
      // no toss: a steady slow turn says "working" without motion across the screen
      this.stop("y", "sway");
      void this.to("y", [0], 0.2);
      void this.to("glow", [0], 0.3);
      void this.to("dull", [0], 0.3);
      return;
    }
    const apex = this.size * APEX_RATIO;
    this.v.flip = ((this.v.flip % 360) + 360) % 360; // keep the numbers small
    void this.to("glow", [0], 0.4);
    void this.to("dull", [0], 0.4);
    this.stop("y", "sway");
    await this.to("squash", [0.93], 0.12, { ease: easeIn });
    if (this.state.status !== "spinning") return;
    this.spinning = true;
    void this.to("squash", [0.93, 1.03, 1], 0.4, { ease: easeOut });
    void this.to("omega", [SPIN_DPS], 0.45, { ease: easeIn });
    void this.to("sway", [-8], 0.5, { ease: easeOut });
    const risen = await this.to("y", [apex], 0.5, { ease: riseEase });
    if (!risen || this.state.status !== "spinning") return;
    void this.to("y", [apex, apex + 8], 0.9, { ease: easeInOut, mirror: true });
  }

  private async land(side: "heads" | "tails", won: boolean, key: string) {
    const base = side === "heads" ? 0 : 180;
    if (this.reduced()) {
      this.stop("flip", "y", "sway", "omega");
      this.spinning = false;
      this.v.omega = 0;
      this.v.flip = base + REST_TILT;
      this.v.y = 0;
      this.v.sway = -10;
      if (won) this.v.glow = 0.6;
      else this.v.dull = 1;
      this.render();
      this.onLanded?.(won, key);
      return;
    }
    const w0 = Math.max(this.v.omega, 540);
    this.spinning = false;
    this.v.omega = 0;
    this.stop("omega", "y");
    const from = this.v.flip;
    const target = Math.ceil((from + MIN_TRAVEL - base - REST_TILT) / 360) * 360 + base + REST_TILT;
    // easeOutQuad starts at slope 2, so T = 2Δ/ω0 keeps the angular velocity continuous
    const T = (2 * (target - from)) / w0;
    const fall = Math.min(0.62, T * 0.45);
    const peak = this.size * APEX_RATIO - 10;
    const [ok] = await Promise.all([
      this.to("flip", [from, target], T, { ease: easeOutQuad }),
      this.to("y", [this.v.y, peak, 0], T, { times: [0, 1 - fall / T, 1], ease: [easeOut, easeInQuad] }),
      this.to("sway", [-10], T, { ease: easeOut }),
    ]);
    if (!ok || this.revealKey !== key) return;
    const k = this.size / 200;
    this.ripple(won);
    void this.to("squash", [0.9, 1.04, 1], 0.35, { ease: easeOut });
    void this.to("y", [0, (won ? -16 : -6) * k * 1.4, 0], 0.36, { times: [0, 0.45, 1], ease: [easeOut, easeInQuad] });
    void this.to("wobble", won ? [0, 10, -6, 3, -1, 0] : [0, 5, -2, 0], won ? 0.8 : 0.5, { ease: easeOut });
    if (won) {
      this.burst();
      void this.to("glow", [0, 1, 0.45], 1.2, { times: [0, 0.2, 1], ease: [easeOut, easeOut] });
      try {
        navigator.vibrate?.([12, 40, 18]);
      } catch {
        /* not allowed in this frame */
      }
    } else {
      void this.to("dull", [1], 0.7, { ease: easeOut });
    }
    this.onLanded?.(won, key);
  }

  /** Water ripple under the coin on every landing (three accent/gold rings on a win, one faint ring on a loss). */
  private ripple(won: boolean) {
    const host = this.els.fx;
    const rings = won ? [0, 140, 300] : [0];
    rings.forEach((delay, i) => {
      const el = document.createElement("span");
      el.className = i === 1 ? "ripple ripple--win" : "ripple";
      host.appendChild(el);
      const a = el.animate(
        [
          { transform: "translate(-50%, 0) scale(0.35)", opacity: 0 },
          { transform: `translate(-50%, 0) scale(${won ? 0.75 : 0.6})`, opacity: won ? 0.75 : 0.3, offset: 0.15 },
          { transform: `translate(-50%, 0) scale(${won ? 1.9 : 1.4})`, opacity: 0 },
        ],
        { duration: won ? 1300 : 1000, delay, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
      );
      a.onfinish = () => el.remove();
    });
  }

  /** Win only: a shockwave ring and droplets thrown out from the rim under gravity. */
  private burst() {
    const host = this.els.fx;
    const s = this.size;
    const ring = document.createElement("span");
    ring.className = "burst-ring";
    host.appendChild(ring);
    ring.animate([{ transform: "scale(.8)", opacity: 0.9 }, { transform: "scale(2.3)", opacity: 0 }], { duration: 800, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" }).onfinish = () =>
      ring.remove();
    const count = 26;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.35;
      const dist = s * (0.7 + Math.random() * 0.75);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist * 0.8;
      const el = document.createElement("span");
      el.className = `drop drop--${i % 5}`;
      el.style.width = `${Math.max(3, s * (0.03 + Math.random() * 0.04))}px`;
      el.style.height = `${Math.max(2, s * (0.015 + Math.random() * 0.015))}px`;
      host.appendChild(el);
      const spin = (Math.random() - 0.5) * 720;
      el.animate(
        [
          { transform: `translate(${dx * 0.35}px, ${dy * 0.35}px) rotate(0deg) scale(1)`, opacity: 1 },
          { transform: `translate(${dx * 0.85}px, ${dy * 0.85 - s * 0.15}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy + s * 0.45}px) rotate(${spin}deg) scale(.6)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 500, delay: Math.random() * 60, easing: "ease-out", fill: "both" },
      ).onfinish = () => el.remove();
    }
  }
}

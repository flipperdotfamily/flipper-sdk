import {
  animate,
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type MotionStyle,
} from "motion/react";
import { useEffect, useId, useRef } from "react";
import { DOLPHIN_D, FLUKE_D } from "./marks";

export type MiniCoinState = { status: "idle" } | { status: "spinning" } | { status: "revealed"; face: "heads" | "tails"; won: boolean };

const SPIN_DPS = 1080;
const MIN_TRAVEL = 720;
const REST_TILT = 14;
const RIM_LAYERS = 6;
const THICKNESS = 6;
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

/** A 64px chrome coin in CSS 3D: floats when idle, spins while randomness is pending, lands on the drawn face. */
export function MiniCoin({ state, onLanded }: { state: MiniCoinState; onLanded?: () => void }) {
  const reduce = useReducedMotion();
  const flip = useMotionValue(REST_TILT);
  const omega = useMotionValue(0);
  const sway = useMotionValue(-10);
  const y = useMotionValue(0);
  const glow = useMotionValue(0);
  const dull = useMotionValue(0);
  const spinning = useRef(false);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  const transform = useMotionTemplate`rotateY(${sway}deg) rotateX(${flip}deg)`;
  const spec = useTransform(flip, (v) => (((v % 360) + 360) % 360) / 360);
  const filter = useTransform(dull, (d) => (d === 0 ? "none" : `saturate(${1 - 0.7 * d}) brightness(${1 - 0.2 * d})`));

  useAnimationFrame((_, delta) => {
    if (spinning.current) flip.set(flip.get() + (omega.get() * Math.min(delta, 64)) / 1000);
  });

  useEffect(() => {
    if (state.status !== "idle") return;
    // Back to idle mid-spin (e.g. the wallet request was rejected): stop and settle on the nearest face.
    if (spinning.current) {
      spinning.current = false;
      omega.set(0);
      const v = flip.get();
      animate(flip, Math.round((v - REST_TILT) / 180) * 180 + REST_TILT, { duration: 0.6, ease: "easeOut" });
    }
    if (reduce) return;
    const loops = [
      animate(y, -4, { duration: 2.1, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" }),
      animate(sway, 10, { duration: 3.8, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" }),
      animate(glow, 0, { duration: 0.6 }),
      animate(dull, 0, { duration: 0.6 }),
    ];
    return () => loops.forEach((l) => l.stop());
  }, [state.status, reduce, y, sway, glow, dull, flip, omega]);

  useEffect(() => {
    if (state.status !== "spinning" || reduce) return;
    const running: AnimationPlaybackControls[] = [];
    flip.jump(((flip.get() % 360) + 360) % 360);
    spinning.current = true;
    running.push(
      animate(omega, SPIN_DPS, { duration: 0.45, ease: "easeIn" }),
      animate(y, [0, -6], { duration: 0.45, ease: "easeOut" }),
      animate(glow, 0, { duration: 0.3 }),
      animate(dull, 0, { duration: 0.3 }),
    );
    return () => running.forEach((a) => a.stop());
  }, [state.status, reduce, flip, omega, y, glow, dull]);

  const face = state.status === "revealed" ? state.face : undefined;
  const won = state.status === "revealed" ? state.won : undefined;
  useEffect(() => {
    if (face === undefined || won === undefined) return;
    const base = face === "heads" ? 0 : 180;
    let cancelled = false;
    if (reduce) {
      spinning.current = false;
      flip.set(base + REST_TILT);
      (won ? glow : dull).set(won ? 0.7 : 1);
      landed.current?.();
      return;
    }
    (async () => {
      const w0 = Math.max(omega.get(), 540);
      spinning.current = false;
      omega.set(0);
      const from = flip.get();
      const target = Math.ceil((from + MIN_TRAVEL - base - REST_TILT) / 360) * 360 + base + REST_TILT;
      const T = (2 * (target - from)) / w0; // easeOutQuad starts at slope 2: velocity-continuous
      await Promise.all([animate(flip, target, { duration: T, ease: easeOutQuad }), animate(y, 0, { duration: T, ease: "easeIn" })]);
      if (cancelled) return;
      animate(y, [0, won ? -6 : -2, 0], { duration: 0.34, ease: "easeOut" });
      if (won) animate(glow, [0, 1, 0.5], { duration: 1.1, times: [0, 0.2, 1], ease: "easeOut" });
      else animate(dull, 1, { duration: 0.6, ease: "easeOut" });
      landed.current?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, won, reduce]);

  return (
    <motion.div
      className="flw-stage"
      style={{ filter }}
      role="img"
      aria-label={state.status === "revealed" ? `Coin landed ${state.face}` : state.status === "spinning" ? "Coin flipping" : "Coin"}
    >
      <motion.div className="flw-halo" style={{ opacity: glow }} />
      <motion.div className="flw-coin-lift" style={{ y }}>
        <motion.div className="flw-coin" style={{ transform, "--flw-spec": spec } as MotionStyle}>
          {Array.from({ length: RIM_LAYERS }, (_, i) => (
            <div
              key={i}
              className="flw-rim"
              style={{ transform: `translateZ(${-THICKNESS / 2 + ((i + 0.5) * THICKNESS) / RIM_LAYERS}px)` }}
            />
          ))}
          <Face side="heads" />
          <Face side="tails" />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function Face({ side }: { side: "heads" | "tails" }) {
  const gid = useId().replace(/:/g, "");
  return (
    <div className={`flw-face flw-face--${side}`}>
      <svg className="flw-glyph" viewBox="0 0 100 100" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f0faff" />
            <stop offset=".55" stopColor="#4cc2ff" />
            <stop offset="1" stopColor="#f5c451" />
          </linearGradient>
        </defs>
        {side === "heads" ? (
          <path fill={`url(#${gid})`} fillRule="evenodd" transform="translate(11 26) scale(.41)" d={DOLPHIN_D} />
        ) : (
          <path fill={`url(#${gid})`} d={FLUKE_D} />
        )}
      </svg>
    </div>
  );
}

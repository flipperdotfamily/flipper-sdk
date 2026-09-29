// Tests for @flipperdotfamily/sdk/avatar. `pnpm test` bundles src/avatar into .test-dist first, then runs these with node:test.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AVATAR_ANGLES,
  AVATAR_ANIMALS,
  AVATAR_COMBINATIONS,
  AVATAR_DISCS,
  AVATAR_HIGHLIGHTS,
  AVATAR_SILHOUETTES,
  AVATAR_TABLE_SIZES,
  AVATAR_TINTS,
  AVATAR_VERSION,
  avatarDataUri,
  avatarSpec,
  avatarSvg,
  composeAvatarSpec,
  renderAvatar,
} from "../.test-dist/index.js";

const SIZES = AVATAR_TABLE_SIZES[AVATAR_VERSION];
const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

/** 10k reproducible random addresses (mulberry32), so a failure can be replayed */
function addresses(count, seed = 0xf11bbe7) {
  let a = seed;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return Array.from({ length: count }, () => "0x" + Array.from({ length: 5 }, () => rand().toString(16).padStart(8, "0")).join(""));
}

/** a strict-enough XML check: one root <svg>, balanced tags, quoted attributes, no stray text */
function assertWellFormed(svg) {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
  assert.ok(svg.endsWith("</svg>"));
  assert.doesNotMatch(svg, /NaN|undefined|null|Infinity/);
  const stack = [];
  let rest = svg;
  while (rest.length) {
    const m = /^<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/.exec(rest);
    if (m) {
      const [whole, close, name, , selfClose] = m;
      if (close) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
      else if (!selfClose) stack.push(name);
      rest = rest.slice(whole.length);
      continue;
    }
    const text = /^[^<]+/.exec(rest);
    assert.ok(text, `unparseable markup at: ${rest.slice(0, 60)}`);
    assert.equal(stack.at(-1), "title", `text outside <title>: ${text[0].slice(0, 40)}`);
    assert.doesNotMatch(text[0], /[<>"]|&(?!amp;|lt;|gt;|quot;|#39;)/);
    rest = rest.slice(text[0].length);
  }
  assert.equal(stack.length, 0, `unclosed: ${stack.join(",")}`);
}

const ids = (svg) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const refs = (svg) => [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);

// WCAG relative luminance / contrast, for the palette checks
const lum = (hex) => {
  const v = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [v >> 16, (v >> 8) & 255, v & 255].map((c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("determinism", () => {
  test("the same address always gives the same spec and SVG", () => {
    for (const a of addresses(200)) {
      assert.deepEqual(avatarSpec(a), avatarSpec(a));
      assert.equal(avatarSvg(a, { size: 48 }), avatarSvg(a, { size: 48 }));
      assert.equal(avatarDataUri(a), avatarDataUri(a));
    }
  });

  test("golden vectors pin the algorithm (hash, pick order, tables): a change here reshuffles every user", () => {
    const pick = (a) => {
      const s = avatarSpec(a);
      return [s.seed, s.animal.name, s.disc.name, s.tint.name, s.angle.index, s.highlight.index];
    };
    assert.deepEqual(pick(CHECKSUMMED), GOLDEN[CHECKSUMMED]);
    assert.deepEqual(pick("0x0000000000000000000000000000000000000000"), GOLDEN.zero);
    assert.deepEqual(pick("vitalik.eth"), GOLDEN.ens);
  });

  test("different addresses mostly differ", () => {
    const all = addresses(2000).map((a) => avatarSvg(a));
    assert.ok(new Set(all).size > 1950);
  });
});

describe("case-insensitivity", () => {
  test("checksummed, lower, upper and padded forms match", () => {
    const lower = CHECKSUMMED.toLowerCase();
    const upper = "0x" + CHECKSUMMED.slice(2).toUpperCase();
    const want = avatarSvg(lower);
    for (const form of [CHECKSUMMED, upper, `  ${CHECKSUMMED}\n`]) assert.equal(avatarSvg(form), want);
    assert.equal(avatarSpec(CHECKSUMMED).input, lower);
  });

  test("random mixed-case addresses match their lowercase form", () => {
    for (const a of addresses(300)) {
      const mixed = a.replace(/[a-f]/g, (c, i) => (i % 2 ? c.toUpperCase() : c));
      assert.deepEqual(avatarSpec(mixed), avatarSpec(a));
    }
  });
});

describe("distribution over 10k random addresses", () => {
  const specs = addresses(10_000).map((a) => avatarSpec(a));

  /** every bucket within ±tolerance of uniform, and a chi-square statistic below a generous bound */
  function assertUniform(label, values, buckets, tolerance = 0.2) {
    const counts = new Array(buckets).fill(0);
    for (const v of values) counts[v]++;
    const expected = values.length / buckets;
    for (const [i, c] of counts.entries()) {
      assert.ok(Math.abs(c - expected) <= expected * tolerance, `${label} ${i}: ${c} vs ~${expected.toFixed(0)}`);
    }
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // p ≈ 0.001 critical values are about df + 3.1·√(2·df); use a looser df + 4·√(2·df)
    const df = buckets - 1;
    assert.ok(chi2 < df + 4 * Math.sqrt(2 * df), `${label}: χ² = ${chi2.toFixed(1)} over ${df} df`);
  }

  test("animals", () => assertUniform("animal", specs.map((s) => s.animal.index), SIZES.animals));
  test("discs", () => assertUniform("disc", specs.map((s) => s.disc.index), SIZES.discs));
  test("tint slots", () => assertUniform("tint slot", specs.map((s) => s.tint.slot), SIZES.tintsPerDisc));
  test("gradient angles", () => assertUniform("angle", specs.map((s) => s.angle.index), SIZES.angles));
  test("highlights", () => assertUniform("highlight", specs.map((s) => s.highlight.index), SIZES.highlights));
  test("animal and disc are independent (joint χ²)", () => {
    const counts = new Map();
    for (const s of specs) counts.set(s.animal.index * 100 + s.disc.index, (counts.get(s.animal.index * 100 + s.disc.index) ?? 0) + 1);
    const cells = SIZES.animals * SIZES.discs;
    const expected = specs.length / cells;
    let chi2 = 0;
    for (let a = 0; a < SIZES.animals; a++) for (let d = 0; d < SIZES.discs; d++) chi2 += ((counts.get(a * 100 + d) ?? 0) - expected) ** 2 / expected;
    assert.ok(chi2 < cells - 1 + 4 * Math.sqrt(2 * (cells - 1)), `χ² = ${chi2.toFixed(0)} over ${cells - 1} df`);
  });

  test("combinations: ≥ 10k possible, and 10k users spread over them like independent draws", () => {
    assert.ok(AVATAR_COMBINATIONS >= 10_000, `${AVATAR_COMBINATIONS}`);
    const keys = new Set(specs.map((s) => [s.animal.index, s.disc.index, s.tint.slot, s.angle.index, s.highlight.index].join(".")));
    // expected distinct for n draws from M slots: M·(1 − e^(−n/M)) ≈ 8,650 for n = 10k, M = 33,600
    const want = AVATAR_COMBINATIONS * (1 - Math.exp(-specs.length / AVATAR_COMBINATIONS));
    assert.ok(keys.size > want - 250, `${keys.size} distinct, ~${want.toFixed(0)} expected`);
  });
});

describe("SVG output", () => {
  test("is well-formed for every animal on every disc and tint, with every angle and highlight, small and large", () => {
    for (let animal = 0; animal < SIZES.animals; animal++) {
      for (let disc = 0; disc < SIZES.discs; disc++) {
        const spec = composeAvatarSpec({ animal, disc, slot: animal + disc, angle: animal + disc, highlight: animal + 2 * disc });
        for (const size of [20, 128]) assertWellFormed(renderAvatar(spec, { size }));
      }
    }
  });

  test("follows the site icon's layout: disc r 30 with a 40% rim, highlight ellipse, one evenodd silhouette", () => {
    const svg = avatarSvg(CHECKSUMMED, { size: 64 });
    assert.match(svg, /<circle cx="32" cy="32" r="30" fill="url\(#[^)]+b\)" stroke="#[0-9A-F]{6}" stroke-opacity=".4" stroke-width="2"\/>/);
    assert.match(svg, /<ellipse cx="[\d.]+" cy="[\d.]+" rx="15" ry="7" fill="url\(#[^)]+h\)"\/>/);
    assert.equal(svg.match(/<path /g).length, 1);
    assert.match(svg, /<path fill="url\(#[^)]+f\)" fill-rule="evenodd" d="M/);
    assert.match(svg, /<radialGradient id="[^"]+b" cx="[\d.]+" cy="[\d.]+" r=".84">(<stop [^>]+\/>){3}<\/radialGradient>/);
  });

  test("random addresses render well-formed SVG", () => {
    for (const a of addresses(500)) assertWellFormed(avatarSvg(a, { size: 64 }));
  });

  test("ids are unique within an avatar and every url(#…) points at one of them", () => {
    for (const a of addresses(200)) {
      const svg = avatarSvg(a);
      const own = ids(svg);
      assert.equal(new Set(own).size, own.length);
      for (const r of refs(svg)) assert.ok(own.includes(r), `dangling url(#${r})`);
    }
  });

  test("two different avatars on one page never share an id", () => {
    const seen = new Map();
    for (const a of addresses(2000)) {
      for (const id of ids(avatarSvg(a))) {
        assert.ok(!seen.has(id) || seen.get(id) === a.toLowerCase(), `id ${id} shared by ${seen.get(id)} and ${a}`);
        seen.set(id, a.toLowerCase());
      }
    }
  });

  test("idPrefix scopes the ids (for inlining the same address twice), and is sanitised", () => {
    const one = avatarSvg(CHECKSUMMED, { idPrefix: "menu" });
    const two = avatarSvg(CHECKSUMMED, { idPrefix: "header" });
    assert.ok(ids(one).every((id) => id.startsWith("menu")));
    assert.equal(ids(one).filter((id) => ids(two).includes(id)).length, 0);
    const odd = avatarSvg(CHECKSUMMED, { idPrefix: ':r1:"><script>' });
    assertWellFormed(odd);
    assert.ok(ids(odd).every((id) => /^[A-Za-z_][\w-]*$/.test(id)));
    assert.ok(ids(avatarSvg(CHECKSUMMED, { idPrefix: "9lives" })).every((id) => /^[A-Za-z_]/.test(id)));
  });

  test("decorative by default; a title makes it a labelled image and is escaped", () => {
    assert.match(avatarSvg(CHECKSUMMED), /<svg [^>]*aria-hidden="true"/);
    assert.doesNotMatch(avatarSvg(CHECKSUMMED), /<title>/);
    const titled = avatarSvg(CHECKSUMMED, { title: `Tom & "Jerry" <3 it's` });
    assertWellFormed(titled);
    assert.match(titled, /role="img" aria-label="Tom &amp; &quot;Jerry&quot; &lt;3 it&#39;s"/);
    assert.match(titled, /<title>Tom &amp; &quot;Jerry&quot; &lt;3 it&#39;s<\/title>/);
  });
});

describe("size scaling", () => {
  test("width and height follow size; the 64 x 64 viewBox never changes", () => {
    for (const size of [20, 32, 64, 128, 256]) {
      const svg = avatarSvg(CHECKSUMMED, { size });
      assert.match(svg, new RegExp(`viewBox="0 0 64 64" width="${size}" height="${size}"`));
    }
  });

  test("the rim is the icon's 2 units, and never thinner than 0.75px on screen", () => {
    for (const size of [8, 12, 16, 20, 24, 32, 64, 128, 256]) {
      const w = Number(/stroke-width="([\d.]+)"/.exec(avatarSvg(CHECKSUMMED, { size }))[1]);
      assert.ok(w >= 2, `rim ${w} units at ${size}px`);
      assert.ok(w * (size / 64) >= 0.749, `rim at ${size}px is ${(w * size / 64).toFixed(2)}px`);
      if (size >= 24) assert.equal(w, 2);
    }
  });

  test("defaults to 64 and clamps nonsense", () => {
    assert.match(avatarSvg(CHECKSUMMED), /width="64" height="64"/);
    for (const [input, want] of [[0, 64], [-5, 64], [NaN, 64], [Infinity, 64], [2, 8], [5000, 1024], [31.6, 32]]) {
      assert.match(avatarSvg(CHECKSUMMED, { size: input }), new RegExp(`width="${want}" height="${want}"`), `size ${input}`);
    }
  });

  test("the size changes only presentation, never which avatar it is", () => {
    const stripped = (s) => s.replace(/ width="\d+" height="\d+"/, "").replace(/ stroke-width="[\d.]+"/, "");
    assert.equal(stripped(avatarSvg(CHECKSUMMED, { size: 20 })), stripped(avatarSvg(CHECKSUMMED, { size: 256 })));
  });
});

describe("data URI", () => {
  test("is a compact, URL-safe image/svg+xml URI that decodes back to the SVG", () => {
    const uri = avatarDataUri(CHECKSUMMED, { size: 40, title: "Größe #1 🐧" });
    assert.ok(uri.startsWith("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'"), uri.slice(0, 60));
    assert.doesNotMatch(uri.slice("data:image/svg+xml,".length), /["#<>\n\r\t{}|\\^`]|[^\x20-\x7E]/); // spaces are fine in a quoted URI
    assert.equal(decodeURIComponent(uri.slice("data:image/svg+xml,".length)), avatarSvg(CHECKSUMMED, { size: 40, title: "Größe #1 🐧" }).replace(/"/g, "'"));
  });
});

describe("tables", () => {
  test("the current version's slices exist and are well-formed", () => {
    assert.equal(AVATAR_ANIMALS.length, SIZES.animals);
    assert.equal(new Set(AVATAR_ANIMALS).size, AVATAR_ANIMALS.length);
    assert.ok(!AVATAR_ANIMALS.includes("dolphin"), "the dolphin is the brand mark");
    assert.ok(AVATAR_SILHOUETTES.length >= SIZES.animals);
    assert.ok(AVATAR_DISCS.length >= SIZES.discs);
    assert.ok(AVATAR_ANGLES.length >= SIZES.angles);
    assert.ok(AVATAR_HIGHLIGHTS.length >= SIZES.highlights);
    assert.equal(AVATAR_COMBINATIONS, SIZES.animals * SIZES.discs * SIZES.tintsPerDisc * SIZES.angles * SIZES.highlights);
    for (const d of AVATAR_DISCS) {
      assert.equal(d.tints.length, SIZES.tintsPerDisc, d.name);
      assert.equal(new Set(d.tints).size, d.tints.length, `${d.name}: duplicate tint`);
      assert.equal(d.stops.length, 3, d.name);
      for (const t of d.tints) assert.ok(AVATAR_TINTS[t], `${d.name} → tint ${t}`);
    }
    for (const t of AVATAR_TINTS) assert.equal(t.stops.length, 2, t.name);
  });

  test("every silhouette is plain absolute path data that stays inside the disc", () => {
    for (const { name, d } of AVATAR_SILHOUETTES) {
      assert.match(d, /^M[-\d. MCLZ]+$/, name);
      const nums = d.match(/-?\d*\.?\d+/g).map(Number);
      assert.equal(nums.length % 2, 0, name);
      for (let i = 0; i < nums.length; i += 2) {
        const r = Math.hypot(nums[i] - 32, nums[i + 1] - 32);
        assert.ok(r <= 28.5, `${name}: point (${nums[i]}, ${nums[i + 1]}) is ${r.toFixed(1)} from the centre`);
      }
      assert.ok(d.length < 7000, `${name}: ${d.length} chars`);
    }
    const total = AVATAR_SILHOUETTES.reduce((n, a) => n + a.d.length, 0);
    assert.ok(total < 40_000, `all silhouettes: ${total} chars`);
  });

  test("every tint reads on every disc it can land on (each tint stop vs each disc stop ≥ 4.5:1)", () => {
    for (const disc of AVATAR_DISCS) {
      for (const tint of disc.tints.map((i) => AVATAR_TINTS[i])) {
        for (const t of tint.stops) {
          for (const d of disc.stops) assert.ok(contrast(t, d) >= 4.5, `${tint.name} ${t} on ${disc.name} ${d}: ${contrast(t, d).toFixed(2)}`);
        }
      }
    }
  });

  test("the discs are deep ocean colours: dark at the rim, like the icon", () => {
    for (const d of AVATAR_DISCS) {
      assert.ok(lum(d.stops[2]) < 0.01, `${d.name} rim ${d.stops[2]}`);
      assert.ok(lum(d.stops[0]) < 0.08, `${d.name} centre ${d.stops[0]}`);
    }
  });
});

// seed, animal, disc, tint, angle index, highlight index: ports of the algorithm (Swift, Kotlin, Dart) must match these
const GOLDEN = {
  [CHECKSUMMED]: ["6d066e05", "hammerhead shark", "abyss green", "lilac", 3, 3],
  zero: ["cbc2b695", "emperor penguin", "midnight violet", "gold", 3, 1],
  ens: ["832aee2c", "emperor penguin", "coral dusk", "seafoam", 0, 1],
};

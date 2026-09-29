# Avatar silhouettes: sources

The 25 silhouettes in `animals.ts` are in the site icon's format: the 64 × 64 frame of `apps/web/src/app/icon.svg`,
inside the r = 30 disc, facing right like the $FLIPPER dolphin. The dolphin itself is left out, because it is the
brand mark.

Every traced shape started from a [PhyloPic](https://www.phylopic.org) silhouette released under
**CC0 1.0** or marked **Public Domain (PDM 1.0)**. No CC-BY, BY-NC or BY-SA images were used, and neither licence
requires attribution. Contributors are listed below anyway, as a courtesy and for provenance.

## How the shapes were made

1. The reference SVG was rasterised to a 1000 px mask. It was mirrored where needed, so every animal faces right.
2. It was posed:
   - swimmers got a head-up tilt and an arc bend for a gliding or leaping pose, the way the brand dolphin was bent;
   - top-down animals (green turtle, hammerhead, manta) head up and to the right.
3. It was fitted into the icon frame (within about r 27 of the centre) and smoothed. Repeated blur-and-threshold passes
   act like curvature flow: jaggies and hairline fins go, big shapes stay. Feathered extra smoothing was used on feet,
   tails and flipper roots, so no seams are left.
4. Interior detail follows the outline exactly or isn't there. Details that couldn't be made exact were removed: the
   orca's chin patch, the humpback's mouth line, the emperor's belly line and the puffin's beak stripe. What remains:
   - an eye hole on every animal;
   - the orca's eye patch;
   - the turtles' shell patterns, generated from the carapace itself. The carapace is the green turtle's own shell
     shape, or the leatherback's body with its flippers and head opened away. It's inset, then the seams follow its
     principal axis and its width profile (a smooth polynomial fit), clipped inside it.
5. Hand-built shapes (see the table) were drawn from primitives, including tapering chains of circles for bodies and
   necks, then blended by the same smoothing. So every join is one continuous curve.
6. The result was re-traced with potrace (smooth cubic curves) and written in icon units to one decimal.
   Holes use `fill-rule="evenodd"`.

To change a shape, regenerate it the same way rather than hand-editing the path data. The tables are append-only (see
`palette.ts`): the art can change, but the order can't.

## Per animal

| # | Animal | Source (PhyloPic) | Licence | Contributor | Changes |
|---|---|---|---|---|---|
| 1 | orca | [c8cbec13](https://www.phylopic.org/images/c8cbec13-a69c-40d8-836b-902a6b1defcf) *Orcinus orca* | CC0 1.0 | not credited | mirrored; smoothed; eye and eye-patch holes |
| 2 | humpback whale | [fd8d3e5e](https://www.phylopic.org/images/fd8d3e5e-24a0-4aa2-9211-987ff86007dd) *Megaptera novaeangliae* (listed as *Balaenoptera*) | PDM 1.0 | not credited | mirrored, tilted 14°, bent; long pectoral flipper added and blended in; smoothed; eye |
| 3 | blue whale | [6ca9f0b7](https://www.phylopic.org/images/6ca9f0b7-cacb-45cc-9229-1b672d55b15b) *Balaenoptera musculus* | PDM 1.0 | not credited | mirrored, tilted 12°, bent; smoothed; eye |
| 4 | sperm whale | [2756dc6c](https://www.phylopic.org/images/2756dc6c-79a4-4507-a486-3cc613671a54) *Physeter macrocephalus* | PDM 1.0 | not credited | mirrored, tilted 10°, bent; smoothed; eye |
| 5 | beluga | [87aa96fa](https://www.phylopic.org/images/87aa96fa-43c7-42ea-b9ef-92d8ba432cc3) *Delphinapterus leucas* | CC0 1.0 | Steven Traver | mirrored; belly smoothed; eye |
| 6 | narwhal | [d2616332](https://www.phylopic.org/images/d2616332-2584-4504-a463-2bf6f9fc6412) *Monodon monoceros* | CC0 1.0 | not credited | mirrored, tilted 20°, bent; tail stub replaced by a spread fluke; eye |
| 7 | harbour porpoise | [81441ece](https://www.phylopic.org/images/81441ece-7fda-457e-b6ef-c2c84f08dffb) *Phocoena phocoena* | CC0 1.0 | Alexandra Hahn | diving pose, tilted 18°; hooked tail tip replaced by a spread fluke; smoothed; eye. Chosen over a leaping pose so it can't be mistaken for the brand dolphin. |
| 8 | harbour seal | hand-built | — | flipper.family | built from primitives (plump body, round head, fanned hind flippers) in the "banana" haul-out pose, blended and traced; eye |
| 9 | sea lion | [7323c100](https://www.phylopic.org/images/7323c100-a6f6-4e0c-b81c-64ae355e5952) *Zalophus wollebaeki* | CC0 1.0 | not credited | mirrored; upright pose kept; smoothed; eye |
| 10 | walrus | [d2575005](https://www.phylopic.org/images/d2575005-1fcb-4a86-8c83-e3bda619adf2) *Odobenus rosmarus* | CC0 1.0 | Margot Michaud | underside smoothed; eye |
| 11 | elephant seal | [d5cb6d50](https://www.phylopic.org/images/d5cb6d50-6d1e-4e9c-a9c2-4a4e6fe025a1) *Mirounga angustirostris* | CC0 1.0 | Margot Michaud | head smoothed; eye |
| 12 | leopard seal | [9344d62d](https://www.phylopic.org/images/9344d62d-b882-4f2e-b416-f9101752ab32) *Hydrurga leptonyx* | CC0 1.0 | Margot Michaud | mirrored, tilted 10°, bent; foreflipper added; smoothed; eye |
| 13 | sea otter | hand-built, proportions from [d1e9b847](https://www.phylopic.org/images/d1e9b847-ab06-4663-8095-c65c08bfe21e) *Enhydra lutris* | CC0 1.0 (reference) | flipper.family (reference not credited) | built from primitives: floating on its back on a gently curved body; raised head with a short muzzle and ear bumps; both forepaws up on the chest holding a round clam, set off by a clear gap; hind feet and tail tip poking up; eye |
| 14 | manatee | [d88fc903](https://www.phylopic.org/images/d88fc903-0deb-4b78-b2fd-7c15d206d3f9) *Trichechus senegalensis* | CC0 1.0 | Steven Traver | mirrored, tilted 6°; smoothed; eye |
| 15 | dugong | hand-built, proportions from [d88fc903](https://www.phylopic.org/images/d88fc903-0deb-4b78-b2fd-7c15d206d3f9) (no CC0 dugong exists on PhyloPic) | CC0 1.0 (reference) | flipper.family (reference: Steven Traver) | one tapering body with a downturned muzzle, flowing into a whale-like fluke; flipper; eye |
| 16 | green sea turtle | hand-built, proportions from [09e1c81c](https://www.phylopic.org/images/09e1c81c-459f-4b44-b475-546380fa1998) *Chelonia mydas* | CC0 1.0 (reference) | flipper.family (reference: Edwin Price) | top-down, heading up-right: oval carapace, head, four flippers; scute ring and seams generated inside the carapace; eyes |
| 17 | leatherback turtle | [1c65c811](https://www.phylopic.org/images/1c65c811-4caa-4be3-9936-7a16e6905131) *Dermochelys coriacea* | CC0 1.0 | James R. Spotila and Ray Chatterji | tilted 6°; smoothed; two carapace ridges that follow the carapace's curve (derived from the outline); eye |
| 18 | emperor penguin | [f2e02022](https://www.phylopic.org/images/f2e02022-2700-484d-a66d-b2a900030371) *Aptenodytes forsteri* | CC0 1.0 | not credited | mirrored; bill notch filled; feet smoothed; eye |
| 19 | rockhopper penguin | hand-built, proportions from [f1f4ad6a](https://www.phylopic.org/images/f1f4ad6a-c11b-46e1-9f01-7a325d1b7bc5) *Eudyptes chrysocome filholi* | CC0 1.0 (reference) | flipper.family (reference: Alexandre Vong) | built from primitives: stocky body, short stout bill, two swept-back crest spikes, flippers at a natural angle, feet; eye |
| 20 | puffin | [18ff6244](https://www.phylopic.org/images/18ff6244-3ec9-4750-a29a-aaad7e2f14ad) *Fratercula arctica* | CC0 1.0 | Ferran Sayol | mirrored; tail smoothed; eye |
| 21 | mallard duck | [97f833ff](https://www.phylopic.org/images/97f833ff-fcd8-4113-8948-721c75372462) *Anas platyrhynchos* | CC0 1.0 | Andy Wilson | mirrored; smoothed; eye |
| 22 | platypus | [162021b6](https://www.phylopic.org/images/162021b6-349b-4a64-906f-33d4a191b30e) *Ornithorhynchus anatinus* | CC0 1.0 | Rachel T Mason | tilted 6°, bent; open bill closed; smoothed; eye |
| 23 | manta ray | [0c459848](https://www.phylopic.org/images/0c459848-4b59-46ce-b5aa-ff0aa265c07f) *Mobula birostris* | CC0 1.0 | not credited | whip tail shortened; refitted |
| 24 | hammerhead shark | hand-built, proportions from [20c3f743](https://www.phylopic.org/images/20c3f743-cf61-4d7a-8fcb-f422f5d12557) *Sphyrna* | CC0 1.0 (reference) | flipper.family (reference not credited) | top-down, heading up-right, so the T-shaped head reads at any size: hammer, tapering body, swept pectoral fins, tail; eyes at the hammer's tips |
| 25 | plesiosaur | hand-built, proportions from [d3a6f6eb](https://www.phylopic.org/images/d3a6f6eb-1b95-4d5f-9c3b-99d8b271911a) *Tuarangisaurus keyesi* | CC0 1.0 (reference) | Arthur S. Brum (reference) | built from primitives (body, four flippers, tail, and a swan-curved neck as one tapering chain, thicker than the reference so it reads at 20 px); eye |

The licences were checked against the PhyloPic API (build 558).

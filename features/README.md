# Gherkin scenarios

One directory per feature area, `.feature` and its `.steps.ts` side by
side:

```
features/
  tooling/
    smoke.feature
    smoke.steps.ts
  <area>/
    <story-slug>.feature
    <story-slug>.steps.ts
```

- `product-owner-bdd` writes the `.feature` file (story comment at the
  top, `Étant donné/Quand/Alors` or `Given/When/Then` scenarios below).
- The engineer implementing the story, or `xr-visual-qa` for
  verification-only steps, writes the matching `.steps.ts`.
- Steps come in two kinds — do not conflate them. **DOM steps** (page
  loads, titles, the desktop HUD overlays) are plain Playwright.
  **In-scene steps** (an NPC interaction, a grab, a trade — anything
  inside the 3D scene) go through IWSDK's agent command bridge
  (simulated controller/ray input, ECS assertions — see `iwsdk-debug`
  and `iwsdk-ray`), never `page.click()` on the canvas: the canvas is a
  single opaque element to Playwright.
- Multiplayer scenarios use multiple Playwright browser contexts in one
  test — two players are two `browser.newContext()` pages against the
  same server, the automated equivalent of the demo README's "open the
  page in two tabs". Ownership races, reconciliation, and spawn/despawn
  scenarios need at least two; never write them assuming a single
  client.
- Run everything: `pnpm test:bdd`. Run one file:
  `pnpm exec playwright test features/<area>/<story-slug>.feature`.
- New scenarios drive Playwright against `apps/demo`'s plain-Vite dev
  server (`dev:runtime`, port 8081) via `playwright.config.ts`'s
  `webServer`, which runs `pnpm build` first (the demo imports compiled
  workspace packages) — this is separate from the CLI-managed
  `iwsdk dev up` flow used for interactive agent-driven browser
  verification.

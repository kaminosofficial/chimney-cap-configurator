# How changes get shipped (staging & safe deploys)

The short, plain-English guide to how a change goes from "an idea" to "live on
the client's site" — **safely**. You don't need to memorise commands; you can
just ask Claude Code to do each step. This explains *what* each step is so the
words stop being confusing.

---

## The mental model

Think of it like editing a published book:

| Word | What it actually means |
|------|------------------------|
| **`main`** | The published edition. Whatever is here is **LIVE** on the client's site. |
| **branch** | A private draft copy. Change anything here without touching the live site. |
| **preview** | A private web link showing your draft running for real, so you can click through it before anyone else sees it. |
| **Pull Request (PR)** | The "ready to publish?" gate. Shows exactly what changed and runs the automatic check. Nothing reaches `main` except through it. |
| **merge** | Pressing *publish*. Your draft becomes the live edition. |

> **Golden rule: never work directly on `main`.** Always go
> **branch → preview → PR → merge.**

---

## The flow, step by step

1. **Start a branch** for the change (e.g. `fix/cart-button-color`).
2. **Make the change** on that branch and save it (a *commit*).
3. **Push the branch** to GitHub. This automatically:
   - builds a **preview link** (see per-repo note below), and
   - runs the **automatic check** (does it still build? any type errors?).
4. **Test on the preview link** — on your phone **and** a desktop browser.
5. **Open a Pull Request.** Look at the list of changes; wait for the green check ✓.
6. **Merge** when it's green and you're happy. The live site updates.

If anything is wrong, you fix it on the branch and push again — **the live site
is never affected until you merge.**

---

## The automatic check ("CI")

Every push and every PR runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml),
which installs the project and runs the full production build
(`npm run build:vercel`). That build also type-checks the entire codebase.

- **Green ✓** — it compiles and bundles cleanly; safe to merge.
- **Red ✗** — something is broken; **do not merge** until it's green.

This is the safety net against "I changed one thing and accidentally broke
another." The check does **not** deploy — it only verifies.

---

## Preview links — per repo

- **Chase cover** (`chase-cover-configurator`): connected to Vercel's GitHub app,
  so **every branch/PR gets an automatic preview URL** (Vercel posts it as a
  comment on the PR). Merging to `main` deploys to production automatically.
- **Chimney cap** (`chimney-cap-configurator`): the Vercel GitHub app is **not
  connected yet**, so previews are not automatic. Two options:
  - **Quick:** ask Claude to run `vercel deploy` (without `--prod`) — it prints a
    private preview URL built from the current code.
  - **Better (one-time):** connect the Vercel GitHub app to this repo in the
    Vercel dashboard so cap behaves exactly like chase.

  *Recommended: wire cap up like chase so both repos behave the same.*

---

## Definition of done — before telling the client it's finished

- [ ] Tested on a real phone **and** a desktop browser (on the preview link)
- [ ] Failure / slow-network / bad-input behave gracefully (no dead ends)
- [ ] The automatic check is green ✓
- [ ] Changes went through a **branch + PR** (not pushed straight to `main`)
- [ ] No secrets (tokens / keys) in the code — only in environment variables
- [ ] Docs updated if something meaningful changed (`AGENTS.md` / `claude.md` + the README)

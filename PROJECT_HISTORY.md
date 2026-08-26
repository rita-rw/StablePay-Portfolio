# Project History

StablePay started as a team-built prototype during an internship. I copied the codebase into this standalone repository and have maintained it solo since — **every commit in this repo's history is my own work**; the original team-authored history lives in the internship's private repo and isn't part of this one.

This document tracks what I've done since taking it over solo, mainly to prepare the project for a public, recruiter-facing release.

## Repo hardening & privacy cleanup
- Audited the full git history for leaked secrets, private keys, or credentials before making the repo public — none found
- Tightened `.gitignore` across all four subprojects (root, backend, frontend, smart contracts)
- Removed personal/editor configuration (`.cursor/`, `.vscode/`) and internal planning docs (~7,000+ lines of team notes, roadmaps, and archived summaries) from public tracking, keeping them privately and correctly gitignored instead

## Documentation
- Rewrote all four READMEs (root, backend, frontend, smart contracts): fixed outdated information (Next.js version, test counts), fully documented every environment variable, added on-chain verification links to Basescan
- Added the MIT `LICENSE`
- Updated internal reference docs (`CONTRACT_SUMMARY.md`) to match the current contract behavior

## Bug fixes
- Fixed the wallet connect button showing the wrong network after a successful login

## Pre-publish audit (2026-08-26)
Ran a full audit before publishing, covering:
- **Security** — confirmed no secrets in git history, `.env.example` files match actual usage, no hardcoded keys in source
- **Smart contracts** — confirmed all 109 tests pass (`forge test`), full NatSpec coverage on public functions
- **Backend** — confirmed no leftover debug code, stub endpoints, or `any`-typed shortcuts
- **Dead code** — found and removed unused `isResolvable()`/`isTimeoutReady()` helpers in the frontend; verified the correction-window logic that replaced them is consistent across the smart contract, backend, and frontend

## Ongoing
I keep an internal to-do list tracking further hardening and cleanup as I continue working on this project solo.

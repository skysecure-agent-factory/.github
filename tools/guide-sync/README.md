# Guide-only automatic publishing

This folder contains the reviewed source for the document owner's local sync helper. It does not run in agent repositories or change their deployment workflows.

## Installed layout

The current installation keeps these three files in `<workspace>/.guide-sync/`: `sync.mjs`, `sync.test.mjs`, and `control.ps1`. The editable master is `<workspace>/SKYSECURE_AI_AGENT_ENGINEERING_AND_PRODUCTION_GUIDE.html`. Runtime state stays in that local helper directory and must not be committed or copied between publishers.

Requirements: Windows, Node.js 24 at the path configured in `control.ps1`, Git available on PATH, and an existing Git Credential Manager sign-in with access to this repository. Credentials are read into memory; the helper does not save them. The existing credential may have broader permissions, but the helper's publication operations target only this repository's `guide-live` branch and its three guide files.

## Owner controls

Run from the workspace containing the HTML master:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .guide-sync/control.ps1 -Action Status
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .guide-sync/control.ps1 -Action Pause
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .guide-sync/control.ps1 -Action Resume
```

`Install` registers the hidden, limited-permission current-user logon task. `Uninstall` pauses syncing and removes that task without deleting the guide or public history. The process-level execution-policy option does not change machine policy; organization policy still takes precedence.

Saving the master publishes publicly. Pause before confidential drafting. The computer must be awake, signed in, and online to send updates; the website remains available while the computer is offline. Continuous saves are combined into at most one upload every 390 seconds, followed by GitHub Pages deployment. Open guide pages check for new versions every minute.

Pages uses `guide-live` and `/`, not `prod` or `/docs`. Keep `guide-live` as a long-lived publishing branch. Only `index.html`, `.nojekyll`, and `guide-version.json` are allowed there. Do not edit them independently: the helper blocks on a remote conflict instead of overwriting it. An existing installation's saved baseline must be preserved during helper updates; inspect conflicts before reconciling state. A new installation adopts the remote branch only when its rendered local master matches the remote guide.

Changes to this helper and the organization profile still use reviewed PRs. After review, pause the installed helper, copy only the three source files to the installed helper directory without replacing its state, then resume it. Do not run a second publisher for the same guide.

## Local checks

```powershell
node --test --test-isolation=none tools/guide-sync/sync.test.mjs
node tools/guide-sync/browser.test.mjs "<workspace>/SKYSECURE_AI_AGENT_ENGINEERING_AND_PRODUCTION_GUIDE.html"
```

These tests use local fixtures and fake transports; they do not publish to GitHub. Public release verification must compare the served HTML with the expected rendered local file, not just a successful commit or build.

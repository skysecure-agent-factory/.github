# SkySecure Agent Factory documentation

[Open the public engineering guide](https://skysecure-agent-factory.github.io/.github/)

## Update the guide

1. Start a task branch from the latest `prod`.
2. Edit **`docs/index.html`**. This is the only editable guide source.
3. Commit and push the task branch, then open a PR into `prod`.
4. Wait for **Validate guide** to pass, then merge the PR. No separate human approval is required in this documentation repository.
5. Wait for **Deploy guide** to succeed in Actions. The same public URL now serves the updated guide.
6. Delete the merged task branch. Keep `prod`.

Saving locally does not publish. GitHub runs the deployment after the merge; no local sync tool, personal publishing token, laptop availability, or manual HTML upload is needed. Users can refresh or reopen the URL after deployment. Visible pages also check a small version file at most once every five minutes; hidden tabs do not poll.

This repository and its PRs are public. Do not commit credentials, customer data, confidential drafts, or private infrastructure details. Automated validation catches structural problems and common credential patterns, not every possible disclosure or factual error. The document owner remains responsible for content.

## Repository layout

- `docs/index.html`: canonical engineering guide, including its existing styling and navigation.
- `profile/README.md` and `profile/assets/`: public organization overview.
- `tools/guide-site/`: dependency-free validation, artifact generation, and tests.
- `.github/workflows/guide-pages.yml`: PR validation and `prod`-only Pages deployment.
- `_site/`: generated, ignored deployment output. Do not edit or commit it.

The previous local auto-publisher has been retired. Its `guide-live` branch is retained for migration recovery only. Old standalone HTML copies do not publish.

## Checks and build

Node.js 24 is used in CI. No package installation is required.

```shell
node --test tools/guide-site/build.test.mjs tools/guide-site/browser.test.mjs
node tools/guide-site/build.mjs --check
node tools/guide-site/build.mjs
```

The builder validates the source and creates exactly `index.html`, `.nojekyll`, and `guide-version.json` in a new `_site` directory. It refuses to overwrite an existing output directory; inspect and remove only that generated directory before rebuilding. The source version marker must remain `local`; the build replaces it with a content hash automatically.

Only `prod` may deploy to the `github-pages` environment. PRs validate and build but never deploy. Pages uses GitHub Actions, not branch-based publishing. Production deployment runs are serialized; validation is required before merging, without mandatory human approval in this repository.

To roll back guide content, revert the relevant change through a new PR into `prod`; merging triggers another deployment. Re-run a failed deployment only if it is still the latest `prod` run. Otherwise, use **Run workflow** with branch `prod`, because re-running an old workflow retains that old commit and can republish outdated content. Existing agent repositories, Azure resources, and agent CI/CD standards are unaffected.

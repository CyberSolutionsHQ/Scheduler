# GitHub Admin Actions (Audit)

Checklist
1) Confirm repo + Pages settings
- `gh auth status`
- `gh repo view --json nameWithOwner,defaultBranchRef,homepageUrl,viewerPermission`
- `gh api repos/CyberSolutionsHQ/Scheduler/pages`
- `gh api repos/CyberSolutionsHQ/Scheduler/environments/github-pages/deployment-branch-policies`
- `gh workflow list`
- `gh run list --limit 5`

2) Resolve branch policy mismatch (master vs main)
- Recommended: deploy from `main` only and stop pushing Pages changes to `master`.
- Alternative: update the github-pages environment branch policy to allow `master` (use GitHub UI or API).

3) Consolidate Pages workflows to guarantee runtime-config.js
- Edit `.github/workflows/static.yml` (on `main`) to add a `Generate runtime config` step before `actions/upload-pages-artifact@v3`, or remove/disable this workflow entirely.
- Keep `.github/workflows/deploy_github_pages.yml` as the single deploy pipeline so runtime-config.js is always present.

4) Verify deployment after the next push
- `gh run list --limit 5`
- `gh run view <run-id>`
- Check site URLs:
  - `https://cybersolutionshq.github.io/Scheduler/`
  - `https://cybersolutionshq.github.io/Scheduler/runtime-config.js`

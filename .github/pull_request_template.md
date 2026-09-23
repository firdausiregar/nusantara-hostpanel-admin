## What changed

## Security impact
- [ ] No privilege-boundary changes
- [ ] New/changed privileged action is validated in `hostpanelctl`
- [ ] Secrets are not logged/rendered/passed through argv

## Verification
- [ ] `npm run check`
- [ ] `npm run release:check`
- [ ] `bash -n scripts/*.sh`
- [ ] Migration + local runtime smoke test passed

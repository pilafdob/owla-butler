<!-- Pull requests go into main only from OWLA-RC. New work is committed to OWLA-RC, and nothing merges out of Developer-Prerelease. See CONTRIBUTING.md. -->

## Summary

<!-- What changes and why. Link the issue it fixes, if any. -->

## Verification

<!-- Tick what you ran; say what you could not check. -->

- [ ] `npm run check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run check:release`
- [ ] Tried in a running Obsidian, in a disposable vault (describe below)

Not verified:

## Checklist

- [ ] The version is bumped in `manifest.json`, `package.json`, `package-lock.json` and `versions.json`, with `CHANGELOG.md` and `RELEASE-NOTES.md` entries, or this pull request does not need a release.
- [ ] No personal data, vault content, tokens, `data.json` or `work/` logs are included.
- [ ] Layout changes fit 240, 280, 360 and 600 px panes.

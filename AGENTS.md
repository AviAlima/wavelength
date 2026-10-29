# Repository instructions

These instructions apply only to this repository.

- When the user requests a code change, complete the normal release flow after validation: update the displayed patch version for every release that changes the site, commit the requested changes, push them to `main`, and monitor the GitHub Pages deployment to completion.
- Do not pause to ask for separate confirmation before committing, pushing, or deploying changes in this repository. The user has explicitly authorized this workflow.
- Report the commit, validation results, and deployment outcome when finished.

## Release version checklist

- Every fix or feature published to the site must increase the version; never reuse the previous release version. Documentation-only changes do not require a site version bump.
- Keep `VERSION` in `src/game.ts` and both asset query versions (`css/style.css?v=...` and `js/game.js?v=...`) in `index.html` identical.
- Before committing a site release, verify that all three version values match and are higher than the current version on `main`.
- Include the released version in the completion message.

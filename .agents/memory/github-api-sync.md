---
name: GitHub API synchronization
description: How to keep the local branch aligned after publishing through the authorized GitHub Data API.
---

When native GitHub HTTPS credentials are unavailable, publishing through the authorized GitHub Data API may create an equivalent remote commit with a new SHA rather than preserving the local commit object. After publishing, fetch the updated remote branch and align local `main` to `origin/main` once the file contents are verified.

**Why:** The remote commit is valid and contains the intended changes, but the local branch otherwise appears simultaneously ahead and behind in the Git tab.

**How to apply:** Treat the remote SHA as authoritative after a successful API update; verify the expected files, fetch `origin/main`, and reset the clean local branch pointer to that remote SHA.

In this environment, direct `git push` over the HTTPS remote may fail even when the repository is readable. The attached GitHub integration may also reject commit creation, while some `.github` Contents API paths can be blocked by the connector proxy. Treat a failed API write as unsynced; do not claim the remote branch changed.

**Why:** The local Git credential and the Replit-authorized GitHub connection are separate authentication paths.

**How to apply:** Never ask for or store a personal access token. Try the connected GitHub API without force, verify the remote ref after any successful response, and report the push as blocked if the connector denies commit creation.
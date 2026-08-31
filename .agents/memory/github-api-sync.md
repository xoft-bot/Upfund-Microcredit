---
name: GitHub API synchronization
description: How to keep the local branch aligned after publishing through the authorized GitHub Data API.
---

When native GitHub HTTPS credentials are unavailable, publishing through the authorized GitHub Data API creates an equivalent remote commit with a new SHA rather than preserving the local commit object. After publishing, fetch the updated remote branch and align local `main` to `origin/main` once the file contents are verified.

**Why:** The remote commit is valid and contains the intended changes, but the local branch otherwise appears simultaneously ahead and behind in the Git tab.

**How to apply:** Treat the remote SHA as authoritative after a successful API update; verify the expected files, fetch `origin/main`, and reset the clean local branch pointer to that remote SHA.
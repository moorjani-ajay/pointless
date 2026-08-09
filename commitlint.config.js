// Conventional Commits, enforced locally by the husky `commit-msg` hook and in
// CI on the PR title (squash-merge makes the title the commit subject). The
// allowed types drive release-please's version bumps and CHANGELOG sections.
/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
};

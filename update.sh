#!/bin/sh
# Stage everything, commit, push — then publish the JC-808 to its own repo.
# Usage: ./update.sh ["commit message"]   (default message: "update")
#
# The jc-808 repo (../jc-808) is a built copy of this project's JC-808: the
# source of truth is src/tools/jc808 here, standalone/jc808 wraps it as a
# page of its own, and the build output replaces the files in ../jc-808.
# Edit the JC-808 here, never in ../jc-808.
set -e
cd "$(dirname "$0")"
MSG="${1:-update}"

git add .
git diff --cached --quiet || git commit -m "$MSG"
git push

JC=../jc-808
if [ -d "$JC/.git" ]; then
  echo "— publishing the JC-808 to $JC"
  npx vite build --config vite.standalone.config.js
  # replace everything but git bookkeeping and the README
  find "$JC" -mindepth 1 -maxdepth 1 ! -name .git ! -name .gitignore ! -name README.md -exec rm -rf {} +
  cp -R dist-jc808/. "$JC"/
  git -C "$JC" add .
  git -C "$JC" diff --cached --quiet || git -C "$JC" commit -m "$MSG (built from bedroom-studio $(git rev-parse --short HEAD))"
  git -C "$JC" push
else
  echo "— ../jc-808 not found, skipping the JC-808 publish"
fi

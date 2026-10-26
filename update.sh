#!/bin/sh
# # Stage everything, commit, and push.
# # Usage: ./update.sh ["commit message"]   (default message: "update")
# set -e
# cd "$(dirname "$0")"
git add .
git commit -m "${1:-update}"
git push

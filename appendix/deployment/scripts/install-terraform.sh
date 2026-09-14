#!/usr/bin/env bash
set -euo pipefail
version=1.13.3
destination="${AGENT_TEMPDIRECTORY:-${TMPDIR:-/tmp}}/battery-terraform-${version}"
mkdir -p "$destination"
cd "$destination"
archive="terraform_${version}_linux_amd64.zip"
curl --fail --silent --show-error --location "https://releases.hashicorp.com/terraform/${version}/${archive}" -o "$archive"
curl --fail --silent --show-error --location "https://releases.hashicorp.com/terraform/${version}/terraform_${version}_SHA256SUMS" -o SHA256SUMS
grep " ${archive}$" SHA256SUMS | sha256sum --check -
unzip -o -q "$archive"
echo "##vso[task.prependpath]$destination"
"$destination/terraform" version

#!/usr/bin/env bash
set -euo pipefail

# Install one pinned Terraform version so CI agents remain reproducible.
version=1.13.3
destination="${AGENT_TEMPDIRECTORY:-${TMPDIR:-/tmp}}/battery-terraform-${version}"
mkdir -p "$destination"
cd "$destination"
archive="terraform_${version}_linux_amd64.zip"

# Download the binary and its official checksum file.
curl --fail --silent --show-error --location "https://releases.hashicorp.com/terraform/${version}/${archive}" -o "$archive"
curl --fail --silent --show-error --location "https://releases.hashicorp.com/terraform/${version}/terraform_${version}_SHA256SUMS" -o SHA256SUMS
grep " ${archive}$" SHA256SUMS | sha256sum --check -
unzip -o -q "$archive"

# Make the verified binary available to later Azure DevOps steps.
echo "##vso[task.prependpath]$destination"
"$destination/terraform" version

FROM docker.io/cloudflare/sandbox:0.10.1

# GitHub CLI: agents authenticate via the session's GH_TOKEN env (repo-scoped
# App installation token) — no gh auth login required.
ARG GH_VERSION=2.94.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
  | tar -xz --strip-components=2 -C /usr/local/bin "gh_${GH_VERSION}_linux_amd64/bin/gh" \
  && gh --version

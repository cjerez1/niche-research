#!/usr/bin/env bash
# One-time VM setup for the ChatGPT/Codex NexLev refresh path.

set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20/npm first."
  exit 1
fi

echo "[install] Installing OpenAI Codex CLI..."
sudo npm install -g @openai/codex

echo "[install] Codex version:"
codex --version

mkdir -p "$HOME/.codex"

if [ ! -f "$HOME/.codex/config.toml" ]; then
  cat > "$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5"
approval_policy = "never"
sandbox_mode = "danger-full-access"
EOF
  echo "[install] Created ~/.codex/config.toml"
else
  echo "[install] Keeping existing ~/.codex/config.toml"
fi

echo
echo "NEXT MANUAL STEP:"
echo "  1. Run: codex login"
echo "  2. Choose ChatGPT login and complete the device/browser flow."
echo "  3. In Codex, run /apps and connect/install the NexLev app if it is not already connected."
echo "  4. Test with: ~/niche-scanner/refresh-nexlev.sh"

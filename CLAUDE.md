# CLAUDE.md — CLAUDIO JEREZ MASTER PROFILE
_Legacy filename. For use in Codex/ChatGPT. This is the single source of truth._
_Last updated: 2026-04-21_

---

## DEPLOYED INFRASTRUCTURE — NICHE SCANNER (READ THIS FIRST)

**Status:** Production. Fully automated. Runs without Claudio's laptop.

### Where it runs
- **Oracle Cloud Always Free VM**, region `ap-melbourne-1` (Melbourne)
- Instance: `instance-20260415-1508`, Ubuntu 22.04 x86_64
- **Public IP:** `168.138.30.13`
- **User:** `ubuntu`
- **Cost:** $0/month forever (Oracle Always Free tier)
- **Project path on VM:** `/home/ubuntu/niche-scanner`

### SSH access (from Claudio's laptop)
SSH key lives at `C:\Users\claud\.ssh\oracle-vm.key` (NOT in OneDrive — OneDrive breaks SSH key perms). Do NOT copy it back to the niche-scanner folder.
```powershell
ssh -i "$env:USERPROFILE\.ssh\oracle-vm.key" ubuntu@168.138.30.13
```

### Stack on VM
- Node.js 20 (for scanner code)
- OpenAI Codex CLI (for ChatGPT/NexLev app calls in headless mode via `codex exec`)
- git (for pulling updates, pushing daily history)
- NexLev connector auto-synced via OAuth (account-level — no manual config)
- Linux cron for scheduling (VM timezone is `Australia/Melbourne`)

### Daily flow (runs at 7 PM Melbourne, automatic)
Wrapper script: `/home/ubuntu/niche-scanner/run-daily.sh`
Cron entry: `0 19 * * * /home/ubuntu/niche-scanner/run-daily.sh`

Steps the wrapper does:
1. `git pull origin main` — get any code updates
2. `refresh-nexlev.sh` runs separately on retry cron and calls the ChatGPT/Codex NexLev app to refresh `niche-research/nexlev-cache/latest.json` + `niche-research/popping-channels/YYYY-MM-DD.json`
3. `node index.js --nexlev` — run the scanner once daily, generate reports, email Claudio
4. `git add niche-research/ && git commit && git push` — sync history back to GitHub

Logs saved to `/home/ubuntu/niche-scanner/logs/YYYY-MM-DD.log` on the VM.

### GitHub repo (source of truth)
- **URL:** https://github.com/cjerez1/niche-research (PUBLIC — flagged as concern for competitive intel leakage)
- VM pulls/pushes from here daily. Laptop pushes code changes here manually.
- `.gitignore` excludes: `.env`, `node_modules/`, `*.key`, `*.pem`, `.claude/settings.local.json`
- Never commit SSH keys or API keys.

### Email delivery
- Via Resend API (key in `.env` as `RESEND_API_KEY`)
- Recipient: `c.jerez1965@gmail.com` (from `.env` as `REPORT_EMAIL`)
- **Gmail clip threshold is ~102KB.** Email is capped to **10 escalated + 20 top cards** to stay under this. Full list of 200+ candidates lives in the dashboard HTML on the VM.
- Email structure (top to bottom): header stats → legend → POPPING OFF top 10 (compact) → escalated cards → top cards → disappeared table → footer

### Known quirks / bugs fixed
- **UTF-8 BOM bug:** PowerShell on Windows writes JSON with BOM that breaks `JSON.parse`. Fixed with BOM-stripping in `src/nexlev/discovery.js`. Don't regress.
- **Email bloat on full-quota runs:** fixed with cap to top 30 cards in `generateEmailHtml`. Don't remove the cap.
- **Saturation label conflict:** legacy `saturationLevel` was contradicting SOP verdict. `report-generator.js` + `dashboard-generator.js` now show ONLY the SOP verdict (`GO/CAUTION/BEND/SKIP`) + direct-hit tier (`Clear/Low/Medium/High`) when available.

### Scanner architecture (high level)
- `index.js` — orchestrator
- `src/scanner/` — discovery + filtering (YouTube API, NexLev merging, competition scanning)
- `src/scoring/` — opportunity scorer (weighted criteria — see Priority 1 below)
- `src/bending/` — niche-bend generator (calls Claude API via `ANTHROPIC_API_KEY`)
- `src/output/` — dashboard, email, markdown report, popping-section rendering
- `src/nexlev/` — NexLev cache loader + normalizer
- `config/config.js` — all tuning knobs (filters, weights, thresholds)

### How to make a change (workflow)
1. Edit code locally (laptop)
2. Test locally: `node index.js --nexlev`
3. `git add`, commit, `git push origin main`
4. VM picks it up on next 7 PM run automatically (or SSH in and run `~/niche-scanner/run-daily.sh` to test immediately)

### Scheduled task (legacy — disabled)
- `daily-niche-scan-popping` in claude.ai scheduled tasks is DISABLED
- Kept for reference. Do not re-enable — would cause double-runs when Claudio's laptop is on.

### If the daily email stops arriving — debug order
1. SSH to VM → check `/home/ubuntu/niche-scanner/logs/YYYY-MM-DD.log`
2. Verify Oracle VM is still running (https://cloud.oracle.com → Compute → Instances)
3. Verify Codex is installed/authenticated and NexLev is connected: `ssh ubuntu@168.138.30.13 "codex --version && ~/niche-scanner/refresh-nexlev.sh"`
4. Check YouTube API quota reset hasn't been blocked (Google Cloud Console)
5. Check Resend API isn't rate-limited or key expired
6. Verify cron is still scheduled: `crontab -l` on VM

---

## WHO IS CLAUDIO

Melbourne-based entrepreneur, age 60. Former roofing company owner (20 years) and pest control business (10 years). Now building a scalable faceless YouTube automation business as primary income source.

**Communication style:** Direct, commercially driven, systems-oriented. Give opinions, not options. Flag problems bluntly. No motivational filler. Think like an operator and strategist, not an assistant.

**Critical context:** Running low on cash runway. Two monetized channels generating ~$1,000/month combined. Every hour of Claude Code credit and every dollar of production spend must move the needle toward revenue. Speed and precision matter more than perfection.

---

## CURRENT BUSINESS STATE

### Monetized Channels (Live, Revenue-Generating)
| Channel | Niche | Upload Frequency | Combined Revenue |
|---------|-------|-----------------|-----------------|
| **Food Flip** | Australian health/food | Daily, ~17 min videos | ~$1,000/month total |
| **Aussie Exposed** | Australian health/consumer | Daily, ~17 min videos | (combined above) |

**Target audience:** Australian 45-70+ demographic
**Do NOT change:** These channels are producing. Keep editors running current workflow. Do not disrupt.

### Channels In Development
| Channel | Niche | Status |
|---------|-------|--------|
| **Voidscape** (@voidscape0) | Space cinematic documentary | Has 4 videos, considering delete + relaunch with concept-driven content |
| **Dark Atlas** | Earth science/exploration | Strategic rebuild underway, not yet launched |
| **Crisis Alert** | Disaster/earth changes | Active development |
| **The $1 Fix** | Home maintenance hacks (avatar format) | Has content calendar, avatar persona designed |

### Other Referenced Channels
- Vanished Earth, Nana Banana, Aussie Exposed with Joshua (Australian health variants)
- Vanished Empires, Abandoned World (identified as strong launch candidates)

---

## REVENUE GOALS

| Timeframe | Target |
|-----------|--------|
| Next 30 days | $10,000/month |
| Next 3-6 months | $100,000/month |
| Core metric | Stable recurring, not one-off spikes |

---

## TOP TWO PRIORITIES (April 2026)

### PRIORITY 1: Niche Detection Automation — ✅ DEPLOYED (2026-04-21)
Daily scanner runs on Oracle VM at 7 PM Melbourne. Emails Claudio top 20 opportunities + top 10 popping-off longform channels + niche-bend suggestions. See **DEPLOYED INFRASTRUCTURE** section at top of this file for operational details.

**Scanner criteria:**
- Channels under 30 days old
- Under 10,000 subscribers
- Showing consistent views (not just one outlier)
- Ideally showing one or more outlier videos
- Simple enough format to produce at scale with faceless execution
- Browse Features activating as traffic source
- Upload frequency and consistency signals
- Production feasibility for faceless execution

**Niche bending must be included:**
- Combine 2 niches or 2 channel styles
- Main topic + stronger packaging angle
- Broad niche + emotional/curiosity/practical twist
- High-performing format from one niche applied to another
- The scanner should not only detect niches — it should suggest stronger angles

**Scoring model for each opportunity:**
| Criteria | Weight |
|----------|--------|
| Click potential (would you click this?) | x3 |
| Watch-time potential (can this hold 8+ min?) | x3 |
| RPM potential (will advertisers pay well?) | x2 |
| Competition density (how many similar channels?) | x2 |
| Ease of production (faceless feasibility) | x1 |
| Series potential (can this become 3+ videos?) | x1 |

**Saturation Check SOP (added 2026-04-21):**
Every scored candidate is checked against recent YouTube videos on the same angle. Output:
- **Direct-hit count (30d):** unique videos on same angle uploaded in last 30 days
- **Tier:** Clear (0) · Low (1-2) · Medium (3-5) · High (6+)
- **Verdict:** `GO` (open lane) · `CAUTION` (low demand) · `BEND` (differentiate angle) · `SKIP` (too crowded)
- Verdict logic lives in `src/scanner/competition-scanner.js` → `computeVerdict()`
- **Score vs Verdict can disagree** — Score rates the CHANNEL's quality; Verdict rates room in the MARKET. A great channel (80/100) in a SKIP market means "lane full — bend the angle or skip." Legend at top of email + dashboard explains this.

**Email card cap (added 2026-04-21):**
- Email: top 10 escalated + top 20 by score (prevents Gmail 102KB clip on full-quota runs of 200+ candidates)
- Dashboard HTML: full list, no cap
- Do not remove the cap in `generateEmailHtml()` — email becomes unreadable.

### PRIORITY 2: Fast Channel Acquisition & Trust Testing
Stop hunting for aged channels with 300K+ impressions. They barely exist anymore.

**New protocol:**
1. Create fresh Gmail in Multilogin
2. Warm up 48 hours with niche-relevant watching
3. Upload 2-minute dummy video (dashcam/walk footage)
4. Wait 48 hours, check impressions
5. **Decision thresholds:**
   - Under 100K impressions → Kill immediately
   - 100K-300K impressions → Proceed cautiously to Stage 2
   - 300K+ impressions → Priority channel, proceed immediately
   - 500K+ impressions → Excellent, fast-track

**Stage 2 (for channels that pass Stage 1):**
1. Upload 6 real videos over 1-2 weeks
2. After video 6, check three things:
   - Is Browse Features showing as top traffic source (target 40%+)?
   - Has at least one video hit 1,000 views within 7 days?
   - Are impressions trending UP across the 6 uploads?
3. If all three positive → extend to 10 videos to confirm
4. If Browse never activates or views consistently under 500 → pivot niche or park channel
5. By video 10, target at least 5,000 views on best performer

**Target cycle time:** Niche discovery to go/kill decision in 3 days, not 2 weeks.

---

## TOOL STACK

### Production Tools
| Tool | Purpose |
|------|---------|
| **ElevenLabs v3** | AI voiceover with emotion tagging |
| **VidRush** | Video generation for testing (first 6-10 videos per channel) |
| **HeyGen** | AI avatar generation |
| **Multilogin** | Anti-detect browser, one profile per channel |
| **TubeProxies** | Static ISP residential proxies, one per channel |
| **VidIQ** | YouTube analytics and keyword research |
| **Nexlev** | Channel analytics |
| **n8n** | Automation pipelines |

### AI Tools
| Tool | Purpose |
|------|---------|
| **Claude Code (VS Code)** | Primary development environment |
| **Claude.ai** | Strategic analysis, lightweight reference |
| **ChatGPT / Codex** | Secondary AI, specific tasks |

### Production Workflow
1. Niche discovery and validation (AUTOMATE THIS FIRST)
2. Ideation: topic titles, hooks, thumbnail concepts
3. Script generation (with ElevenLabs emotion tags — NO avatar tags, NO B-roll tags)
4. Voiceover via ElevenLabs v3
5. Video assembly via VidRush (testing) or human editors (scaled production)
6. Thumbnail creation
7. Upload and publish

### Team
- Philippines-based editors (multiple)
- Zimbabwe-based editor (being promoted to manager)
- Assistant (technical, helps with Claude Code and filming)
- Claudio films training materials from wheelchair

---

## FILE ARCHITECTURE

### Directory Structure
```
/strategy/
  channels/
    _TEMPLATE.md          # Master template for new channels
    foodflip.md           # Fully configured
    aussie-exposed.md
    voidscape.md
    dark-atlas.md
    crisis-alert.md
    the-1-fix.md
  scaling-principles.md   # Codified from experienced operators
  niche-research/         # Scanner outputs, opportunity logs
```

### Channel MD Files = Configuration Files
Each channel's markdown file IS the configuration for that channel. The system reads these to drive automation:

| System Component | Reads From Channel File |
|------------------|------------------------|
| Topic Ideation | Competitors list, niche bending ideas |
| Script Generation | Script prompts, content rules |
| Analytics | KPI targets, competitor benchmarks |
| Title/Thumbnail | Packaging formulas, competitor patterns |
| Niche Expansion | Niche bending ideas, evergreen topics |

The system writes back: performance data, pattern observations, what's working/not, new topic ideas.

**Rule: When working on a channel, ALWAYS read its file first. ALWAYS update it with new learnings.**

---

## SCRIPT GENERATION RULES

**MANDATORY:**
- Include ElevenLabs emotion tags from start to end of every script
- Do NOT include avatar tags (e.g. `[AVATAR: smirk]`)
- Do NOT include B-roll tags (e.g. `[BROLL...]`)
- No AI-fabricated quotes or "insider sources"
- Percentage-based script structure (intro %, body %, conclusion %)

---

## INFRASTRUCTURE RULES

- One dedicated proxy per channel, no exceptions
- One Multilogin browser profile per channel
- Channels must be completely isolated from each other
- Never reuse proxies across channels
- Never log into multiple channels from the same profile

---

## RISK REGISTER

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wrong niche selection | CRITICAL | Automate niche scanning, validate before production spend |
| Channel termination | HIGH | Isolated infrastructure, separate AdSense per channel |
| AdSense scaling complexity | HIGH | Different AdSense entity per channel, family members if needed |
| Cash runway exhaustion | CRITICAL | Prioritize revenue-generating activities, cut experimental spend |
| Claude Code credit burn on errors | MEDIUM | Get error output, diagnose before re-running |
| Over-reliance on expensive editors | MEDIUM | Use VidRush for validation, editors only for proven channels |

---

## KNOWN CLAUDE CODE ISSUES (TO FIX)

**Channel warm-up automation is broken:**
- Symptom: Browser freezes a few minutes into warm-up sequence
- Symptom: Not navigating into videos, just scrolling YouTube homepage
- Symptom: Same errors persist across 3-5 retry attempts
- Impact: Burning Claude Code credits on failed retries
- **Action needed:** Get exact error output, diagnose root cause before retrying

---

## WHAT "DONE" LOOKS LIKE

The fully built system should:
1. Scan daily for breakout niche opportunities meeting all criteria
2. Score and rank opportunities with niche-bending suggestions
3. Enable 3-day cycle from discovery to go/kill decision on new channels
4. Generate scripts with correct emotion tags and structure
5. Track performance and feed learnings back into channel files
6. Reduce dependence on manual niche research and editorial judgment
7. Scale from current 2 channels toward 10-20+ channel portfolio

---

## MONETIZATION LAYERS (In Priority Order)

1. **AdSense** — primary, optimize RPM through niche selection and video length
2. **Affiliate income** — layer onto health channels especially
3. **Sponsorships** — once channels hit scale
4. **Service offering** — sell channel setup/automation as a service to other operators
5. **E-commerce** — future consideration
6. **Content licensing** — repurpose scripts/voiceovers across platforms

---

## OPERATING PRINCIPLES

1. Find better opportunities earlier than competitors
2. Test faster than competitors
3. Kill losers without hesitation
4. Scale winners aggressively
5. Compound judgment over time through data
6. Every dollar spent must be justified by revenue potential
7. Speed with logic, not blind speed
8. Systems over manual effort, always

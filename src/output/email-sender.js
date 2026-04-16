const { Resend } = require('resend');
const { marked } = require('marked');

/**
 * Send the daily report as a styled HTML email via Resend.
 * @param {string} content - Either markdown or pre-rendered HTML
 * @param {object} config - App config
 * @param {boolean} isHtml - If true, content is already HTML (dashboard format)
 */
async function sendReportEmail(content, config, isHtml = false) {
  if (!config.email.enabled) {
    console.log('Email delivery disabled (no RESEND_API_KEY set)');
    return;
  }

  if (!config.email.to) {
    console.log('Email delivery skipped (no REPORT_EMAIL set)');
    return;
  }

  const resend = new Resend(config.email.apiKey);
  const html = isHtml ? content : convertReportToHtml(content);
  const subject = buildEmailSubject(isHtml ? content : content);

  try {
    const { data, error } = await resend.emails.send({
      from: config.email.from,
      to: config.email.to,
      subject,
      html,
    });

    if (error) {
      console.error(`Email send error: ${error.message}`);
      return;
    }

    console.log(`Report emailed to ${config.email.to} (ID: ${data.id})`);
  } catch (err) {
    console.error(`Email delivery failed: ${err.message}`);
  }
}

/**
 * Convert markdown report to styled HTML.
 */
function convertReportToHtml(markdown) {
  const bodyHtml = marked(markdown);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: #0f0f1a;
    color: #e0e0e0;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    line-height: 1.6;
  }
  h1 {
    color: #00d4ff;
    border-bottom: 2px solid #00d4ff;
    padding-bottom: 10px;
    font-size: 24px;
  }
  h2 {
    color: #ff6b6b;
    margin-top: 30px;
    font-size: 20px;
  }
  h3 {
    color: #ffd93d;
    font-size: 17px;
    margin-top: 25px;
  }
  a {
    color: #00d4ff;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  strong {
    color: #ffffff;
  }
  em {
    color: #a0a0a0;
  }
  hr {
    border: none;
    border-top: 1px solid #333;
    margin: 20px 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 15px 0;
  }
  th, td {
    border: 1px solid #333;
    padding: 8px 12px;
    text-align: left;
  }
  th {
    background-color: #1a1a2e;
    color: #00d4ff;
  }
  tr:nth-child(even) {
    background-color: #1a1a2e;
  }
  ul, ol {
    padding-left: 20px;
  }
  li {
    margin: 4px 0;
  }
  code {
    background-color: #1a1a2e;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 14px;
  }
  .tag-new {
    background-color: #00cc66;
    color: #000;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 12px;
  }
  .tag-trending-up {
    background-color: #00d4ff;
    color: #000;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 12px;
  }
  .tag-trending-down {
    background-color: #ff6b6b;
    color: #000;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 12px;
  }
  blockquote {
    border-left: 3px solid #00d4ff;
    padding-left: 15px;
    margin-left: 0;
    color: #a0a0a0;
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Build email subject from report content.
 */
function buildEmailSubject(content) {
  const date = new Date().toISOString().split('T')[0];
  const hasEscalated = content.includes('ESCALATED');

  // Try to extract opportunity count from various formats
  const opMatch = content.match(/Opportunities scored 60\+: (\d+)/) ||
                  content.match(/Score 60\+.*?(\d+)/) ||
                  content.match(/stat-num">(\d+)<\/div>\s*<div class="stat-label">Score 60\+/);
  const opCount = opMatch ? opMatch[1] : '0';

  const prefix = hasEscalated ? '🚨 ' : '';
  const month = new Date(date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });

  return `${prefix}Niche Scanner: ${opCount} opportunities (${month})`;
}

module.exports = { sendReportEmail };

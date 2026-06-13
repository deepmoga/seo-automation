// setup.js
// Small local web panel to enter API keys / credentials ONE TIME and
// save them into the .env file. No external dependencies (uses Node's
// built-in http module).
//
// Run with: node setup.js   (then open http://localhost:4500 in browser)

const http = require("http");
const { readEnv, writeEnv, maskValue } = require("./env-store");

const PORT = 4500;

// Fields shown on the panel: key name + label + help text
const FIELDS = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    help: "Used by ai.js to generate titles, meta descriptions, alt text, schema (gpt-4o-mini)."
  },
  {
    key: "WP_USERNAME",
    label: "WordPress Username",
    help: "Your WordPress admin/editor login username."
  },
  {
    key: "WP_APP_PASSWORD",
    label: "WordPress Application Password",
    help: "WP Admin -> Users -> Profile -> Application Passwords -> Add New."
  }
];

/**
 * Render the HTML form, pre-filled with masked current values.
 */
function renderForm(message = "") {
  const current = readEnv();

  const fieldsHtml = FIELDS.map((field) => {
    const existing = current[field.key];
    const placeholder = existing ? `Current: ${maskValue(existing)} (leave blank to keep)` : "";

    return `
      <div class="field">
        <label for="${field.key}">${field.label}</label>
        <input type="password" id="${field.key}" name="${field.key}" placeholder="${placeholder}" autocomplete="off" />
        <p class="help">${field.help}</p>
      </div>`;
  }).join("\n");

  const messageHtml = message
    ? `<div class="message">${message}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SEO Automation - Setup Panel</title>
  <style>
    body {
      font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: #1e293b;
      padding: 32px;
      border-radius: 12px;
      width: 480px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    }
    h1 { font-size: 22px; margin-top: 0; }
    p.subtitle { color: #94a3b8; margin-top: -8px; margin-bottom: 24px; font-size: 14px; }
    .field { margin-bottom: 18px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px; }
    input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 14px;
      box-sizing: border-box;
    }
    input:focus { outline: 2px solid #38bdf8; }
    .help { font-size: 12px; color: #64748b; margin: 4px 0 0; }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      background: #38bdf8;
      color: #0f172a;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 8px;
    }
    button:hover { background: #0ea5e9; }
    .message {
      background: #14532d;
      color: #bbf7d0;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 18px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔑 SEO Automation - Setup Panel</h1>
    <p class="subtitle">Apni keys ek baar yahan submit karo - ye .env file mein save ho jayengi.</p>
    ${messageHtml}
    <form method="POST" action="/save">
      ${fieldsHtml}
      <button type="submit">Save Settings</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Parse application/x-www-form-urlencoded request body.
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      const params = new URLSearchParams(body);
      const result = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      resolve(result);
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderForm());
      return;
    }

    if (req.method === "POST" && req.url === "/save") {
      const formData = await parseBody(req);

      // Only keep non-empty fields (blank = keep existing value)
      const newValues = {};
      for (const field of FIELDS) {
        if (formData[field.key]) {
          newValues[field.key] = formData[field.key];
        }
      }

      writeEnv(newValues);

      console.log("✅ Settings saved to .env");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderForm("✅ Settings saved successfully to .env"));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.log(`⚠️  Setup panel error: ${err.message}`);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal server error");
  }
});

server.listen(PORT, () => {
  console.log("🚀 Setup panel running!");
  console.log(`🌐 Open in your browser: http://localhost:${PORT}`);
  console.log("📝 Fill in your keys and click 'Save Settings' - they'll be written to .env");
  console.log("🛑 Press Ctrl+C to stop the server when done.");
});

const http = require('http');
const { generateReportPdf } = require('./lib/generateReportPdf');
const { sendReportEmail } = require('./lib/email');
const db = require('./lib/db');

const PORT = process.env.PORT || 3000;

// Allow your published calculator page's origin to call this API.
// Set this to your actual domain once deployed, e.g. "https://profill.mx"
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const ALL_TOOL_CODES = ['dueno', 'prod', 'manto', 'fin', 'compras', 'oper'];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function isValidEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw).trim());
}

function isAdminAuthed(req) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false; // fail closed if not configured
  return req.headers['x-admin-password'] === password;
}

// Generic validation: works for any of the 6 tools, since each just
// sends a title + list of inputs + list of results + a verdict string,
// rather than tool-specific numeric fields.
function validatePayload(body) {
  const errors = [];
  if (!body.email || !isValidEmail(body.email)) {
    errors.push('email must be a valid email address');
  }
  if (body.lang !== 'es' && body.lang !== 'en') {
    errors.push('lang must be "es" or "en"');
  }
  if (!body.title || typeof body.title !== 'string') {
    errors.push('title is required');
  }
  if (body.inputs && !Array.isArray(body.inputs)) {
    errors.push('inputs must be an array');
  }
  if (body.results && !Array.isArray(body.results)) {
    errors.push('results must be an array');
  }
  return errors;
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  // ---- Which tools are publicly visible right now (global default) ----
  // Controlled entirely by the ENABLED_TOOLS environment variable, so
  // you can reveal a new tool just by editing it in Render's dashboard -
  // no code change or redeploy needed on the frontend.
  // Defaults to just "dueno" (the ROI tool) if not set, so a missing or
  // misconfigured variable fails safe rather than exposing everything.
  if (req.method === 'GET' && pathname === '/api/enabled-tools') {
    const raw = process.env.ENABLED_TOOLS || 'dueno';
    const enabled = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return sendJson(res, 200, { enabled });
  }

  // ---- Public: check a per-customer access link ----
  // Called by the frontend when someone opens a link like ?access=TOKEN.
  // Every call is logged, which is what powers the access history in
  // the admin page - so this doubles as your "who opened what, when".
  if (req.method === 'GET' && pathname === '/api/customer-access') {
    const token = url.searchParams.get('token');
    if (!token) {
      return sendJson(res, 400, { error: 'token is required' });
    }
    try {
      const customer = await db.getCustomerByToken(token);
      if (!customer || customer.revoked) {
        return sendJson(res, 200, { valid: false, tools: [] });
      }
      await db.logAccess(token, req.headers['user-agent']);
      const tools = customer.tools.split(',').map((s) => s.trim()).filter(Boolean);
      return sendJson(res, 200, { valid: true, tools, name: customer.name });
    } catch (err) {
      console.error('customer-access failed:', err);
      // Fail closed - if the DB check breaks, don't grant access.
      return sendJson(res, 200, { valid: false, tools: [] });
    }
  }

  // ---- Admin: create a new customer access link ----
  if (req.method === 'POST' && pathname === '/api/admin/customers') {
    if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
    const name = (body.name || '').trim();
    const tools = Array.isArray(body.tools) ? body.tools.filter((t) => ALL_TOOL_CODES.includes(t)) : [];
    if (!name) return sendJson(res, 400, { error: 'name is required' });
    if (!tools.length) return sendJson(res, 400, { error: 'at least one valid tool is required' });
    try {
      const customer = await db.createCustomer(name, tools);
      return sendJson(res, 200, { ok: true, customer });
    } catch (err) {
      console.error('create customer failed:', err);
      return sendJson(res, 502, { error: 'Failed to create customer', details: String(err.message || err) });
    }
  }

  // ---- Admin: list all customer access links ----
  if (req.method === 'GET' && pathname === '/api/admin/customers') {
    if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    try {
      const customers = await db.listCustomers();
      return sendJson(res, 200, { customers });
    } catch (err) {
      console.error('list customers failed:', err);
      return sendJson(res, 502, { error: 'Failed to list customers', details: String(err.message || err) });
    }
  }

  // ---- Admin: revoke or restore a customer's access ----
  if (req.method === 'POST' && pathname === '/api/admin/customers/revoke') {
    if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
    if (!body.token) return sendJson(res, 400, { error: 'token is required' });
    try {
      const customer = await db.setRevoked(body.token, body.revoked !== false);
      if (!customer) return sendJson(res, 404, { error: 'Customer not found' });
      return sendJson(res, 200, { ok: true, customer });
    } catch (err) {
      console.error('revoke customer failed:', err);
      return sendJson(res, 502, { error: 'Failed to update customer', details: String(err.message || err) });
    }
  }

  // ---- Admin: change which tools an existing customer's link unlocks ----
  if (req.method === 'POST' && pathname === '/api/admin/customers/update-tools') {
    if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
    if (!body.token) return sendJson(res, 400, { error: 'token is required' });
    const tools = Array.isArray(body.tools) ? body.tools.filter((t) => ALL_TOOL_CODES.includes(t)) : [];
    if (!tools.length) return sendJson(res, 400, { error: 'at least one valid tool is required' });
    try {
      const customer = await db.updateCustomerTools(body.token, tools);
      if (!customer) return sendJson(res, 404, { error: 'Customer not found' });
      return sendJson(res, 200, { ok: true, customer });
    } catch (err) {
      console.error('update customer tools failed:', err);
      return sendJson(res, 502, { error: 'Failed to update customer', details: String(err.message || err) });
    }
  }

  // ---- Admin: recent access history ----
  if (req.method === 'GET' && pathname === '/api/admin/access-log') {
    if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    try {
      const log = await db.getAccessLog(200);
      return sendJson(res, 200, { log });
    } catch (err) {
      console.error('access log failed:', err);
      return sendJson(res, 502, { error: 'Failed to load access log', details: String(err.message || err) });
    }
  }

  // ---- Admin: every lead from every tool, regardless of access method ----
  if (req.method === 'GET' && pathname === '/api/admin/leads') {
    if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    try {
      const leads = await db.getLeads(300);
      return sendJson(res, 200, { leads });
    } catch (err) {
      console.error('leads fetch failed:', err);
      return sendJson(res, 502, { error: 'Failed to load leads', details: String(err.message || err) });
    }
  }

  // ---- Email the PDF report to the visitor (works for any of the 6 tools) ----
  if (req.method === 'POST' && pathname === '/api/send-report') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }

    const errors = validatePayload(body);
    if (errors.length) {
      return sendJson(res, 400, { error: 'Validation failed', details: errors });
    }

    // Log this as a lead regardless of what happens next (DRY_RUN, email
    // success or failure) - the fact that someone submitted the form is
    // what matters here. Failure to log never blocks the actual response.
    db.logLead({
      toolCode: body.tool,
      name: (body.name || '').trim(),
      email: body.email,
      phone: body.phone,
      lang: body.lang,
      verdict: body.verdict,
    }).catch((err) => console.error('logLead failed (non-fatal):', err.message));

    try {
      const pdfBuffer = await generateReportPdf(body);

      if (process.env.DRY_RUN === 'true') {
        console.log(`[DRY RUN] Would email ${pdfBuffer.length}-byte PDF to ${body.email} (${body.name || 'no name given'}) - tool: ${body.title}`);
        return sendJson(res, 200, {
          ok: true,
          dryRun: true,
          pdfSizeBytes: pdfBuffer.length,
          note: 'DRY_RUN is enabled — no email was actually sent.',
        });
      }

      const emailResult = await sendReportEmail({
        toEmail: body.email,
        name: (body.name || '').trim(),
        lang: body.lang,
        pdfBuffer,
        subject: body.emailSubject,
        filename: body.emailFilename,
      });

      return sendJson(res, 200, { ok: true, email: { messageId: emailResult.messageId } });
    } catch (err) {
      console.error('send-report failed:', err);
      return sendJson(res, 502, { error: 'Failed to send report', details: String(err.message || err) });
    }
  }

  sendJson(res, 404, { error: 'Not found' });
});

// Create the customer/access-log tables if they don't exist yet. This is
// non-fatal if it fails (e.g. DATABASE_URL not set up yet) - the report
// generation and enabled-tools features don't depend on the database, so
// the server stays usable for those even before the DB is configured.
db.initSchema()
  .then(() => console.log('Database schema ready.'))
  .catch((err) => console.error('Database schema init failed (customer-access features will not work until DATABASE_URL is set correctly):', err.message));

server.listen(PORT, () => {
  console.log(`ROI report backend listening on port ${PORT}`);
});

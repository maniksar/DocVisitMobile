import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';
import { AuthStore, validatePassword } from './src/lib/auth-store.mjs';

const siteDirectory = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(siteDirectory, 'server.config.json'), 'utf8'));
const requiredDatabaseSettings = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDatabaseSettings = requiredDatabaseSettings.filter((name) => !process.env[name]);
if (missingDatabaseSettings.length) {
  throw new Error(`Set the MariaDB connection settings: ${missingDatabaseSettings.join(', ')}.`);
}
const databasePort = Number(process.env.DB_PORT || 3306);
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
  throw new Error('DB_PORT must be a valid TCP port.');
}
const databaseConnectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 5);
if (!Number.isInteger(databaseConnectionLimit) || databaseConnectionLimit < 1) {
  throw new Error('DB_CONNECTION_LIMIT must be a positive integer.');
}
const database = mariadb.createPool({
  host: process.env.DB_HOST,
  port: databasePort,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: databaseConnectionLimit,
  charset: 'utf8mb4',
  ...(process.env.DB_SSL === 'true' ? {
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
  } : {}),
});
const store = new AuthStore(database, process.env.DB_TABLE_PREFIX || 'docvisit');
try {
  await store.initialize();
} catch (error) {
  await database.end();
  throw new Error('Could not connect to MariaDB or initialize the DocVisitMobile schema.', { cause: error });
}
try {
  if (process.env.SUPERADMIN_PASSWORD) {
    await store.ensureSuperadmin({ userId: config.superadminUserId, password: process.env.SUPERADMIN_PASSWORD });
  } else if (!await store.hasSuperadmin() && process.env.NODE_ENV === 'production') {
    throw new Error('Set SUPERADMIN_PASSWORD before first production startup.');
  }
} catch (error) {
  await store.close();
  throw error;
}

const distDirectory = resolve(siteDirectory, 'dist');
if (!existsSync(resolve(distDirectory, 'index.html'))) {
  throw new Error('Built site not found. Run npm run build before starting the server.');
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const attemptsByAddress = new Map();
const maxRequestBytes = 16 * 1024;
const cookieName = 'docvisit_session';

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function readSessionToken(request) {
  const cookies = (request.headers.cookie || '').split(';');
  const cookie = cookies.map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`));
  return cookie ? decodeURIComponent(cookie.slice(cookieName.length + 1)) : '';
}

function sessionCookie(token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function requestUser(request) {
  const session = await store.getSession(readSessionToken(request));
  return session ? { ...session, token: readSessionToken(request) } : null;
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  return !origin || new URL(origin).host === request.headers.host;
}

function isLoopback(request) {
  const address = (request.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1';
}

function serveStatic(request, response, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  let filePath = resolve(distDirectory, relativePath);
  if (filePath !== distDirectory && !filePath.startsWith(`${distDirectory}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html');
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    serveStatic(request, response, url.pathname);
    return;
  }

  if (request.method !== 'GET' && !isSameOrigin(request)) {
    sendJson(response, 403, { error: 'Cross-origin request denied.' });
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/setup/status') {
      sendJson(response, 200, { required: !await store.hasSuperadmin(), userId: config.superadminUserId });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/setup') {
      if (!isLoopback(request) || !isSameOrigin(request)) {
        sendJson(response, 403, { error: 'Initial setup is only available from this computer.' });
        return;
      }
      if (await store.hasSuperadmin()) {
        sendJson(response, 409, { error: 'Superadmin setup has already been completed.' });
        return;
      }
      const body = await readJson(request);
      if (body.password !== body.confirmPassword) {
        sendJson(response, 400, { error: 'Passwords do not match.' });
        return;
      }
      try {
        await store.ensureSuperadmin({ userId: config.superadminUserId, password: body.password });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      const session = await store.createSession(config.superadminUserId, config.sessionLifetimeSeconds);
      sendJson(response, 201, { user: await store.authenticate(config.superadminUserId, body.password) }, { 'Set-Cookie': sessionCookie(session.token, config.sessionLifetimeSeconds) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const address = request.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const attempt = attemptsByAddress.get(address);
      if (attempt && attempt.lockedUntil > now) {
        sendJson(response, 429, { error: 'Too many sign-in attempts. Try again later.' });
        return;
      }

      const body = await readJson(request);
      const user = await store.authenticate(String(body.userId || ''), String(body.password || ''));
      if (!user) {
        const current = attempt && now - attempt.startedAt < 15 * 60 * 1000 ? attempt : { count: 0, startedAt: now };
        current.count += 1;
        if (current.count >= 5) current.lockedUntil = now + 15 * 60 * 1000;
        attemptsByAddress.set(address, current);
        sendJson(response, 401, { error: 'User ID or password is incorrect.' });
        return;
      }

      attemptsByAddress.delete(address);
      const session = await store.createSession(user.id, config.sessionLifetimeSeconds);
      sendJson(response, 200, { user }, { 'Set-Cookie': sessionCookie(session.token, config.sessionLifetimeSeconds) });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
      const session = await requestUser(request);
      if (!session) {
        sendJson(response, 401, { error: 'Sign in required.' });
        return;
      }
      sendJson(response, 200, { user: session.user });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/password') {
      const session = await requestUser(request);
      if (!session) {
        sendJson(response, 401, { error: 'Sign in required.' });
        return;
      }
      const body = await readJson(request);
      if (!validatePassword(body.password)) {
        sendJson(response, 400, { error: 'Choose a password between 12 and 256 characters.' });
        return;
      }
      if (body.password !== body.confirmPassword) {
        sendJson(response, 400, { error: 'Passwords do not match.' });
        return;
      }
      const user = await store.changePassword(session.token, body.password);
      if (!user) {
        sendJson(response, 401, { error: 'Sign in required.' });
        return;
      }
      sendJson(response, 200, { user });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      await store.revokeSession(readSessionToken(request));
      sendJson(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
      return;
    }

    const resetDoctorMatch = url.pathname.match(/^\/api\/admin\/doctors\/([^/]+)\/reset-password$/);
    if (request.method === 'POST' && resetDoctorMatch) {
      const session = await requestUser(request);
      if (!session || session.user.role !== 'superadmin') {
        sendJson(response, 403, { error: 'Superadmin access required.' });
        return;
      }
      let userId;
      try {
        userId = decodeURIComponent(resetDoctorMatch[1]);
      } catch {
        sendJson(response, 400, { error: 'Invalid doctor user ID.' });
        return;
      }
      const reset = await store.resetDoctorPassword(userId);
      if (!reset) {
        sendJson(response, 404, { error: 'Doctor account not found.' });
        return;
      }
      const doctor = (await store.listDoctors()).find((item) => item.id === userId);
      sendJson(response, 200, { doctor, temporaryPassword: reset.temporaryPassword });
      return;
    }

    const doctorProfileMatch = url.pathname.match(/^\/api\/admin\/doctors\/([^/]+)\/profile$/);
    if (request.method === 'PUT' && doctorProfileMatch) {
      const session = await requestUser(request);
      if (!session || session.user.role !== 'superadmin') {
        sendJson(response, 403, { error: 'Superadmin access required.' });
        return;
      }
      let userId;
      try {
        userId = decodeURIComponent(doctorProfileMatch[1]);
      } catch {
        sendJson(response, 400, { error: 'Invalid doctor user ID.' });
        return;
      }
      const body = await readJson(request);
      try {
        const doctor = await store.updateDoctorProfile(userId, body);
        if (!doctor) {
          sendJson(response, 404, { error: 'Doctor account not found.' });
          return;
        }
        sendJson(response, 200, { doctor });
      } catch (error) {
        if (error.code) throw error;
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    if (url.pathname === '/api/admin/doctors') {
      const session = await requestUser(request);
      if (!session || session.user.role !== 'superadmin') {
        sendJson(response, 403, { error: 'Superadmin access required.' });
        return;
      }
      if (request.method === 'GET') {
        sendJson(response, 200, { doctors: await store.listDoctors() });
        return;
      }
      if (request.method === 'POST') {
        const body = await readJson(request);
        try {
          const doctor = await store.createDoctor(body);
          sendJson(response, 201, { doctor: { id: body.userId, name: body.name, email: body.email, specialty: body.specialty }, temporaryPassword: doctor.temporaryPassword });
        } catch (error) {
          if (error.code && error.code !== 'ER_DUP_ENTRY') throw error;
          const duplicate = error.code === 'ER_DUP_ENTRY';
          sendJson(response, duplicate ? 409 : 400, { error: duplicate ? 'That user ID is already in use.' : error.message });
        }
        return;
      }
    }

    sendJson(response, 404, { error: 'Endpoint not found.' });
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.status ? error.message : 'The request could not be completed.' });
    if (!error.status) console.error(error);
  }
});

const host = process.env.SERVER_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : config.host);
const port = Number(process.env.PORT || process.env.SERVER_PORT || config.port);
server.listen(port, host, () => {
  console.log(`DocVisitMobile running at http://${host}:${port}`);
  console.log(`Superadmin user ID: ${config.superadminUserId}`);
  console.log('Use sample data only. Configure HTTPS, backups, and a managed database before any real clinical use.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => {
    await store.close();
    process.exit(0);
  }));
}
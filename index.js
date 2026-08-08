#!/usr/bin/env node
// =============================================================================
//  action-gh-release — create a GitHub Release and upload assets
//  Feature-compatible with softprops/action-gh-release, zero dependencies,
//  runs on Node 20 (built-in fetch).
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const WS = process.env.GITHUB_WORKSPACE || process.cwd();

// -----------------------------------------------------------------------------
// Input helpers (GitHub injects inputs as INPUT_<NAME> env vars)
// -----------------------------------------------------------------------------
function input(name, options = {}) {
  const key = `INPUT_${name.toUpperCase().replace(/ /g, '_')}`;
  const val = (process.env[key] || '').trim();
  if (options.required && !val) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return val;
}
function boolInput(name, def = false) {
  const v = input(name);
  if (v === '') return def;
  return v === 'true' || v === '1';
}
function linesInput(name) {
  return (process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`] || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------
function setOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    console.log(`::set-output name=${name}::${value}`);
    return;
  }
  const v = String(value);
  if (v.includes('\n')) {
    const delim = `ghadelimiter_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    fs.appendFileSync(out, `${name}<<${delim}\n${v}\n${delim}\n`);
  } else {
    fs.appendFileSync(out, `${name}=${v}\n`);
  }
}

// -----------------------------------------------------------------------------
// GitHub API client (built-in fetch, with retry)
// -----------------------------------------------------------------------------
async function gh(url, opts = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${opts.token}`,
  };
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  if (opts.body && !opts.headers) {
    headers['Content-Type'] = opts.contentType || 'application/octet-stream';
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body,
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (res.ok) return data;
      // retry on rate limit / 5xx
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const retryAfter = Number(res.headers.get('retry-after') || 2) * 1000;
        await new Promise((r) => setTimeout(r, retryAfter || 2000));
        continue;
      }
      const msg = data && (data.message || data.errors) ? JSON.stringify(data.message || data.errors) : text;
      throw new Error(`GitHub API ${res.status} ${opts.method || 'GET'} ${url}: ${msg}`);
    } catch (e) {
      lastErr = e;
      if (!/GitHub API/.test(e.message) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// -----------------------------------------------------------------------------
// Glob expansion (supports *, **, ?, [abc]) relative to workspace
// -----------------------------------------------------------------------------
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '.') {
      re += '\\.';
    } else if (c === '[') {
      let j = i + 1;
      let cls = '';
      while (j < glob.length && glob[j] !== ']') {
        cls += glob[j];
        j++;
      }
      if (j < glob.length) {
        re += '[' + cls + ']';
        i = j;
      } else {
        re += '\\[';
      }
    } else if (c === '(' || c === ')' || c === '{' || c === '}' || c === '+' || c === '^' || c === '$' || c === '|' || c === '\\') {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function walk(dir, base, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walk(full, rel, out);
    } else {
      out.push({ full, rel });
    }
  }
}

function expandGlobs(patterns) {
  const files = new Set();
  const unmatched = [];
  for (const p of patterns) {
    const clean = p.replace(/^\.\//, '');
    if (!/[*?[]/.test(clean)) {
      const abs = path.resolve(WS, clean);
      if (fs.existsSync(abs)) files.add(abs);
      else unmatched.push(p);
      continue;
    }
    const re = globToRegExp(clean);
    const all = [];
    walk(WS, '', all);
    let hit = 0;
    for (const f of all) {
      if (re.test(f.rel)) { files.add(f.full); hit++; }
    }
    if (hit === 0) unmatched.push(p);
  }
  return { files: [...files], unmatched };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  const token = input('token', { required: true });
  const repo = input('repository') || process.env.GITHUB_REPOSITORY || '';
  if (!repo || !repo.includes('/')) {
    throw new Error(`repository is required, got: "${repo}"`);
  }

  // tag name: explicit input, or the current ref when pushed as a tag
  let tag = input('tag_name');
  if (!tag) {
    const ref = process.env.GITHUB_REF || '';
    if (ref.startsWith('refs/tags/')) tag = ref.replace('refs/tags/', '');
  }
  if (!tag) {
    throw new Error(
      'tag_name is required (either pass the tag_name input or trigger the workflow from a tag push)'
    );
  }

  const draft = boolInput('draft');
  const prerelease = boolInput('prerelease');
  const makeLatest = input('make_latest') || 'true';
  const generateReleaseNotes = boolInput('generate_release_notes');
  const discussionCategory = input('discussion_category_name');
  const appendBody = boolInput('append_body');
  const updateReleaseBody = boolInput('update_release_body');
  const updateReleaseBodyIfDraft = boolInput('update_release_body_if_draft');
  const failOnUnmatched = boolInput('fail_on_unmatched_files');

  // body: body_path takes precedence over body
  let body = input('body');
  const bodyPath = input('body_path');
  if (bodyPath) {
    const abs = path.isAbsolute(bodyPath) ? bodyPath : path.resolve(WS, bodyPath);
    if (!fs.existsSync(abs)) throw new Error(`body_path not found: ${bodyPath}`);
    body = fs.readFileSync(abs, 'utf8');
  }

  console.log(`::group::Release ${tag} on ${repo}`);
  console.log(`draft=${draft} prerelease=${prerelease} make_latest=${makeLatest}`);

  const base = `${API}/repos/${repo}`;
  let release = null;

  // Does a release with this tag already exist?
  try {
    release = await gh(`${base}/releases/tags/${encodeURIComponent(tag)}`, { token });
  } catch (e) {
    if (!/404/.test(e.message)) throw e;
  }

  if (!release) {
    // ---- create ----
    const payload = {
      tag_name: tag,
      target_commitish: input('target_commitish') || undefined,
      name: input('name') || undefined,
      draft,
      prerelease,
      discussion_category_name: discussionCategory || undefined,
      generate_release_notes: generateReleaseNotes,
      make_latest: makeLatest,
    };
    // body only when explicitly provided (or notes are not auto-generated)
    if (!generateReleaseNotes && (body || bodyPath)) payload.body = body;
    release = await gh(`${base}/releases`, { method: 'POST', json: payload, token });
    console.log(`Created release: ${release.html_url}`);
  } else {
    // ---- existing release: optionally update body ----
    console.log(`Release already exists (id=${release.id}), checking update policy`);
    const shouldUpdate =
      updateReleaseBody || (updateReleaseBodyIfDraft && release.draft === true);
    if (shouldUpdate) {
      let newBody = body;
      if (appendBody && release.body) {
        newBody = `${release.body}\n${body}`;
      }
      const payload = {
        name: input('name') || release.name,
        body: newBody,
        draft,
        prerelease,
      };
      release = await gh(`${base}/releases/${release.id}`, { method: 'PATCH', json: payload, token });
      console.log(`Updated release body (append_body=${appendBody})`);
    } else if (appendBody) {
      console.warn('::warning::append_body is set but neither update_release_body nor update_release_body_if_draft is enabled; body was not appended');
    }
  }

  // ---- upload assets ----
  const patterns = linesInput('files');
  const { files, unmatched } = expandGlobs(patterns);
  if (unmatched.length > 0) {
    const msg = `No files matched for: ${unmatched.join(', ')}`;
    if (failOnUnmatched) throw new Error(msg);
    console.warn(`::warning::${msg}`);
  }
  console.log(`Matched ${files.length} file(s) for upload`);

  const assets = [];
  const uploadUrl = release.upload_url.replace('{?name,label}', '');
  for (const f of files) {
    const name = path.basename(f);
    const stat = fs.statSync(f);
    const buf = fs.readFileSync(f);
    console.log(`Uploading ${name} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);
    const asset = await gh(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: buf,
      contentType: 'application/octet-stream',
      token,
    });
    assets.push(asset);
    console.log(`Uploaded: ${name}`);
  }

  // ---- outputs ----
  setOutput('url', release.html_url);
  setOutput('id', release.id);
  setOutput('upload_url', release.upload_url);
  setOutput('browser_download_url', release.browser_download_url || release.html_url);
  setOutput('assets', JSON.stringify(assets));
  console.log('::endgroup::');
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});

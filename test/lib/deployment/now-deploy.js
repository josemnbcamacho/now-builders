const { homedir, tmpdir } = require('os');
const path = require('path');
const fs = require('fs-extra');
const createDeployment = require('now-client').default;
const fetch = require('./fetch-retry.js');

const str = 'aHR0cHM6Ly9hcGktdG9rZW4tZmFjdG9yeS56ZWl0LnNo';

async function nowDeploy (bodies, randomness) {
  if (!randomness) {
    randomness = Math.random()
      .toString()
      .slice(2);
  }
  const tmpDir = path.join(tmpdir(), randomness);
  console.log(`making directory: ${tmpDir}`);
  await fs.mkdir(tmpDir);

  const promises = Object.keys(bodies).map((name) => {
    const buffer = bodies[name];
    const absolutePath = path.join(tmpDir, name);
    return fs.writeFile(absolutePath, buffer);
  });

  await Promise.all(promises);
  console.log('generating token');

  const token = await getToken();
  console.log('deploying from file system');
  let deployment;
  try {
    deployment = await deployFromFileSystem(tmpDir, token);
  } catch (error) {
    throw new Error(`Deployment failed: ${JSON.stringify(error)}`);
  }

  console.log('DEPLOYMENT ', deployment);
  console.log('deploymentId', deployment.id);
  console.log('deploymentUrl', deployment.url);

  console.log(`cleaning up ${tmpDir}`);
  await fs.remove(tmpDir);
  console.log('success');

  return { deploymentId: deployment.id, deploymentUrl: deployment.url };
}

function deployFromFileSystem (absolutePath, token) {
  return new Promise(async (resolve, reject) => {
    for await (const event of createDeployment(absolutePath, { token })) {
      if (event.type === 'ready') {
        resolve(event.payload);
        break;
      }
      if (event.type === 'error') {
        reject(event.payload);
        break;
      }
    }
  });
}

let token;
let currentCount = 0;
const MAX_COUNT = 10;

async function getToken () {
  const { NOW_TOKEN, CIRCLECI } = process.env;
  currentCount += 1;
  if (!token || currentCount === MAX_COUNT) {
    currentCount = 0;
    if (NOW_TOKEN) {
      token = NOW_TOKEN;
    } else if (CIRCLECI) {
      token = await fetchTokenWithRetry(Buffer.from(str, 'base64').toString());
    } else {
      const authJsonPath = path.join(homedir(), '.now/auth.json');
      token = require(authJsonPath).token;
    }
  }
  return token;
}

async function fetchWithAuth (url, opts = {}) {
  if (!opts.headers) opts.headers = {};

  if (!opts.headers.Authorization) {
    const bearer = await getToken();
    opts.headers.Authorization = `Bearer ${bearer}`;
  }

  return await fetchApi(url, opts);
}

function fetchTokenWithRetry (url, retries = 3) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(url);
      const data = await res.json();
      resolve(data.token);
    } catch (error) {
      console.log(`Failed to fetch token. Retries remaining: ${retries}`);
      if (retries === 0) {
        reject(error);
        return;
      }
      setTimeout(() => {
        fetchTokenWithRetry(url, retries - 1)
          .then(resolve)
          .catch(reject);
      }, 500);
    }
  });
}

async function fetchApi (url, opts = {}) {
  const apiHost = process.env.API_HOST || 'api.zeit.co';
  const urlWithHost = `https://${apiHost}${url}`;
  const { method = 'GET', body } = opts;

  if (process.env.VERBOSE) {
    console.log('fetch', method, url);
    if (body) console.log(encodeURIComponent(body).slice(0, 80));
  }

  if (!opts.headers) opts.headers = {};

  if (!opts.headers.Accept) {
    opts.headers.Accept = 'application/json';
  }

  opts.headers['x-now-trace-priority'] = '1';

  return await fetch(urlWithHost, opts);
}

module.exports = {
  fetchApi,
  fetchWithAuth,
  nowDeploy,
};

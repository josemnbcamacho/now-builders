const path = require('path');
const execa = require('execa');
const { Lambda } = require('@now/build-utils/lambda.js');
const getWritableDirectory = require('@now/build-utils/fs/get-writable-directory.js');
const download = require('@now/build-utils/fs/download.js');
const fs = require('fs');
const downloadDotnetBin = require('./download-dotnet-bin');

exports.config = {
  maxLambdaSize: '50mb',
};

exports.build = async ({ files, entrypoint }) => {
  console.log('downloading files...');

  const dotnetPath = await getWritableDirectory();
  const tmpPath = path.join(dotnetPath, 'src', 'lambda');
  const outDir = await getWritableDirectory();

  const downloadedFiles = await download(files, tmpPath);

  console.log('downloading dotnet binary...');
  const dotnetBin = await downloadDotnetBin();

  const entrypointDirname = path.dirname(downloadedFiles[entrypoint].fsPath);
  const appDir = path.join(outDir, '/app');

  console.log('reading aws-lambda-tools-defaults.json...');

  const data = fs.readFileSync(
    path.join(tmpPath, 'aws-lambda-tools-defaults.json'),
    'utf8',
  );
  const toolDefaults = JSON.parse(data);
  const handler = toolDefaults['function-handler'];

  console.log(handler);

  console.log('running yum install zip ...');
  try {
    await execa('yum', ['install', 'zip']);
  } catch (err) {
    console.log('failed to `yum install zip`');
    throw err;
  }

  const dotnetEnv = {
    ...process.env,
    NUGET_XMLDOC_MODE: 'skip',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: 'true',
    DOTNET_ROOT: path.dirname(dotnetBin),
    PATH: `${process.env.PATH}:${path.dirname(dotnetBin)}`,
  };

  console.log('running dotnet install lambda ...');
  try {
    await execa(dotnetBin, [
      'tool',
      'install',
      '-v',
      'diag',
      '--tool-path',
      path.dirname(dotnetBin),
      'Amazon.Lambda.Tools',
      '--version',
      '3.2.3',
    ]);
  } catch (err) {
    console.log('failed to `dotnet install lambda tools`');
    throw err;
  }

  console.log('running dotnet lambda package...');
  try {
    await execa(
      path.join(path.dirname(dotnetBin), 'dotnet-lambda'),
      [
        'package',
        '-c',
        'Release',
        '-o',
        path.join(appDir, path.parse(entrypoint).name),
        // '/p:ShowLinkerSizeComparison=true',
        '-pl',
        entrypointDirname,
      ],
      { env: dotnetEnv, stdio: 'inherit' },
    );
  } catch (err) {
    console.log('failed to `dotnet lambda package`');
    throw err;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(
      path.join(appDir, `${path.parse(entrypoint).name}.zip`),
    );
  } catch (err) {
    console.log('failed to read file to buffer');
    console.log(err);
  }

  const lambda = new Lambda({
    zipBuffer: buffer,
    handler,
    runtime: 'dotnetcore2.1',
    environment: {},
  });

  return {
    index: lambda,
  };
};

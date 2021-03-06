import path from 'path';

import globby from 'globby';

import createPatternGlob from './utils/createPatternGlob';

export default async function processPattern(globalRef, pattern) {
  const { logger, output, compilation } = globalRef;

  createPatternGlob(pattern, globalRef);

  logger.log(
    `begin globbing '${pattern.glob}' with a context of '${pattern.context}'`
  );

  const paths = await globby(pattern.glob, pattern.globOptions);

  if (paths.length === 0) {
    if (pattern.noErrorOnMissing) {
      return Promise.resolve();
    }

    const missingError = new Error(
      `unable to locate '${pattern.from}' at '${pattern.absoluteFrom}'`
    );

    logger.error(missingError.message);

    compilation.errors.push(missingError);

    return Promise.resolve();
  }

  return paths.map((filepath) => {
    let from;

    if (typeof filepath === 'string') {
      from = filepath;
    } else {
      from = filepath.path;
    }

    const file = { absoluteFrom: path.resolve(pattern.context, from) };

    file.relativeFrom = path.relative(pattern.context, file.absoluteFrom);

    if (pattern.flatten) {
      file.relativeFrom = path.basename(file.relativeFrom);
    }

    logger.debug(`found ${from}`);

    // Change the to path to be relative for webpack
    file.webpackTo =
      pattern.toType === 'dir'
        ? path.join(pattern.to, file.relativeFrom)
        : pattern.to;

    if (path.isAbsolute(file.webpackTo)) {
      file.webpackTo = path.relative(output, file.webpackTo);
    }

    logger.log(`determined that '${from}' should write to '${file.webpackTo}'`);

    return file;
  });
}

import path from 'path';
import os from 'os';
import crypto from 'crypto';

import loaderUtils from 'loader-utils';
import cacache from 'cacache';
import serialize from 'serialize-javascript';
import findCacheDir from 'find-cache-dir';
import normalizePath from 'normalize-path';

import { RawSource } from 'webpack-sources';

import { version } from '../package.json';

import { stat, readFile } from './utils/promisify';

/* eslint-disable no-param-reassign */

export default async function postProcessPattern(globalRef, pattern, file) {
  const { logger, compilation, inputFileSystem } = globalRef;

  logger.debug(`getting stats for '${file.absoluteFrom}' to write to assets`);

  const getStats = pattern.stats
    ? pattern.stats
    : stat(inputFileSystem, file.absoluteFrom);

  let stats;

  try {
    stats = await getStats;
  } catch (error) {
    compilation.errors.push(error);

    return;
  }

  if (stats.isDirectory()) {
    logger.debug(
      `skipping '${file.absoluteFrom}' because it is empty directory`
    );

    return;
  }

  // If this came from a glob, add it to the file watchlist
  if (pattern.fromType === 'glob') {
    logger.debug(`add ${file.absoluteFrom} as fileDependencies`);

    compilation.fileDependencies.add(file.absoluteFrom);
  }

  logger.debug(`reading '${file.absoluteFrom}' to write to assets`);

  let content;

  try {
    content = await readFile(inputFileSystem, file.absoluteFrom);
  } catch (error) {
    compilation.errors.push(error);

    return;
  }

  if (pattern.transform) {
    logger.log(`transforming content for '${file.absoluteFrom}'`);

    if (pattern.cacheTransform) {
      const cacheDirectory = pattern.cacheTransform.directory
        ? pattern.cacheTransform.directory
        : typeof pattern.cacheTransform === 'string'
        ? pattern.cacheTransform
        : findCacheDir({ name: 'copy-webpack-plugin' }) || os.tmpdir();
      let defaultCacheKeys = {
        version,
        transform: pattern.transform,
        contentHash: crypto.createHash('md4').update(content).digest('hex'),
      };

      if (typeof pattern.cacheTransform.keys === 'function') {
        defaultCacheKeys = await pattern.cacheTransform.keys(
          defaultCacheKeys,
          file.absoluteFrom
        );
      } else {
        defaultCacheKeys = {
          ...defaultCacheKeys,
          ...pattern.cacheTransform.keys,
        };
      }

      const cacheKeys = serialize(defaultCacheKeys);

      try {
        const result = await cacache.get(cacheDirectory, cacheKeys);

        logger.debug(
          `getting cached transformation for '${file.absoluteFrom}'`
        );

        content = result.data;
      } catch (_ignoreError) {
        content = await pattern.transform(content, file.absoluteFrom);

        logger.debug(`caching transformation for '${file.absoluteFrom}'`);

        content = await cacache
          .put(cacheDirectory, cacheKeys, content)
          .then(() => content);
      }
    } else {
      content = await pattern.transform(content, file.absoluteFrom);
    }
  }

  if (pattern.toType === 'template') {
    logger.log(
      `interpolating template '${file.webpackTo}' for '${file.relativeFrom}'`
    );

    // If it doesn't have an extension, remove it from the pattern
    // ie. [name].[ext] or [name][ext] both become [name]
    if (!path.extname(file.relativeFrom)) {
      file.webpackTo = file.webpackTo.replace(/\.?\[ext]/g, '');
    }

    file.webpackTo = loaderUtils.interpolateName(
      { resourcePath: file.absoluteFrom },
      file.webpackTo,
      {
        content,
        context: pattern.context,
      }
    );

    // Bug in `loader-utils`, package convert `\\` to `/`, need fix in loader-utils
    file.webpackTo = path.normalize(file.webpackTo);
  }

  if (pattern.transformPath) {
    logger.log(
      `transforming path '${file.webpackTo}' for '${file.absoluteFrom}'`
    );

    file.webpackTo = await pattern.transformPath(
      file.webpackTo,
      file.absoluteFrom
    );
  }

  const targetPath = normalizePath(file.webpackTo);
  const source = new RawSource(content);

  // For old version webpack 4
  /* istanbul ignore if */
  if (typeof compilation.emitAsset !== 'function') {
    compilation.assets[targetPath] = source;

    return;
  }

  if (compilation.getAsset(targetPath)) {
    if (pattern.force) {
      logger.log(
        `force updating '${file.webpackTo}' to compilation assets from '${file.absoluteFrom}'`
      );

      compilation.updateAsset(targetPath, source);

      return;
    }

    logger.log(`skipping '${file.webpackTo}', because it already exists`);

    return;
  }

  logger.log(
    `writing '${file.webpackTo}' to compilation assets from '${file.absoluteFrom}'`
  );

  compilation.emitAsset(targetPath, source);
}

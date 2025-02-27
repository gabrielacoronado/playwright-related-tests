import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { readFile } from 'fs/promises';

import { RemoteConnector } from './base';
import type { RelationshipType } from '../types';
import type { EndpointConnectorParamsOptions } from './types';
import { Compressor } from '../compressor';
import { logger } from '../logger';
import { generateUniqueId } from '../utils';

export class EndpointConnector extends RemoteConnector {
  constructor() {
    super();
  }

  private async createStream(res: Response, outputPath: string) {
    let nodeReadableStream: Readable;
    if (res?.body) {
      nodeReadableStream = Readable.from(res.body);
    } else {
      throw new Error('Response body is empty');
    }
    const fileStream = fs.createWriteStream(outputPath);
    return new Promise((resolve, reject) => {
      if (res.body) {
        nodeReadableStream.pipe(fileStream);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      }
    });
  }

  private async fetch(options: EndpointConnectorParamsOptions) {
    const { url, method, headers, body } = options || {};
    const response = await fetch(url, {
      method,
      headers,
      ...(body && { body }),
    });
    if (!response.ok) {
      const errorMessage = `${response.status} - ${response.statusText}`;
      throw new Error(errorMessage);
    }

    if (response.redirected && response.type === 'cors') {
      throw new Error('There was a redirection.');
    }

    return response;
  }

  async upload(
    type: RelationshipType,
    folder: string,
    options: EndpointConnectorParamsOptions,
  ): Promise<void> {
    const filename = `${type}.tar.gz`;
    const compressedFilePath = await Compressor.compress(
      folder,
      path.join(tmpdir(), filename),
    );
    const fileData = await readFile(compressedFilePath);
    try {
      await this.fetch({
        ...options,
        body: fileData,
      });
    } catch (e) {
      logger.error(`File could not be uploaded: ${e}`);
    }
  }

  async download(
    type: RelationshipType,
    options: EndpointConnectorParamsOptions,
  ): Promise<string | null> {
    if (!options.url) {
      logger.error('No URL provided.');
      return null;
    }
    if (!options.headers) {
      logger.error('No Headers provided.');
      return null;
    }
    const filename = `${type}.tar.gz`;
    const endpointUrl = `${options.url}/${filename}`;
    const filePath = path.join(tmpdir(), filename);
    const tmpToExtract = path.join(tmpdir(), `extracted-${generateUniqueId()}`);
    try {
      const res = await this.fetch({
        ...options,
        url: endpointUrl,
      });
      await this.createStream(res, filePath);
      logger.log(
        `File downloaded successfully from ${endpointUrl} to ${filePath}`,
      );
    } catch (e) {
      logger.error(`File could not be fetched: ${e}`);
      return null;
    }

    fs.mkdirSync(tmpToExtract, { recursive: true });

    // TODO Implement a cache of the downloaded files, so we don't download the same file multiple times.
    return Compressor.extract(filePath, tmpToExtract);
  }
}

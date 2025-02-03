import { type FullConfig } from '@playwright/test';
import { exec as syncExec } from 'node:child_process';
import { promisify } from 'node:util';
import { RelatedTestsConfig } from './config';
import { logger } from './logger';
import { RelationshipManager } from './relationship';
import {
  EndpointConnector,
  S3Connector,
  type TRemoteConnector,
} from './connectors';
import type {
  ConnectorOptions,
  Constructor,
  EndpointConnectorParamsOptions,
  S3ConnectorParamsOptions,
} from './types';

const exec = promisify(syncExec);

type RelatedTests = Promise<{
  impactedTestFiles: string[];
  impactedTestNames: string[];
}>;

async function findRelatedTests(
  options?: ConnectorOptions,
  remoteConnector:
    | Constructor<TRemoteConnector>
    | undefined = typeof options === 'string' ? S3Connector : undefined,
): RelatedTests {
  const { stdout } = await exec('git diff --name-only HEAD');
  const modifiedFiles = stdout.trim().split('\n');
  const relationShipManager = new RelationshipManager(
    modifiedFiles,
    remoteConnector,
  );
  await relationShipManager.init({
    options,
  });

  return relationShipManager.extractRelationships();
}

export async function getImpactedTestsRegex(
  options?: ConnectorOptions,
  remoteConnector:
    | Constructor<TRemoteConnector>
    | undefined = typeof options === 'string' ? S3Connector : EndpointConnector,
): Promise<RegExp | undefined> {
  const { impactedTestNames } = await findRelatedTests(
    options,
    remoteConnector,
  );

  if (impactedTestNames.length === 0) {
    logger.debug(`No tests impacted by changes`);
    return;
  }

  const escapedTitles = impactedTestNames.map((title) =>
    title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );

  const regexPattern = escapedTitles.join('|');

  const testTitleRegex = new RegExp(`(${regexPattern})$`);

  logger.debug(
    `Matching these tests:\n
${testTitleRegex}
    `,
  );

  return testTitleRegex;
}

export async function updateConfigWithImpactedTests(
  config: FullConfig,
  options?: S3ConnectorParamsOptions,
  remoteConnector?: Constructor<S3Connector>,
): Promise<void>;
export async function updateConfigWithImpactedTests(
  config: FullConfig,
  options?: EndpointConnectorParamsOptions,
  remoteConnector?: Constructor<EndpointConnector>,
): Promise<void>;
export async function updateConfigWithImpactedTests(
  config: FullConfig,
  options?: ConnectorOptions,
  remoteConnector:
    | Constructor<TRemoteConnector>
    | undefined = typeof options === 'string' ? S3Connector : undefined,
): Promise<void> {
  const regex = await getImpactedTestsRegex(options, remoteConnector);

  if (regex) {
    config.grep = regex;

    config.projects.forEach((project) => {
      project.grep = regex;
    });
  } else {
    const rtc = RelatedTestsConfig.instance;
    const rtcConfig = rtc.getConfig();

    if (rtcConfig.exitProcess) {
      process.exit(0);
    }
  }
}

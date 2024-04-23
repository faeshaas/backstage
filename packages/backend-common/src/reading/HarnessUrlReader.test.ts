/*
 * Copyright 2024 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { setupRequestMockHandlers } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';
import { HarnessIntegration, readHarnessConfig } from '@backstage/integration';
import { JsonObject } from '@backstage/types';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { getVoidLogger } from '../logging';
import { UrlReaderPredicateTuple } from './types';
import { DefaultReadTreeResponseFactory } from './tree';
import getRawBody from 'raw-body';
import { HarnessUrlReader } from './HarnessUrlReader';

const treeResponseFactory = DefaultReadTreeResponseFactory.create({
  config: new ConfigReader({}),
});

jest.mock('../scm', () => ({
  Git: {
    fromAuth: () => ({
      clone: jest.fn(() => Promise.resolve({})),
    }),
  },
}));

const harnessProcessor = new HarnessUrlReader(
  new HarnessIntegration(
    readHarnessConfig(
      new ConfigReader({
        host: 'app.harness.io',
        token: 'p',
      }),
    ),
  ),
);

const createReader = (config: JsonObject): UrlReaderPredicateTuple[] => {
  return HarnessUrlReader.factory({
    config: new ConfigReader(config),
    logger: getVoidLogger(),
    treeResponseFactory,
  });
};
const responseBuffer = Buffer.from('Apache License');
const harnessApiResponse = (content: any) => {
  return JSON.stringify({
    content: {
      data: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    },
  });
};

const handlers = [
  rest.get(
    'https://app.harness.io/gateway/code/api/v1/repos/accountId/orgName/projName/repoName/:path+/content/all-apis.yaml',
    (req, res, ctx) => {
      return res(ctx.status(500), ctx.json({ message: 'Error!!!' }));
    },
  ),
  rest.get(
    'https://app.harness.io/gateway/code/api/v1/repos/accountId/orgName/projName/repoName/:path+/content/404error.yaml',
    (req, res, ctx) => {
      return res(ctx.status(404), ctx.json({ message: 'File not found.' }));
    },
  ),
  rest.get(
    'https://app.harness.io/gateway/code/api/v1/repos/accountId/orgName/projName/repoName/:path+/content/stream.TXT',
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.body(harnessApiResponse(responseBuffer.toString())),
      );
    },
  ),

  rest.get(
    'https://app.harness.io/gateway/code/api/v1/repos/accountId/orgName/projName/repoName/:path+/content/buffer.TXT',
    (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.body(harnessApiResponse(responseBuffer.toString())),
      );
    },
  ),
  rest.post('/api/login', (req, res, ctx) => {
    const { username } = req.body;

    if (username === 'admin') {
      return res(ctx.status(200), ctx.json({ token: 'fake-token' }));
    }
    return res(ctx.status(403), ctx.json({ message: 'Access Denied' }));
  }),
];

describe('HarnessUrlReader', () => {
  const worker = setupServer(...handlers);
  setupRequestMockHandlers(worker);
  beforeAll(() => worker.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => {
    jest.clearAllMocks();
  });

  describe('reader factory', () => {
    it('creates a reader.', () => {
      const readers = createReader({
        integrations: {
          harness: [{ host: 'app.harness.io' }],
        },
      });
      expect(readers).toHaveLength(1);
    });

    it('should not create a default entry.', () => {
      const readers = createReader({
        integrations: {},
      });
      expect(readers).toHaveLength(0);
    });
  });

  describe('predicates', () => {
    it('returns true for the configured host', () => {
      const readers = createReader({
        integrations: {
          harness: [{ host: 'app.harness.io' }],
        },
      });
      const predicate = readers[0].predicate;

      expect(predicate(new URL('https://app.harness.io/path'))).toBe(true);
    });

    it('returns false for a different host.', () => {
      const readers = createReader({
        integrations: {
          harness: [{ host: 'app.harness.io' }],
        },
      });
      const predicate = readers[0].predicate;

      expect(predicate(new URL('https://github.com/path'))).toBe(false);
    });
  });

  describe('readUrl part 1', () => {
    it('should be able to read file contents as buffer', async () => {
      const result = await harnessProcessor.readUrl(
        'https://app.harness.io/ng/account/accountId/module/code/orgs/orgName/projects/projName/repos/repoName/files/refMain/~/buffer.TXT',
      );
      const buffer = await result.buffer();
      expect(buffer.toString()).toBe(responseBuffer.toString());
    });

    it('should be able to read file contents as stream', async () => {
      const result = await harnessProcessor.readUrl(
        'https://app.harness.io/ng/account/accountId/module/code/orgs/orgName/projects/projName/repos/repoName/files/refMain/~/stream.TXT',
      );
      const fromStream = await getRawBody(result.stream!());
      expect(fromStream.toString()).toBe(responseBuffer.toString());
    });

    it('should raise NotFoundError on 404.', async () => {
      await expect(
        harnessProcessor.readUrl(
          'https://app.harness.io/ng/account/accountId/module/code/orgs/orgName/projects/projName/repos/repoName/files/refMain/~/404error.yaml',
        ),
      ).rejects.toThrow(
        'https://app.harness.io/ng/account/accountId/module/code/orgs/orgName/projects/projName/repos/repoName/files/refMain/~/404error.yaml x https://app.harness.io/gateway/code/api/v1/repos/accountId/orgName/projName/repoName/+/content/404error.yaml?routingId=accountId&include_commit=false&ref=refMain, 404 Not Found',
      );
    });

    it('should throw an error on non 404 errors.', async () => {
      await expect(
        harnessProcessor.readUrl(
          'https://app.harness.io/ng/account/accountId/module/code/orgs/orgName/projects/projName/repos/repoName/files/refMain/~/all-apis.yaml',
        ),
      ).rejects.toThrow(
        'https://app.harness.io/ng/account/accountId/module/code/orgs/orgName/projects/projName/repos/repoName/files/refMain/~/all-apis.yaml x https://app.harness.io/gateway/code/api/v1/repos/accountId/orgName/projName/repoName/+/content/all-apis.yaml?routingId=accountId&include_commit=false&ref=refMain, 500 Internal Server Error',
      );
    });
  });
});

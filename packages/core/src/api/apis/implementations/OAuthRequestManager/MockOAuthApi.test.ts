/*
 * Copyright 2020 Spotify AB
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

import MockOAuthApi from './MockOAuthApi';
import PowerIcon from '@material-ui/icons/Power';
import { BasicOAuthScopes } from './BasicOAuthScopes';

describe('MockOAuthApi', () => {
  it('should trigger all requests', async () => {
    const popupResult = { is: 'done' };
    const mock = new MockOAuthApi(popupResult);

    const authHandler1 = jest
      .fn()
      .mockImplementation(() => mock.showLoginPopup());
    const requester1 = mock.createAuthRequester({
      provider: { icon: PowerIcon, title: 'Test' },
      onAuthRequest: authHandler1,
    });

    const authHandler2 = jest.fn().mockResolvedValue('other');
    const requester2 = mock.createAuthRequester({
      provider: { icon: PowerIcon, title: 'Test' },
      onAuthRequest: authHandler2,
    });

    const promises = [
      requester1(BasicOAuthScopes.from('a')),
      requester1(BasicOAuthScopes.from('b')),
      requester2(BasicOAuthScopes.from('a b')),
      requester2(BasicOAuthScopes.from('b c')),
      requester2(BasicOAuthScopes.from('c a')),
    ];

    await expect(
      Promise.race([Promise.all(promises), 'waiting']),
    ).resolves.toBe('waiting');

    await mock.triggerAll();

    await expect(Promise.all(promises)).resolves.toEqual([
      popupResult,
      popupResult,
      'other',
      'other',
      'other',
    ]);

    expect(authHandler1).toHaveBeenCalledTimes(1);
    expect(authHandler1).toHaveBeenCalledWith(BasicOAuthScopes.from('a b'));
    expect(authHandler2).toHaveBeenCalledTimes(1);
    expect(authHandler2).toHaveBeenCalledWith(BasicOAuthScopes.from('a b c'));
  });

  it('should reject all requests', async () => {
    const mock = new MockOAuthApi();

    const authHandler1 = jest.fn();
    const requester1 = mock.createAuthRequester({
      provider: { icon: PowerIcon, title: 'Test' },
      onAuthRequest: authHandler1,
    });

    const authHandler2 = jest.fn();
    const requester2 = mock.createAuthRequester({
      provider: { icon: PowerIcon, title: 'Test' },
      onAuthRequest: authHandler2,
    });

    const promises = [
      requester1(BasicOAuthScopes.from('a')),
      requester1(BasicOAuthScopes.from('b')),
      requester2(BasicOAuthScopes.from('a b')),
      requester2(BasicOAuthScopes.from('b c')),
      requester2(BasicOAuthScopes.from('c a')),
    ];

    await expect(
      Promise.race([Promise.all(promises), 'waiting']),
    ).resolves.toBe('waiting');

    await mock.rejectAll();

    for (const promise of promises) {
      await expect(promise).rejects.toMatchObject({ name: 'RejectedError' });
    }

    expect(authHandler1).not.toHaveBeenCalled();
    expect(authHandler2).not.toHaveBeenCalled();
  });
});

import { useEffect, useRef, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';

export type DiscordAuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      sdk: DiscordSDK;
      userId: string;
      displayName: string;
      avatarUrl: string | undefined;
      instanceId: string;
    };

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);

export function useDiscord(): DiscordAuthState {
  const [state, setState] = useState<DiscordAuthState>({ status: 'loading' });
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    async function init() {
      try {
        await discordSdk.ready();

        const { code } = await discordSdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds', 'applications.commands'],
        });

        const res = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Token exchange failed (${res.status}): ${body}`);
        }

        const { access_token } = (await res.json()) as { access_token: string };

        const auth = await discordSdk.commands.authenticate({ access_token });
        if (!auth) throw new Error('Authentication returned null');

        const userId = auth.user.id;
        const displayName = auth.user.global_name ?? auth.user.username;
        const avatar = auth.user.avatar;
        const avatarUrl = avatar
          ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128`
          : undefined;

        setState({
          status: 'ready',
          sdk: discordSdk,
          userId,
          displayName,
          avatarUrl,
          instanceId: discordSdk.instanceId,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[useDiscord] Init error:', message);
        setState({ status: 'error', message });
      }
    }

    init();
  }, []);

  return state;
}

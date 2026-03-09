import { useEffect, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';

/**
 * Subscribes to Discord SPEAKING_START / SPEAKING_STOP events.
 *
 * The Discord SDK requires the channel_id to be provided when subscribing to
 * voice-related events. Without it the subscription silently fails.
 * We read it from discordSdk.channelId which is populated after ready().
 */
export function useVoiceState(sdk: DiscordSDK | null): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!sdk) return;

    // channelId is the voice channel the Activity is running in.
    // It may be null if the Activity was opened outside a voice channel.
    const channelId = (sdk as unknown as { channelId: string | null }).channelId;
    if (!channelId) {
      console.warn('[useVoiceState] No channelId on SDK — cannot subscribe to speaking events');
      return;
    }

    let active = true;

    const onSpeakingStart = (data: { user_id: string }) => {
      if (!active) return;
      setSpeaking((prev) => {
        const next = new Set(prev);
        next.add(data.user_id);
        return next;
      });
    };

    const onSpeakingStop = (data: { user_id: string }) => {
      if (!active) return;
      setSpeaking((prev) => {
        const next = new Set(prev);
        next.delete(data.user_id);
        return next;
      });
    };

    async function subscribe() {
      try {
        // The second argument to subscribe() is the event args — for voice events
        // this MUST include channel_id, otherwise Discord rejects the subscription.
        await sdk!.subscribe(
          'SPEAKING_START',
          onSpeakingStart,
          { channel_id: channelId! },
        );
        await sdk!.subscribe(
          'SPEAKING_STOP',
          onSpeakingStop,
          { channel_id: channelId! },
        );
        console.log('[useVoiceState] Subscribed to speaking events for channel', channelId);
      } catch (err) {
        console.warn('[useVoiceState] Subscription failed:', err);
      }
    }

    subscribe();

    return () => {
      active = false;
      // Unsubscribe on cleanup — best effort
      sdk!.unsubscribe('SPEAKING_START', onSpeakingStart).catch(() => {});
      sdk!.unsubscribe('SPEAKING_STOP', onSpeakingStop).catch(() => {});
    };
  }, [sdk]);

  return speaking;
}
